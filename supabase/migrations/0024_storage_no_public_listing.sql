-- Seguridad: las políticas "products public read" y "avatars public read"
-- (select para todos) permitían LISTAR los buckets con la anon key: se veían
-- los ids de todos los usuarios con foto (carpetas de avatars) y los de
-- productos sin publicar (carpetas de products).
-- Los buckets son públicos, así que las imágenes se siguen sirviendo por su
-- URL pública (/storage/v1/object/public/...) sin pasar por RLS. Subir, borrar
-- y reemplazar siguen cubiertos por "products admin write" y "avatars own write".
drop policy if exists "products public read" on storage.objects;
drop policy if exists "avatars public read" on storage.objects;
