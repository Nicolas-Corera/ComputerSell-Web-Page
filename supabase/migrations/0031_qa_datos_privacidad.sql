-- QA pre-lanzamiento (08/10/2026): datos personales, privacidad y catálogo.
--
-- 1) seller_private(): cada quien recibe solo lo que necesita.
--    - cuenta para transferir (titular, CBU, alias): quien tiene un pedido por
--      transferencia pendiente de pago;
--    - nombre completo y DNI/CUIT (nota de venta): quien tiene una nota emitida;
--    - todo: administradores.
--    Antes alcanzaba con registrarse (el registro es libre).
-- 2) Firma manuscrita (bucket docs): solo la lee el panel. Los clientes con una
--    nota de venta la reciben de /api/firma (sin URLs firmadas de larga vida).
-- 3) Perfiles: el cliente solo puede editar sus datos (no created_at, id,
--    email ni role) y con largos máximos. El email se sincroniza con auth.
-- 4) Consentimiento de ofertas: por defecto NO (opt-in). Se corrigen las
--    cuentas que quedaron en true sin haberlo elegido (Google).
-- 5) Garantía mínima legal (Ley 24.240 art. 11): 6 meses en productos nuevos y
--    3 en usados. Se corrigen los productos cargados con menos.
-- 6) Permisos por defecto: anon/authenticated no necesitan TRUNCATE,
--    REFERENCES ni TRIGGER sobre ninguna tabla.

-- =====================================================================
--  1) Datos privados del vendedor
-- =====================================================================
create or replace function public.seller_private()
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  v_uid uuid := auth.uid();
  v_data jsonb;
  v_out jsonb := '{}'::jsonb;
begin
  if v_uid is null then return '{}'::jsonb; end if;
  select s.data into v_data from private.seller_info s where s.id;
  v_data := coalesce(v_data, '{}'::jsonb);
  if public.is_admin() then return v_data; end if;

  if exists (select 1 from public.orders o where o.user_id = v_uid and o.status = 'pendiente' and o.payment_method = 'transferencia') then
    v_out := v_out || jsonb_build_object('bank', jsonb_strip_nulls(jsonb_build_object(
      'holder', v_data->'bank'->'holder',
      'cbu', v_data->'bank'->'cbu',
      'alias', v_data->'bank'->'alias')));
  end if;
  if exists (select 1 from public.invoices i join public.orders o on o.id = i.order_id where o.user_id = v_uid and o.status <> 'cancelado') then
    v_out := v_out || jsonb_strip_nulls(jsonb_build_object('owner', v_data->'owner', 'doc', v_data->'doc'));
  end if;
  return v_out;
end $$;
revoke all on function public.seller_private() from public, anon;
grant execute on function public.seller_private() to authenticated;

-- =====================================================================
--  2) Firma (bucket docs)
-- =====================================================================
drop policy if exists "docs auth read" on storage.objects;
drop policy if exists "docs admin read" on storage.objects;
create policy "docs admin read" on storage.objects for select
  using (bucket_id = 'docs' and public.is_admin());

-- /api/firma: ¿la sesión puede ver la firma? (admin o una nota de venta vigente)
create or replace function public.can_view_signature()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    public.is_admin()
    or exists (select 1 from public.invoices i join public.orders o on o.id = i.order_id
               where o.user_id = auth.uid() and o.status <> 'cancelado')
  );
$$;
revoke all on function public.can_view_signature() from public, anon;
grant execute on function public.can_view_signature() to authenticated;

-- =====================================================================
--  3) Perfiles
-- =====================================================================
revoke update on public.profiles from anon, authenticated;
grant update (first_name, last_name, phone, address, avatar_url, marketing) on public.profiles to authenticated;

alter table public.profiles drop constraint if exists profiles_lengths_check;
alter table public.profiles add constraint profiles_lengths_check check (
  char_length(first_name) <= 60
  and char_length(last_name) <= 60
  and char_length(phone) <= 30
  and jsonb_typeof(address) = 'object'
  and length(address::text) <= 1500
) not valid;

alter table public.profiles drop constraint if exists profiles_avatar_url_check;
alter table public.profiles add constraint profiles_avatar_url_check check (
  avatar_url is null
  or (char_length(avatar_url) <= 500
      and (avatar_url ~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/avatars/'
           or avatar_url ~ '^https://[a-z0-9.-]+\.googleusercontent\.com/'))
) not valid;

-- El email del perfil sigue al de la cuenta (cambio confirmado en Auth). Un
-- cliente no lo puede cambiar por REST (sin permiso de columna y el trigger).
create or replace function public.protect_profile_role()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.role <> old.role and not public.is_admin()
     and (auth.uid() is not null or current_user in ('anon', 'authenticated')) then
    new.role := old.role;
  end if;
  if current_user in ('anon', 'authenticated') or current_setting('cs.sync_email', true) is distinct from 'on' then
    new.email := old.email;
  end if;
  return new;
end $$;

create or replace function public.sync_profile_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('cs.sync_email', 'on', true);
  update public.profiles set email = new.email where id = new.id;
  perform set_config('cs.sync_email', 'off', true);
  return new;
end $$;
revoke all on function public.sync_profile_email() from public, anon, authenticated;

drop trigger if exists on_auth_user_email_change on auth.users;
create trigger on_auth_user_email_change
  after update of email on auth.users
  for each row when (old.email is distinct from new.email and new.email is not null)
  execute function public.sync_profile_email();

-- =====================================================================
--  4) Ofertas por correo: opt-in
-- =====================================================================
alter table public.profiles alter column marketing set default false;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  full_name text := coalesce(meta->>'full_name', meta->>'name', '');
  fn text := left(coalesce(meta->>'first_name', split_part(full_name, ' ', 1), ''), 60);
  ln text := left(coalesce(meta->>'last_name', nullif(regexp_replace(full_name, '^\S+\s*', ''), ''), ''), 60);
  is_allowed boolean := new.email_confirmed_at is not null
    and exists (select 1 from public.admin_allowlist a where lower(a.email) = lower(new.email));
begin
  insert into public.profiles (id, email, first_name, last_name, phone, avatar_url, role, marketing)
  values (
    new.id,
    new.email,
    fn, ln,
    left(coalesce(meta->>'phone', ''), 30),
    nullif(left(coalesce(meta->>'avatar_url', meta->>'picture', ''), 500), ''),
    case when is_allowed then 'admin' else 'customer' end,
    coalesce((meta->>'marketing')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from private.data_fixes where name = '0031_marketing_opt_in') then
    -- Quien entró con Google nunca vio la casilla de ofertas
    update public.profiles p set marketing = false
    from auth.users u
    where u.id = p.id and p.marketing
      and coalesce(u.raw_user_meta_data->>'marketing', '') = '';
    insert into private.data_fixes (name) values ('0031_marketing_opt_in');
  end if;
end $$;

-- =====================================================================
--  5) Garantía mínima legal
-- =====================================================================
create or replace function public.warranty_months(p_value integer, p_unit text)
returns numeric language sql immutable set search_path = public as $$
  select case coalesce(p_unit, 'meses')
    when 'dias' then coalesce(p_value, 0) / 30.0
    when 'anios' then coalesce(p_value, 0) * 12.0
    else coalesce(p_value, 0)::numeric end;
$$;

update public.products
  set warranty = 6, warranty_unit = 'meses'
  where coalesce(condition, 'nuevo') = 'nuevo' and public.warranty_months(warranty, warranty_unit) < 6;
update public.products
  set warranty = 3, warranty_unit = 'meses'
  where coalesce(condition, 'nuevo') <> 'nuevo' and public.warranty_months(warranty, warranty_unit) < 3;

create or replace function public.products_check_warranty()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(new.condition, 'nuevo') = 'nuevo' and public.warranty_months(new.warranty, new.warranty_unit) < 6 then
    raise exception 'La garantía de un producto nuevo no puede ser menor a 6 meses (Ley 24.240, art. 11).';
  end if;
  if coalesce(new.condition, 'nuevo') <> 'nuevo' and public.warranty_months(new.warranty, new.warranty_unit) < 3 then
    raise exception 'La garantía de un producto usado no puede ser menor a 3 meses (Ley 24.240, art. 11).';
  end if;
  return new;
end $$;
revoke all on function public.products_check_warranty() from public, anon, authenticated;

drop trigger if exists products_check_warranty on public.products;
create trigger products_check_warranty
  before insert or update of warranty, warranty_unit, condition on public.products
  for each row execute function public.products_check_warranty();

-- =====================================================================
--  6) Permisos por defecto
-- =====================================================================
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
