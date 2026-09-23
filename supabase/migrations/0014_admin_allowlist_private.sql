-- Seguridad: admin_allowlist se podía leer entera con la anon key, así que
-- cualquiera obtenía los correos de todos los administradores. El alta del
-- panel solo necesita saber si UN correo está habilitado: se reemplaza la
-- lectura de la tabla por un RPC que devuelve un booleano.
drop policy if exists allowlist_read on public.admin_allowlist;
revoke all on public.admin_allowlist from anon, authenticated;

create or replace function public.is_admin_email(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_allowlist a where lower(a.email) = lower(trim(coalesce(p_email, ''))));
$$;
revoke all on function public.is_admin_email(text) from public;
grant execute on function public.is_admin_email(text) to anon, authenticated;
