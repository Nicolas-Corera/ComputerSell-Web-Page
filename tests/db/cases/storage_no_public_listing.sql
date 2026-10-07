-- [LOW] Los buckets públicos products y avatars se podían listar con la anon
-- key (ids de usuarios con foto y de productos sin publicar). Migración 0024.
-- Regresión: anon y clientes no ven los objetos ajenos; el admin sigue
-- viendo los de products y cada usuario los de su carpeta de avatars.

select sandbox.as_operator();
insert into storage.objects (bucket_id, name) values
  ('products', '11111111-1111-4111-8111-111111111111/foto.webp'),
  ('avatars', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/avatar.png'),
  ('avatars', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/avatar.png');

select sandbox.as_anon();
select test.ok((select count(*) from storage.objects where bucket_id in ('products', 'avatars')) = 0, 'anon no puede listar products ni avatars');

select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select test.ok((select count(*) from storage.objects where bucket_id = 'products') = 0, 'un cliente no puede listar products');
select test.ok((select array_agg(name) from storage.objects where bucket_id = 'avatars') = array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/avatar.png'], 'un cliente solo ve su propio avatar');

select sandbox.as_user('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select test.ok((select count(*) from storage.objects where bucket_id = 'products') = 1, 'el admin sigue viendo products (para reemplazar y borrar fotos)');
