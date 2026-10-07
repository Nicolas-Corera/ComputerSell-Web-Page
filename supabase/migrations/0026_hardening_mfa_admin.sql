-- Endurecimiento general (lo que marca el Security Advisor de Supabase) y
-- verificación en dos pasos (2FA) obligatoria para administrar.

-- 1) Funciones de trigger: no tienen que poder llamarse por /rest/v1/rpc.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.promote_allowlisted() from public, anon, authenticated;
revoke all on function public.on_receipt_insert() from public, anon, authenticated;
revoke all on function public.on_stock_change() from public, anon, authenticated;

-- 2) Acciones de clientes/admins: anon no las necesita (ya validaban adentro).
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
revoke all on function public.review_receipt(uuid, boolean) from public, anon;
revoke all on function public.set_order_status(uuid, text, text, text) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.review_receipt(uuid, boolean) to authenticated;
grant execute on function public.set_order_status(uuid, text, text, text) to authenticated;

-- 3) search_path fijo (evita que un objeto con el mismo nombre en otro schema
--    se use en lugar del de public).
alter function public.set_updated_at() set search_path = public;
alter function public.protect_profile_role() set search_path = public;
alter function public.receipt_object_order(text) set search_path = public;
alter function public.receipts_reset_review_columns() set search_path = public;

-- 4) 2FA para administrar: is_admin() exige una sesión verificada con el
--    segundo factor (aal2). Con solo la contraseña de un admin (robada,
--    filtrada o adivinada) no se puede leer ni cambiar nada del panel: todas
--    las políticas y RPC de admin pasan por is_admin().
--    anon la sigue pudiendo ejecutar porque la usan las políticas (products).
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
     and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- 5) Estado de seguridad de la cuenta propia (el navegador no puede leer
--    auth.users): si tiene contraseña (después de confirmar el correo se borra
--    hasta que la elija, migración 0025) y con qué proveedor entró.
create or replace function public.account_security()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'has_password', coalesce(u.encrypted_password, '') <> '',
    'provider', coalesce(u.raw_app_meta_data->>'provider', 'email')
  )
  from auth.users u where u.id = auth.uid();
$$;
revoke all on function public.account_security() from public, anon;
grant execute on function public.account_security() to authenticated;

-- 6) Acaparamiento de stock: un pedido por transferencia reserva stock hasta
--    que se paga o se cancela a mano. Con una cuenta se podían crear pedidos
--    sin pagar hasta agotar el catálogo. Máximo 2 pendientes por cliente a la
--    vez (lo aplica la base, así que vale para cualquier camino que cree órdenes).
create or replace function public.orders_limit_pending_transfers()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.payment_method = 'transferencia' and new.status = 'pendiente' and (
    select count(*) from public.orders o
    where o.user_id = new.user_id and o.payment_method = 'transferencia' and o.status = 'pendiente'
  ) >= 2 then
    raise exception 'Ya tenés 2 pedidos por transferencia esperando la confirmación del pago. Cuando los confirmemos vas a poder hacer otro; si lo necesitás antes, escribinos por WhatsApp.';
  end if;
  return new;
end $$;
revoke all on function public.orders_limit_pending_transfers() from public, anon, authenticated;

drop trigger if exists orders_limit_pending_transfers on public.orders;
create trigger orders_limit_pending_transfers
  before insert on public.orders
  for each row execute function public.orders_limit_pending_transfers();
