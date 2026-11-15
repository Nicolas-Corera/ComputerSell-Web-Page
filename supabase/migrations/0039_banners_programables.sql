-- Imágenes y banners de la tienda que se cargan y programan desde el panel
-- (Tienda -> Imágenes y banners).
--
-- Cada lugar de la página tiene un id fijo ("slot", ver
-- assets/js/config/banner-slots.js). Para un slot se cargan varias imágenes,
-- cada una con una vigencia (desde / hasta) y se muestra la que esté vigente
-- ahora. Si ninguna lo está, la tienda deja la imagen que trae su HTML. Un
-- admin puede apagar una entrada a mano con "enabled" sin borrarla.
--
-- Los archivos van al bucket público "banners" (la tienda los sirve por su URL
-- pública; nadie puede listarlo, igual que products y avatars en 0024).

-- =====================================================================
--  Bucket
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('banners', 'banners', true, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "banners admin write" on storage.objects;
create policy "banners admin write" on storage.objects for all
  using (bucket_id = 'banners' and public.is_admin())
  with check (bucket_id = 'banners' and public.is_admin());

-- =====================================================================
--  Tabla
-- =====================================================================
create table if not exists public.store_banners (
  id uuid primary key default gen_random_uuid(),
  slot text not null check (slot ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slot) <= 40),
  -- Rutas dentro del bucket "banners" (nada de ".." ni de URLs externas)
  image_path text not null check (image_path ~ '^[a-z0-9][a-z0-9._/-]{0,200}$' and image_path !~ '\.\.'),
  mobile_path text check (mobile_path is null or (mobile_path ~ '^[a-z0-9][a-z0-9._/-]{0,200}$' and mobile_path !~ '\.\.')),
  -- Solo rutas del propio sitio ("/productos?...") o https: nunca javascript: ni "//otro-sitio"
  link text check (link is null or link ~ '^(/([^/[:space:]\\][^[:space:]\\]*)?|https://[^[:space:]\\]+)$'),
  alt text not null default '' check (length(alt) <= 200),
  starts_at timestamptz,
  ends_at timestamptz,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index if not exists store_banners_slot_idx on public.store_banners (slot);

alter table public.store_banners enable row level security;
revoke all on public.store_banners from public, anon, authenticated;
grant select on public.store_banners to anon, authenticated;
grant insert, update, delete on public.store_banners to authenticated;

-- La tienda solo ve las activadas; el admin ve todas (para editarlas)
drop policy if exists store_banners_read on public.store_banners;
create policy store_banners_read on public.store_banners for select using (enabled or public.is_admin());
drop policy if exists store_banners_admin_write on public.store_banners;
create policy store_banners_admin_write on public.store_banners for all
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.store_banners_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
revoke all on function public.store_banners_stamp() from public, anon, authenticated;
drop trigger if exists store_banners_stamp on public.store_banners;
create trigger store_banners_stamp before insert or update on public.store_banners
  for each row execute function public.store_banners_stamp();

-- La tienda abierta y el panel se enteran al instante de un cambio
alter table public.store_banners replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'store_banners') then
    alter publication supabase_realtime add table public.store_banners;
  end if;
end $$;
