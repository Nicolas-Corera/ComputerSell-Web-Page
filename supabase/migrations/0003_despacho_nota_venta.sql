-- El flujo termina en "enviado" (Despachado): se quita "entregado".
-- Código de seguimiento del correo en la orden y "Nota de venta" (NV) como
-- comprobante propio en lugar de Factura A/B/C.

alter table public.orders drop constraint if exists orders_status_check;
update public.orders set status = 'enviado' where status = 'entregado';
alter table public.orders add constraint orders_status_check
  check (status in ('pendiente', 'pagado', 'preparando', 'enviado', 'cancelado'));
alter table public.orders add column if not exists tracking text not null default '';

alter table public.invoices drop constraint if exists invoices_type_check;
update public.invoices set type = 'NV', number = 'NV-' || lpad(ltrim(regexp_replace(number, '^.*-', ''), '0'), 6, '0') where type in ('A', 'B', 'C') or number ~ '^[ABC]-';
alter table public.invoices add constraint invoices_type_check check (type in ('NV', 'NC'));

-- Nota de venta correlativa: NV-000001
create or replace function public.issue_invoice(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_n bigint;
begin
  select * into v_o from public.orders where orders.id = p_order;
  if not found or exists (select 1 from public.invoices where order_id = p_order and type <> 'NC') then return; end if;
  v_n := nextval('public.invoice_number_seq');
  insert into public.invoices (order_id, number, type, total, cae)
  values (p_order, 'NV-' || lpad(v_n::text, 6, '0'), 'NV', v_o.total, '');
end $$;

drop function if exists public.set_order_status(uuid, text, text);
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
    if v_o.status <> 'pendiente' then
      insert into public.invoices (order_id, number, type, total, cae)
      values (p_order, 'NC-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0'), 'NC', v_o.total, '');
    end if;
  end if;

  perform public.notify_user(v_o.user_id, 'pedido', 'local_shipping', format('Pedido CS-%s: %s', v_o.number, v_labels->>p_status),
    case when p_status = 'enviado' and coalesce(p_tracking, v_o.tracking) <> '' then 'Código de seguimiento: ' || coalesce(p_tracking, v_o.tracking)
         else coalesce(nullif(p_note, ''), '') end,
    jsonb_build_object('order', p_order));
end $$;
grant execute on function public.set_order_status(uuid, text, text, text) to authenticated;
