-- Encuadre de las imágenes del producto (migración 0044).
-- Solo un admin lo guarda; el público lo lee; el formato se valida.

select sandbox.as_user('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
update public.products set image_frames = '[{"fit":"cover","zoom":1.5,"x":20,"y":80}, null]'::jsonb where id = (select id from public.products limit 1);
select test.ok((select count(*) from public.products where image_frames is not null) = 1, 'el admin guarda el encuadre');
select test.fails($$update public.products set image_frames = '[{"fit":"fill","zoom":1,"x":50,"y":50}]'::jsonb$$, 'check constraint', 'el ajuste es cover o contain');
select test.fails($$update public.products set image_frames = '[{"fit":"cover","zoom":5,"x":50,"y":50}]'::jsonb$$, 'check constraint', 'el zoom tiene tope');
select test.fails($$update public.products set image_frames = '[{"fit":"cover","zoom":1,"x":150,"y":50}]'::jsonb$$, 'check constraint', 'la posición va de 0 a 100');
select test.fails($$update public.products set image_frames = '[{"fit":"cover","zoom":1,"x":50,"y":50,"extra":1}]'::jsonb$$, 'check constraint', 'no acepta campos de más');
select test.fails($$update public.products set image_frames = '{"fit":"cover"}'::jsonb$$, 'check constraint', 'tiene que ser una lista');
select test.fails($$update public.products set image_frames = '[null,null,null,null,null,null,null,null,null]'::jsonb$$, 'check constraint', 'máximo 8 imágenes');

select sandbox.as_anon();
select test.ok((select count(*) from (select image_frames from public.products where status = 'publicado') t) = 1, 'la tienda puede leer image_frames');
select test.fails($$update public.products set image_frames = null$$, 'permission denied|row-level security', 'anon no puede cambiar el encuadre');
