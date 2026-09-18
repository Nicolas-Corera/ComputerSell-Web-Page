-- Sin nota de crédito: un pedido cancelado no tiene comprobante. Al cancelar
-- (desde el panel o por reembolso en Mercado Pago) se borra la nota de venta
-- del pedido y no se emite nada. Las NC que existían se eliminan.

delete from public.invoices where type = 'NC';
delete from public.invoices where order_id in (select id from public.orders where status = 'cancelado');
alter table public.invoices drop constraint if exists invoices_type_check;
alter table public.invoices add constraint invoices_type_check check (type in ('NV'));

create or replace function public.set_order_status(p_order uuid, p_status text, p_note text default '', p_tracking text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_it record;
  v_labels jsonb := '{"pagado":"Pago confirmado","preparando":"Tu pedido está en preparación","enviado":"Tu pedido fue despachado","cancelado":"Tu pedido fue cancelado"}';
begin
  if not public.is_admin() then raise exception 'Solo administradores'; end if;
  select * into v_o from public.orders where orders.id = p_order for update;
  if not found then raise exception 'Orden inexistente'; end if;
  if p_status not in ('pendiente', 'pagado', 'preparando', 'enviado', 'cancelado') then raise exception 'Estado inválido'; end if;
  if v_o.status = p_status then
    if p_tracking is not null then update public.orders set tracking = p_tracking where orders.id = p_order; end if;
    return;
  end if;
  if v_o.status in ('cancelado', 'enviado') then raise exception 'La orden ya está cerrada'; end if;

  update public.orders set status = p_status,
    tracking = coalesce(p_tracking, tracking),
    paid_at = case when p_status = 'pagado' and paid_at is null then now() else paid_at end
    where orders.id = p_order;
  insert into public.order_events (order_id, status, note) values (p_order, p_status, coalesce(p_note, ''));

  if p_status = 'pagado' then perform public.issue_invoice(p_order); end if;

  if p_status = 'cancelado' then
    for v_it in select product_id, qty from public.order_items where order_id = p_order and product_id is not null loop
      update public.products set stock = stock + v_it.qty where products.id = v_it.product_id;
    end loop;
    -- Un pedido cancelado no tiene comprobante: se quita la nota de venta
    delete from public.invoices where order_id = p_order;
  end if;

  perform public.notify_user(v_o.user_id, 'pedido', 'local_shipping', format('Pedido CS-%s: %s', v_o.number, v_labels->>p_status),
    case when p_status = 'enviado' and coalesce(p_tracking, v_o.tracking) <> '' then 'Código de seguimiento: ' || coalesce(p_tracking, v_o.tracking)
         else coalesce(nullif(p_note, ''), '') end,
    jsonb_build_object('order', p_order));
end $$;

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
      delete from public.invoices where order_id = p_order;
    end if;

  elsif p_status = 'refunded' then
    -- Reembolso hecho desde Mercado Pago: se cancela la orden (sin comprobante)
    if v_o.status not in ('cancelado') then
      update public.orders set status = 'cancelado' where orders.id = p_order;
      for v_it in select product_id, qty from public.order_items where order_id = p_order and product_id is not null loop
        update public.products set stock = stock + v_it.qty where products.id = v_it.product_id;
      end loop;
      insert into public.order_events (order_id, status, note) values (p_order, 'cancelado', 'Pago reembolsado desde Mercado Pago');
      delete from public.invoices where order_id = p_order;
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

