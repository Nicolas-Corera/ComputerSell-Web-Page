-- Precio con transferencia: un producto puede tener un valor distinto cuando
-- se paga por transferencia (products.transfer_price, lo carga el panel).
-- Sin valor, o si no es menor al precio, se cobra el precio normal. La tienda
-- muestra el precio normal y debajo "$X con transferencia"; el cobro lo decide
-- esta base (place_order), no el navegador.
--
-- OJO: si se vuelve a redefinir place_order, mantené product_unit_price.

alter table public.products add column if not exists transfer_price integer;
alter table public.products drop constraint if exists products_transfer_price_check;
alter table public.products add constraint products_transfer_price_check
  check (transfer_price is null or (transfer_price >= 0 and transfer_price < price));

-- La tienda lee las columnas por separado (0017): esta también es pública
grant select (transfer_price) on public.products to anon, authenticated;

-- Precio unitario según el medio de pago
create or replace function public.product_unit_price(p_price integer, p_transfer integer, p_method text)
returns integer language sql immutable set search_path = public as $$
  select case when p_method = 'transferencia' and p_transfer is not null and p_transfer >= 0 and p_transfer < p_price
              then p_transfer else p_price end;
$$;
grant execute on function public.product_unit_price(integer, integer, text) to anon, authenticated, service_role;

create or replace function public.place_order(
  p_user uuid, p_items jsonb, p_payment_method text, p_customer jsonb,
  p_installments integer, p_subtotal integer, p_shipping_cost integer, p_surcharge integer,
  p_note text default '', p_client_key uuid default null
)
returns table (id uuid, number integer, status text, total integer)
language plpgsql security definer set search_path = public as $$
declare
  c_max_qty constant integer := 10;    -- unidades por producto en un pedido
  c_max_lines constant integer := 30;  -- productos distintos en un pedido
  c_transfer_ttl constant interval := interval '48 hours';
  v_item jsonb;
  v_prod public.products%rowtype;
  v_qty integer;
  v_subtotal integer := 0;
  v_total integer := 0;
  v_order public.orders%rowtype;
  v_first_title text := '';
  v_count integer := 0;
begin
  if p_user is null or not exists (select 1 from public.profiles where profiles.id = p_user) then
    raise exception 'Tenés que iniciar sesión para comprar';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'El carrito está vacío'; end if;
  if jsonb_array_length(p_items) > c_max_lines then
    raise exception 'El pedido tiene demasiados productos distintos (máximo %). Dividilo en dos compras.', c_max_lines;
  end if;
  if p_payment_method not in ('credito', 'debito', 'transferencia') then raise exception 'Medio de pago inválido'; end if;
  if coalesce(p_shipping_cost, -1) < 0 or coalesce(p_surcharge, -1) < 0 then raise exception 'Montos inválidos'; end if;

  -- Reintento del mismo intento de compra (doble envío, corte de red): mismo pedido
  if p_client_key is not null then
    select * into v_order from public.orders o where o.user_id = p_user and o.client_key = p_client_key;
    if found then
      return query select v_order.id, v_order.number, v_order.status, v_order.total;
      return;
    end if;
  end if;

  -- Devuelve al stock las reservas vencidas (tarjeta y transferencia)
  perform public.expire_stale_orders();

  if p_payment_method in ('credito', 'debito') and (
    select count(*) from public.orders o
    where o.user_id = p_user and o.payment_method in ('credito', 'debito', 'mercadopago')
      and o.status = 'cancelado' and o.created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception 'Hiciste demasiados intentos de pago con tarjeta. Esperá una hora o elegí pagar por transferencia.';
  end if;

  -- Primera pasada: validar stock y calcular subtotal (bloqueando filas)
  for v_item in select * from jsonb_array_elements(p_items) loop
    if coalesce(v_item->>'qty', '1') !~ '^[0-9]{1,6}$' then raise exception 'Cantidad inválida'; end if;
    v_qty := greatest(1, coalesce((v_item->>'qty')::integer, 1));
    if v_qty > c_max_qty then
      raise exception 'Podés comprar hasta % unidades de cada producto por pedido. Si necesitás más, escribinos por WhatsApp.', c_max_qty;
    end if;
    if coalesce(v_item->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Un producto del carrito ya no está disponible';
    end if;
    select * into v_prod from public.products where products.id = (v_item->>'product_id')::uuid for update;
    if not found or v_prod.status <> 'publicado' then
      raise exception 'Un producto del carrito ya no está disponible';
    end if;
    if v_prod.stock < v_qty then
      raise exception 'Sin stock suficiente de "%": %', v_prod.title,
        case when v_prod.stock = 0 then 'se agotó' when v_prod.stock = 1 then 'queda 1 unidad' else format('quedan %s unidades', v_prod.stock) end;
    end if;
    v_subtotal := v_subtotal + public.product_unit_price(v_prod.price, v_prod.transfer_price, p_payment_method) * v_qty;
    v_count := v_count + 1;
    if v_first_title = '' then v_first_title := v_prod.title; end if;
  end loop;

  if v_subtotal <> p_subtotal then
    raise exception 'Los precios cambiaron mientras comprabas. Revisá el total y volvé a intentar.';
  end if;

  v_total := v_subtotal + p_shipping_cost + p_surcharge;

  insert into public.orders (user_id, status, payment_method, installments, shipping_method, shipping_cost, surcharge, subtotal, total, customer, note, client_key, expires_at)
  values (p_user, 'pendiente', p_payment_method, greatest(1, coalesce(p_installments, 1)), 'domicilio', p_shipping_cost, p_surcharge, v_subtotal, v_total,
          coalesce(p_customer, '{}'::jsonb), left(coalesce(p_note, ''), 500), p_client_key,
          case when p_payment_method = 'transferencia' then now() + c_transfer_ttl end)
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item->>'qty')::integer, 1));
    select * into v_prod from public.products where products.id = (v_item->>'product_id')::uuid;
    insert into public.order_items (order_id, product_id, title, sku, image, unit_price, qty)
    values (v_order.id, v_prod.id, v_prod.title, v_prod.sku, v_prod.images[1], public.product_unit_price(v_prod.price, v_prod.transfer_price, p_payment_method), v_qty);
    update public.products set stock = stock - v_qty where products.id = v_prod.id;
  end loop;

  insert into public.order_events (order_id, status, note) values (v_order.id, 'pendiente', 'Pedido creado');

  if p_payment_method = 'transferencia' then
    perform public.notify_admins('venta', 'shopping_cart', format('Pedido nuevo CS-%s', v_order.number),
      format('%s pidió %s%s por $%s. Esperando la transferencia.', coalesce(nullif(p_customer->>'name', ''), 'Un cliente'), v_first_title,
             case when v_count > 1 then format(' y %s más', v_count - 1) else '' end, public.ar_money(v_total)),
      jsonb_build_object('view', 'ordenes', 'tab', 'ventas', 'order', v_order.id));
    perform public.notify_user(p_user, 'venta', 'shopping_bag', format('Recibimos tu pedido CS-%s', v_order.number),
      format('Transferí $%s y subí el comprobante desde el detalle del pedido antes del %s. Si no lo recibimos, el pedido se cancela solo.',
             public.ar_money(v_total), to_char(v_order.expires_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI "hs"')),
      jsonb_build_object('order', v_order.id));
  end if;

  return query select v_order.id, v_order.number, v_order.status, v_order.total;
end $$;
revoke all on function public.place_order(uuid, jsonb, text, jsonb, integer, integer, integer, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.place_order(uuid, jsonb, text, jsonb, integer, integer, integer, integer, text, uuid) to service_role;
