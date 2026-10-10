-- 1) Modo mantenimiento de la tienda (panel -> Tienda).
--    Una sola fila en public.store_settings. La lee middleware.ts en cada
--    pedido a la tienda (anon key) y, si está activo, todo el dominio de la
--    tienda redirige a /mantenimiento. Solo un admin la puede cambiar. Además
--    la base no acepta pedidos nuevos mientras está activo (aunque alguien
--    llame a la API o a place_order directo).
-- 2) Comprobantes de transferencia verificados por el servidor.
--    El navegador valida el archivo, pero eso se puede saltear subiendo
--    directo al bucket. Ahora api/orders/receipt revisa el contenido real del
--    archivo (estructura PDF/PNG/JPG, sin scripts ni archivos embebidos) con
--    el service role y lo anota en private.receipt_scans. La regla que obliga
--    a pasar por esa revisión está en 0034 (se aplica después de publicar el
--    sitio nuevo: el anterior registra el comprobante sin llamar a la API).

-- =====================================================================
--  1) Mantenimiento
-- =====================================================================
create table if not exists public.store_settings (
  id boolean primary key default true check (id),
  maintenance boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
insert into public.store_settings (id) values (true) on conflict (id) do nothing;

alter table public.store_settings enable row level security;
revoke all on public.store_settings from public, anon, authenticated;
grant select on public.store_settings to anon, authenticated;
grant update (maintenance) on public.store_settings to authenticated;

drop policy if exists store_settings_read on public.store_settings;
create policy store_settings_read on public.store_settings for select using (true);
drop policy if exists store_settings_admin_update on public.store_settings;
create policy store_settings_admin_update on public.store_settings for update
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.store_settings_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.id := true;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
revoke all on function public.store_settings_stamp() from public, anon, authenticated;
drop trigger if exists store_settings_stamp on public.store_settings;
create trigger store_settings_stamp before update on public.store_settings
  for each row execute function public.store_settings_stamp();

-- Para la tienda y otros servicios: ¿está en mantenimiento?
create or replace function public.store_in_maintenance()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select maintenance from public.store_settings where id), false);
$$;
grant execute on function public.store_in_maintenance() to anon, authenticated;

-- Sin pedidos nuevos en mantenimiento (place_order corre con el service role:
-- no es admin). Un admin desde el panel sí puede cargar uno a mano.
create or replace function public.orders_block_in_maintenance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.store_in_maintenance() and not public.is_admin() then
    raise exception 'La tienda está en mantenimiento. Volvé a intentar en un rato.';
  end if;
  return new;
end $$;
revoke all on function public.orders_block_in_maintenance() from public, anon, authenticated;
drop trigger if exists orders_block_in_maintenance on public.orders;
create trigger orders_block_in_maintenance before insert on public.orders
  for each row execute function public.orders_block_in_maintenance();

-- El panel se entera al instante si otro admin lo cambia
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'store_settings') then
    alter publication supabase_realtime add table public.store_settings;
  end if;
end $$;

-- =====================================================================
--  2) Comprobantes verificados por el servidor
-- =====================================================================
create schema if not exists private;
create table if not exists private.receipt_scans (
  file_path text primary key,
  sha256 text not null,
  checked_at timestamptz not null default now()
);
revoke all on private.receipt_scans from public, anon, authenticated;

-- Solo la llama api/orders/receipt (service role) después de revisar el archivo
create or replace function public.mark_receipt_verified(p_path text, p_sha256 text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_path !~* '^[0-9a-f-]{36}/[0-9a-f-]{36}-[0-9]{10,16}\.(pdf|png|jpg)$' or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Archivo inválido';
  end if;
  insert into private.receipt_scans (file_path, sha256) values (p_path, p_sha256)
    on conflict (file_path) do update set sha256 = excluded.sha256, checked_at = now();
end $$;
revoke all on function public.mark_receipt_verified(text, text) from public, anon, authenticated;
grant execute on function public.mark_receipt_verified(text, text) to service_role;
