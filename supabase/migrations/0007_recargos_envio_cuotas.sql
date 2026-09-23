-- Recargos del checkout: envío por peso y provincia (Correo Argentino),
-- recargo por tarjeta y recargo por cuotas.
--
-- Las tarifas y porcentajes viven en assets/js/config/*.js y el cálculo en
-- assets/js/core/pricing.js (el mismo que usa el checkout). Por eso la orden
-- ya no la crea el navegador: la crea el backend (api/_lib/checkout.js), que
-- calcula envío y recargos y llama a place_order con el service role.
-- place_order sigue validando stock y precios bloqueando las filas: si el
-- subtotal no coincide con el que usó el backend, la orden no se crea.
--
-- orders.surcharge = recargo por tarjeta + recargo por cuotas
-- (subtotal + shipping_cost + surcharge = total).

drop function if exists public.place_order(jsonb, text, text, jsonb, integer, text);

create or replace function public.place_order(
  p_user uuid,
  p_items jsonb,            -- [{product_id, qty}]
  p_payment_method text,
  p_customer jsonb,
  p_installments integer,
  p_subtotal integer,       -- subtotal que usó el backend para calcular los recargos
  p_shipping_cost integer,
  p_surcharge integer,
  p_note text default ''
)
returns table (id uuid, number integer, status text, total integer)
language plpgsql security definer set search_path = public as $$
declare
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
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'El carrito está vacío'; end if;
  if p_payment_method not in ('credito', 'debito', 'transferencia') then raise exception 'Medio de pago inválido'; end if;
  if coalesce(p_shipping_cost, -1) < 0 or coalesce(p_surcharge, -1) < 0 then raise exception 'Montos inválidos'; end if;

  -- Primera pasada: validar stock y calcular subtotal (bloqueando filas)
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item->>'qty')::integer, 1));
    select * into v_prod from public.products where products.id = (v_item->>'product_id')::uuid for update;
    if not found or v_prod.status <> 'publicado' then
      raise exception 'Un producto del carrito ya no está disponible';
    end if;
    if v_prod.stock < v_qty then
      raise exception 'Sin stock suficiente de "%": quedan % unidad(es)', v_prod.title, v_prod.stock;
    end if;
    v_subtotal := v_subtotal + v_prod.price * v_qty;
    v_count := v_count + 1;
    if v_first_title = '' then v_first_title := v_prod.title; end if;
  end loop;

  if v_subtotal <> p_subtotal then
    raise exception 'Los precios cambiaron mientras comprabas. Revisá el total y volvé a intentar.';
  end if;

  v_total := v_subtotal + p_shipping_cost + p_surcharge;

  -- Toda orden nace pendiente: tarjeta hasta que Mercado Pago acredite el
  -- pago (mp_apply_payment), transferencia hasta que se revise el comprobante.
  insert into public.orders (user_id, status, payment_method, installments, shipping_method, shipping_cost, surcharge, subtotal, total, customer, note)
  values (p_user, 'pendiente', p_payment_method, greatest(1, coalesce(p_installments, 1)), 'domicilio', p_shipping_cost, p_surcharge, v_subtotal, v_total, coalesce(p_customer, '{}'::jsonb), coalesce(p_note, ''))
  returning * into v_order;

  -- Segunda pasada: ítems y descuento de stock (se reserva mientras se cobra)
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item->>'qty')::integer, 1));
    select * into v_prod from public.products where products.id = (v_item->>'product_id')::uuid;
    insert into public.order_items (order_id, product_id, title, sku, image, unit_price, qty)
    values (v_order.id, v_prod.id, v_prod.title, v_prod.sku, v_prod.images[1], v_prod.price, v_qty);
    update public.products set stock = stock - v_qty where products.id = v_prod.id;
  end loop;

  insert into public.order_events (order_id, status, note) values (v_order.id, 'pendiente', 'Orden creada');

  -- Con tarjeta las notificaciones salen cuando Mercado Pago confirma el pago
  if p_payment_method = 'transferencia' then
    perform public.notify_admins('venta', 'shopping_cart', format('Nueva venta CS-%s', v_order.number),
      format('%s compró %s%s por $%s.', coalesce(p_customer->>'name', 'Un cliente'), v_first_title,
             case when v_count > 1 then format(' y %s más', v_count - 1) else '' end, to_char(v_total, 'FM999G999G999')),
      jsonb_build_object('view', 'ordenes', 'tab', 'ventas', 'order', v_order.id));
    perform public.notify_user(p_user, 'venta', 'shopping_bag', format('Recibimos tu pedido CS-%s', v_order.number),
      'Cuando revisemos tu comprobante de transferencia te avisamos por acá.',
      jsonb_build_object('order', v_order.id));
  end if;

  return query select v_order.id, v_order.number, v_order.status, v_order.total;
end $$;

-- Solo el backend: los montos vienen calculados por él
revoke all on function public.place_order(uuid, jsonb, text, jsonb, integer, integer, integer, integer, text) from public, anon, authenticated;
grant execute on function public.place_order(uuid, jsonb, text, jsonb, integer, integer, integer, integer, text) to service_role;
