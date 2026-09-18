-- Mercado Pago (Checkout API / Orders): el pago con tarjeta deja de ser una
-- simulación. La orden con tarjeta nace "pendiente" y la confirma el backend
-- (api/mp/pay.js o api/mp/webhook.js) con mp_apply_payment según lo que
-- responda Mercado Pago. La transferencia sigue igual (comprobante + revisión).

alter table public.orders
  add column if not exists mp_order_id text,
  add column if not exists payment jsonb not null default '{}'::jsonb; -- {provider, mp_order_id, mp_payment_id, status, status_detail, method_id, type, brand, last_four, installments}
create index if not exists orders_mp_order_idx on public.orders (mp_order_id);

-- =====================================================================
--  RPC: crear orden (tarjeta: queda pendiente hasta que MP confirme)
-- =====================================================================
create or replace function public.place_order(
  p_items jsonb,            -- [{product_id, qty}]
  p_payment_method text,
  p_shipping_method text,
  p_customer jsonb,
  p_installments integer default 1,
  p_note text default ''
)
returns table (id uuid, number integer, status text, total integer)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_prod public.products%rowtype;
  v_qty integer;
  v_subtotal integer := 0;
  v_shipping integer := 0;
  v_rate numeric := 0;
  v_surcharge integer := 0;
  v_total integer := 0;
  v_order public.orders%rowtype;
  v_all_free boolean := true;
  v_first_title text := '';
  v_count integer := 0;
begin
  if v_uid is null then raise exception 'Tenés que iniciar sesión para comprar'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'El carrito está vacío'; end if;
  if p_payment_method not in ('credito', 'debito', 'transferencia', 'mercadopago') then raise exception 'Medio de pago inválido'; end if;

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
    v_all_free := v_all_free and v_prod.free_shipping;
    v_count := v_count + 1;
    if v_first_title = '' then v_first_title := v_prod.title; end if;
  end loop;

  v_shipping := case when p_shipping_method = 'retiro' or v_all_free then 0 else 15000 end;
  v_rate := case p_payment_method when 'credito' then 0.10 when 'debito' then 0.03 when 'mercadopago' then 0.05 else 0 end;
  v_surcharge := round(v_subtotal * v_rate);
  v_total := v_subtotal + v_shipping + v_surcharge;

  -- Toda orden nace pendiente: tarjeta hasta que Mercado Pago acredite el
  -- pago (mp_apply_payment), transferencia hasta que se revise el comprobante.
  insert into public.orders (user_id, status, payment_method, installments, shipping_method, shipping_cost, surcharge, subtotal, total, customer, note)
  values (v_uid, 'pendiente', p_payment_method, greatest(1, coalesce(p_installments, 1)), coalesce(p_shipping_method, 'domicilio'), v_shipping, v_surcharge, v_subtotal, v_total, coalesce(p_customer, '{}'::jsonb), coalesce(p_note, ''))
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
    perform public.notify_user(v_uid, 'venta', 'shopping_bag', format('Recibimos tu pedido CS-%s', v_order.number),
      'Cuando revisemos tu comprobante de transferencia te avisamos por acá.',
      jsonb_build_object('order', v_order.id));
  end if;

  return query select v_order.id, v_order.number, v_order.status, v_order.total;
end $$;

-- =====================================================================
--  RPC: aplicar el resultado de Mercado Pago a la orden (solo backend)
--  Idempotente: el webhook puede repetirse y el backend llamarla varias veces.
--  p_status es el status de la order de MP: processed | processing |
--  action_required | in_review | failed | canceled | expired | refunded | charged_back
-- =====================================================================
create or replace function public.mp_apply_payment(
  p_order uuid,
  p_mp_order_id text,
  p_status text,
  p_status_detail text default '',
  p_payment jsonb default '{}'::jsonb
)
returns table (id uuid, number integer, status text, total integer)
language plpgsql security definer set search_path = public as $$
declare
  v_o public.orders%rowtype;
  v_it record;
  v_card text;
  v_first_title text := '';
  v_count integer := 0;
  v_last text;
begin
  select * into v_o from public.orders where orders.id = p_order for update;
  if not found then raise exception 'Orden inexistente'; end if;

  -- Snapshot del pago (marca, últimos 4, ids de MP, estado)
  update public.orders
    set mp_order_id = coalesce(p_mp_order_id, mp_order_id),
        payment = payment || coalesce(p_payment, '{}'::jsonb) || jsonb_build_object('provider', 'mercadopago', 'status', p_status, 'status_detail', coalesce(p_status_detail, ''))
    where orders.id = p_order
    returning * into v_o;

  v_card := trim(concat_ws(' ', nullif(v_o.payment->>'brand', ''), case when coalesce(v_o.payment->>'last_four', '') <> '' then '•••• ' || (v_o.payment->>'last_four') end));
  v_card := case when v_card <> '' then 'Mercado Pago · ' || v_card else 'Mercado Pago' end;

  if p_status = 'processed' then
    if v_o.status = 'pendiente' then
      update public.orders set status = 'pagado', paid_at = coalesce(paid_at, now()) where orders.id = p_order;
      insert into public.order_events (order_id, status, note) values (p_order, 'pagado', 'Pago acreditado (' || v_card || ')');
      perform public.issue_invoice(p_order);

      select count(*) into v_count from public.order_items where order_id = p_order;
      select title into v_first_title from public.order_items where order_id = p_order limit 1;
      perform public.notify_admins('venta', 'shopping_cart', format('Nueva venta CS-%s', v_o.number),
        format('%s compró %s%s por $%s.', coalesce(v_o.customer->>'name', 'Un cliente'), v_first_title,
               case when v_count > 1 then format(' y %s más', v_count - 1) else '' end, to_char(v_o.total, 'FM999G999G999')),
        jsonb_build_object('view', 'ordenes', 'tab', 'ventas', 'order', p_order));
      perform public.notify_user(v_o.user_id, 'venta', 'shopping_bag', format('Recibimos tu pedido CS-%s', v_o.number),
        'El pago se acreditó. Ya estamos preparando tu compra.', jsonb_build_object('order', p_order));
    elsif v_o.status = 'cancelado' then
      -- Se canceló acá (timeout, etc.) pero MP terminó cobrando: hay que reembolsar
      insert into public.order_events (order_id, status, note) values (p_order, 'cancelado', 'Mercado Pago acreditó el pago de una orden cancelada: reembolsar desde el panel de Mercado Pago');
      perform public.notify_admins('pago', 'error', format('Revisar pago · CS-%s', v_o.number),
        'Mercado Pago acreditó un pago sobre una orden cancelada. Hay que reembolsarlo.',
        jsonb_build_object('view', 'ordenes', 'tab', 'ventas', 'order', p_order));
    end if;

  elsif p_status in ('failed', 'canceled', 'expired') then
    if v_o.status = 'pendiente' then
      update public.orders set status = 'cancelado' where orders.id = p_order;
      for v_it in select product_id, qty from public.order_items where order_id = p_order and product_id is not null loop
        update public.products set stock = stock + v_it.qty where products.id = v_it.product_id;
      end loop;
      insert into public.order_events (order_id, status, note)
      values (p_order, 'cancelado', case p_status when 'failed' then 'Pago rechazado' when 'expired' then 'Pago vencido' else 'Pago cancelado' end
                                    || case when coalesce(p_status_detail, '') <> '' then ' (' || p_status_detail || ')' else '' end);
    end if;

  elsif p_status = 'refunded' then
    -- Reembolso hecho desde Mercado Pago: se cancela la orden y sale la nota de crédito
    if v_o.status not in ('cancelado') then
      update public.orders set status = 'cancelado' where orders.id = p_order;
      for v_it in select product_id, qty from public.order_items where order_id = p_order and product_id is not null loop
        update public.products set stock = stock + v_it.qty where products.id = v_it.product_id;
      end loop;
      insert into public.order_events (order_id, status, note) values (p_order, 'cancelado', 'Pago reembolsado desde Mercado Pago');
      if v_o.status <> 'pendiente' then
        insert into public.invoices (order_id, number, type, total, cae)
        values (p_order, 'NC-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0'), 'NC', v_o.total, '');
      end if;
      perform public.notify_user(v_o.user_id, 'pedido', 'local_shipping', format('Pedido CS-%s: Tu pedido fue cancelado', v_o.number),
        'El pago fue reembolsado a tu medio de pago.', jsonb_build_object('order', p_order));
    end if;

  elsif p_status = 'charged_back' then
    insert into public.order_events (order_id, status, note) values (p_order, v_o.status, 'Contracargo en Mercado Pago (' || coalesce(p_status_detail, '') || ')');
    perform public.notify_admins('pago', 'error', format('Contracargo · CS-%s', v_o.number),
      'El cliente desconoció el pago en Mercado Pago. Revisá el caso desde el panel de Mercado Pago.',
      jsonb_build_object('view', 'ordenes', 'tab', 'ventas', 'order', p_order));

  else
    -- processing / action_required / in_review / created: sigue pendiente (se anota una sola vez)
    select note into v_last from public.order_events where order_id = p_order order by created_at desc limit 1;
    if v_o.status = 'pendiente' and coalesce(v_last, '') not like 'Pago en proceso%' then
      insert into public.order_events (order_id, status, note) values (p_order, 'pendiente', 'Pago en proceso en Mercado Pago' || case when coalesce(p_status_detail, '') <> '' then ' (' || p_status_detail || ')' else '' end);
    end if;
  end if;

  return query select o.id, o.number, o.status, o.total from public.orders o where o.id = p_order;
end $$;

revoke all on function public.mp_apply_payment(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mp_apply_payment(uuid, text, text, text, jsonb) to service_role;
