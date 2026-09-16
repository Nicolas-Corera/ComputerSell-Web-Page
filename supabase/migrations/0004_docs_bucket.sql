-- Bucket privado para archivos internos (firma de la nota de venta, etc.).
-- Solo usuarios con sesión pueden leerlo (vía URL firmada); se sube con
-- `npm run firma` usando la secret key.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('docs', 'docs', false, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = false;

drop policy if exists "docs auth read" on storage.objects;
create policy "docs auth read" on storage.objects for select
  using (bucket_id = 'docs' and auth.role() = 'authenticated');
