-- Seguridad: notify_admins y notify_user son helpers internos (SECURITY
-- DEFINER) y nunca se revocaron, así que PostgREST los exponía como RPC a anon
-- y a cualquier cliente (avisos falsos al panel y a otros usuarios).
-- Mismo patrón que mp_apply_payment. Quienes los llaman (place_order,
-- set_order_status, review_receipt, mp_apply_payment, request_revocation y los
-- triggers on_receipt_insert / on_stock_change) son SECURITY DEFINER del dueño
-- de las funciones y siguen pudiendo ejecutarlos.
revoke all on function public.notify_admins(text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.notify_user(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.notify_admins(text, text, text, text, jsonb) to service_role;
grant execute on function public.notify_user(uuid, text, text, text, text, jsonb) to service_role;
