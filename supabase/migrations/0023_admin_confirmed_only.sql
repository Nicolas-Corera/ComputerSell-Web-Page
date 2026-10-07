-- Seguridad:
-- 1) is_admin_email() la podía llamar cualquiera (anon) y respondía si un
--    correo estaba en admin_allowlist: servía para averiguar los correos de
--    los administradores probando de a uno. Se elimina; el alta del panel
--    ya no pregunta antes (auth.js) y finish() revisa el rol al iniciar sesión.
-- 2) Un correo de la allowlist pasaba a admin apenas se creaba la cuenta,
--    aunque nadie hubiera probado que era suyo. Ahora solo se promueve con el
--    correo confirmado: al alta si ya llega confirmado (Google) o cuando se
--    confirma (enlace del correo). Va junto con mailer_autoconfirm = false.
drop function if exists public.is_admin_email(text);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  full_name text := coalesce(meta->>'full_name', meta->>'name', '');
  fn text := coalesce(meta->>'first_name', split_part(full_name, ' ', 1), '');
  ln text := coalesce(meta->>'last_name', nullif(regexp_replace(full_name, '^\S+\s*', ''), ''), '');
  is_allowed boolean := new.email_confirmed_at is not null
    and exists (select 1 from public.admin_allowlist a where lower(a.email) = lower(new.email));
begin
  insert into public.profiles (id, email, first_name, last_name, phone, avatar_url, role, marketing)
  values (
    new.id,
    new.email,
    fn, ln,
    coalesce(meta->>'phone', ''),
    coalesce(meta->>'avatar_url', meta->>'picture'),
    case when is_allowed then 'admin' else 'customer' end,
    coalesce((meta->>'marketing')::boolean, true)
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Alta en la allowlist: solo cuentas ya confirmadas
create or replace function public.promote_allowlisted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles p set role = 'admin'
  from auth.users u
  where u.id = p.id and lower(p.email) = lower(new.email) and u.email_confirmed_at is not null;
  return new;
end $$;

-- Confirmación del correo: si está en la allowlist, pasa a admin
create or replace function public.promote_on_confirm()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.admin_allowlist a where lower(a.email) = lower(new.email)) then
    update public.profiles set role = 'admin' where id = new.id;
  end if;
  return new;
end $$;
revoke all on function public.promote_on_confirm() from public, anon, authenticated;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.promote_on_confirm();
