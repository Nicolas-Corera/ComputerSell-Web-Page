-- Imágenes y banners programables (migración 0039).
-- Regresión: solo un admin crea, cambia o borra banners y sube al bucket;
-- el público solo ve los activados; no se aceptan links peligrosos ni rutas
-- fuera del bucket.

select sandbox.as_user('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
insert into public.store_banners (slot, image_path, link, alt, starts_at, ends_at)
values ('home-promo', 'home-promo/a.webp', '/productos?disponibilidad=oferta', 'Oferta', now() - interval '1 day', now() + interval '1 day');
insert into public.store_banners (slot, image_path, enabled) values ('home-hero', 'home-hero/b.webp', false);
select test.ok((select count(*) from public.store_banners) = 2, 'el admin ve todos los banners');

select sandbox.as_anon();
select test.ok((select count(*) from public.store_banners) = 1, 'anon solo ve los activados');
select test.fails($$insert into public.store_banners (slot, image_path) values ('home-promo', 'x/y.webp')$$, 'permission denied|row-level security', 'anon no puede crear banners');
select test.fails($$update public.store_banners set alt = 'hack'$$, 'permission denied|row-level security', 'anon no puede cambiar banners');

select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select test.fails($$insert into public.store_banners (slot, image_path) values ('home-promo', 'x/y.webp')$$, 'row-level security', 'un cliente no puede crear banners');
select test.ok((select count(*) from public.store_banners) = 1, 'un cliente solo ve los activados');
select test.ok(
  (with d as (delete from public.store_banners returning 1) select count(*) from d) = 0,
  'un cliente no puede borrar banners');

select sandbox.as_user('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select test.fails($$insert into public.store_banners (slot, image_path, link) values ('home-promo', 'a/b.webp', 'javascript:alert(1)')$$, 'check constraint', 'no acepta javascript: como link');
select test.fails($$insert into public.store_banners (slot, image_path, link) values ('home-promo', 'a/b.webp', '//otro-sitio.com')$$, 'check constraint', 'no acepta links "//" a otro sitio');
select test.fails($$insert into public.store_banners (slot, image_path, link) values ('home-promo', 'a/b.webp', 'http://inseguro.com')$$, 'check constraint', 'no acepta http:');
select test.fails($$insert into public.store_banners (slot, image_path) values ('home-promo', '../products/x.webp')$$, 'check constraint', 'no acepta rutas con ..');
select test.fails($$insert into public.store_banners (slot, image_path) values ('home-promo', 'https://otro.com/x.webp')$$, 'check constraint', 'no acepta URLs externas como imagen');
select test.fails($$insert into public.store_banners (slot, image_path) values ('Home Promo', 'a/b.webp')$$, 'check constraint', 'el slot tiene formato fijo');
select test.fails($$insert into public.store_banners (slot, image_path, starts_at, ends_at) values ('home-promo', 'a/b.webp', now(), now() - interval '1 day')$$, 'check constraint', 'la fecha de fin no puede ser anterior al inicio');
select test.ok((select updated_by from public.store_banners where slot = 'home-promo') = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'queda registrado quién lo cargó');

-- Bucket: solo el admin sube y borra; el listado no es público
select sandbox.as_operator();
insert into storage.objects (bucket_id, name) values ('banners', 'home-promo/a.webp');
select sandbox.as_anon();
select test.ok((select count(*) from storage.objects where bucket_id = 'banners') = 0, 'anon no puede listar el bucket banners');
select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select test.fails($$insert into storage.objects (bucket_id, name) values ('banners', 'x/y.webp')$$, 'row-level security', 'un cliente no puede subir al bucket banners');
select sandbox.as_user('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select test.ok((select count(*) from storage.objects where bucket_id = 'banners') = 1, 'el admin ve el bucket banners');

-- Texto legal de la campaña (migración 0040): hasta 600 caracteres
select sandbox.as_user('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
update public.store_banners set legal = 'Hasta agotar stock.' where slot = 'home-promo';
select test.ok((select legal from public.store_banners where slot = 'home-promo') = 'Hasta agotar stock.', 'el admin puede cargar el texto legal');
select test.fails($$update public.store_banners set legal = repeat('x', 601) where slot = 'home-promo'$$, 'check constraint', 'el texto legal tiene tope de 600 caracteres');

-- Encuadre (migración 0041)
select sandbox.as_user('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
update public.store_banners set fit = 'contain', zoom = 1.5, pos_x = 20, pos_y = 80 where slot = 'home-promo';
select test.ok((select zoom from public.store_banners where slot = 'home-promo') = 1.5, 'el admin puede reacomodar y agrandar');
select test.fails($$update public.store_banners set zoom = 5 where slot = 'home-promo'$$, 'check constraint', 'el zoom tiene tope');
select test.fails($$update public.store_banners set pos_x = 120 where slot = 'home-promo'$$, 'check constraint', 'la posición va de 0 a 100');
select test.fails($$update public.store_banners set fit = 'fill' where slot = 'home-promo'$$, 'check constraint', 'el ajuste es cover o contain');

-- Encuadre propio para celular (migración 0043)
select sandbox.as_user('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
update public.store_banners set m_fit = 'cover', m_zoom = 2, m_pos_x = 10, m_pos_y = 90 where slot = 'home-promo';
select test.ok((select m_zoom from public.store_banners where slot = 'home-promo') = 2, 'el admin puede reacomodar para celular');
select test.fails($$update public.store_banners set m_zoom = 5 where slot = 'home-promo'$$, 'check constraint', 'el zoom de celular tiene tope');
select test.fails($$update public.store_banners set m_pos_y = 101 where slot = 'home-promo'$$, 'check constraint', 'la posición de celular va de 0 a 100');
select test.fails($$update public.store_banners set m_fit = 'fill' where slot = 'home-promo'$$, 'check constraint', 'el ajuste de celular es cover o contain');
