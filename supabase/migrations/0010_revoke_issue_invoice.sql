-- Seguridad: issue_invoice (SECURITY DEFINER) se podía llamar como RPC desde
-- cualquier cliente, incluso anon, y emitía una nota de venta para pedidos sin
-- pagar. Solo la usan set_order_status y mp_apply_payment (ambas SECURITY
-- DEFINER, siguen pudiendo ejecutarla). Además, como defensa en profundidad,
-- solo emite la nota si el pedido ya está pagado.
create or replace function public.issue_invoice(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_n bigint;
begin
  select * into v_o from public.orders where orders.id = p_order;
  if not found or v_o.status <> 'pagado' or exists (select 1 from public.invoices where order_id = p_order and type <> 'NC') then return; end if;
  v_n := nextval('public.invoice_number_seq');
  insert into public.invoices (order_id, number, type, total, cae)
  values (p_order, 'NV-' || lpad(v_n::text, 6, '0'), 'NV', v_o.total, '');
end $$;

revoke all on function public.issue_invoice(uuid) from public, anon, authenticated;
grant execute on function public.issue_invoice(uuid) to service_role;
