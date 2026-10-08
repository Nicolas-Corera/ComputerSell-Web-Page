-- Bucket privado para archivos internos (firma de la nota de venta, etc.).
-- Solo lo leen los admins (URL firmada); los clientes con una nota de venta
-- reciben la firma de /api/firma (migración 0031). Se sube con `npm run firma`
-- usando la secret key.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('docs', 'docs', false, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = false;

drop policy if exists "docs auth read" on storage.objects;
