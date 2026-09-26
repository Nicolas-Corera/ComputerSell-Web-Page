-- Catálogo paginado (0021): search_products / catalog_facets / products_broadcast.
-- Filtros, búsqueda sin acentos y en cualquier orden, orden, paginación,
-- permisos de anon y que el broadcast no filtre columnas privadas.

insert into public.products (id, sku, title, brand, category, subcategory, tags, price, cost, old_price, on_sale, stock, free_shipping, status, created_at) values
  ('30000000-0000-4000-8000-000000000001', 'GPU-1', 'Placa de video RTX 4060 Gaming', 'ASUS', 'componentes', 'Placas de video', '{nvidia}', 500000, 400000, 600000, true, 3, true, 'publicado', now() - interval '5 days'),
  ('30000000-0000-4000-8000-000000000002', 'GPU-2', 'Placa de video RX 7600', 'Gigabyte', 'componentes', 'Placas de video', '{amd}', 400000, 300000, 0, false, 0, false, 'publicado', now() - interval '1 day'),
  ('30000000-0000-4000-8000-000000000003', 'KB-1', 'Teclado mecánico Óptico', 'Redragon', 'perifericos', 'Teclados', '{}', 80000, 50000, 0, false, 10, false, 'publicado', now() - interval '2 days'),
  ('30000000-0000-4000-8000-000000000004', 'NB-1', 'Notebook borrador', 'ASUS', 'notebooks', '', '{}', 900000, 800000, 0, false, 2, false, 'borrador', now());

select sandbox.as_anon();
create temp table r as select public.search_products() j;
-- fixture: SKU-1 (stock 4 tras el pedido) + 3 publicados de este caso; el borrador no aparece
select test.ok((select (j->>'total')::int from r) = 4, 'anon ve los 4 publicados (sin borradores)');
select test.ok((select jsonb_array_length(j->'items') from r) = 4, 'devuelve las tarjetas');
select test.ok(not exists (select 1 from r, jsonb_array_elements(j->'items') i where i ? 'cost' or i ? 'description' or i ? 'created_by'), 'las tarjetas no traen cost/description/created_by');
select test.ok((select j->'items'->-1->>'id' from r) = '30000000-0000-4000-8000-000000000002', 'relevancia: sin stock al final');

-- Búsqueda: sin acentos, mayúsculas indistintas, palabras en cualquier orden, por SKU y tags
select test.ok((public.search_products(p_words => '{optico,TECLADO}')->>'total')::int = 1, 'busca sin acentos y en cualquier orden');
select test.ok((public.search_products(p_words => '{gpu-2}')->'items'->0->>'id') = '30000000-0000-4000-8000-000000000002', 'busca por SKU');
select test.ok((public.search_products(p_words => '{nvidia}')->>'total')::int = 1, 'busca por tags');
select test.ok((public.search_products(p_words => '{%}')->>'total')::int = 0, 'el % del buscador es literal');

-- Filtros
select test.ok((public.search_products(p_categories => '{componentes}')->>'total')::int = 3, 'filtra por categoría');
select test.ok((public.search_products(p_categories => '{componentes,perifericos}', p_componentes => '{placas-de-video}')->>'total')::int = 3, 'el tipo filtra solo dentro de su categoría');
select test.ok((public.search_products(p_brands => '{asus}')->>'total')::int = 1, 'marca normalizada (borrador excluido)');
select test.ok((public.search_products(p_in_stock => true)->>'total')::int = 3, 'solo en stock');
select test.ok((public.search_products(p_on_sale => true)->'items'->0->>'id') = '30000000-0000-4000-8000-000000000001', 'solo en oferta');
select test.ok((public.search_products(p_free_shipping => true)->>'total')::int = 1, 'solo envío gratis');
select test.ok((public.search_products(p_min => 100000, p_max => 450000)->>'total')::int = 1, 'rango de precio');

-- Orden y paginación
select test.ok((public.search_products(p_sort => 'menor-precio')->'items'->0->>'price')::int = 1000, 'menor precio primero');
select test.ok((public.search_products(p_sort => 'mayor-precio', p_limit => 1)->'items'->0->>'id') = '30000000-0000-4000-8000-000000000001', 'mayor precio primero');
select test.ok((select jsonb_array_length(j->'items') = 2 and (j->>'total')::int = 4 from (select public.search_products(p_limit => 2, p_offset => 2) j) s), 'página 2 con el total completo');
select test.ok((select jsonb_array_length(j->'items') = 0 and (j->>'total')::int = 4 from (select public.search_products(p_offset => 48) j) s), 'página fuera de rango informa el total');
select test.ok((select jsonb_array_length(public.search_products(p_limit => 100000)->'items')) <= 60, 'el tamaño de página tiene tope');

-- Contadores
create temp table f as select public.catalog_facets() j;
select test.ok((select (j->'categories'->>'componentes')::int from f) = 3, 'facets: categorías');
select test.ok((select (j->'subcategories'->>'componentes/placas-de-video')::int from f) = 2, 'facets: subcategorías');
select test.ok((select (j->>'sale')::int = 1 and (j->>'stock')::int = 3 from f), 'facets: disponibilidad');
select test.ok((select count(*) from f, jsonb_array_elements(j->'brands') b where b->>'key' = 'asus' and (b->>'count')::int = 1) = 1, 'facets: marcas (sin borradores)');

-- Broadcast: cambios de productos publicados, sin columnas privadas
select sandbox.as_operator();
truncate realtime.sent;
update public.products set stock = 7 where id = '30000000-0000-4000-8000-000000000003';
select test.ok((select count(*) from realtime.sent where topic = 'catalog' and not private and (payload->>'stock')::int = 7) = 1, 'un cambio de stock se transmite al canal público');
select test.ok(not exists (select 1 from realtime.sent where payload ? 'cost' or payload ? 'created_by'), 'el broadcast no incluye cost ni created_by');
update public.products set title = 'Otro borrador' where id = '30000000-0000-4000-8000-000000000004';
select test.ok((select count(*) from realtime.sent) = 1, 'editar un borrador no transmite nada');
update public.products set status = 'pausado' where id = '30000000-0000-4000-8000-000000000003';
select test.ok(exists (select 1 from realtime.sent where payload = '{"id":"30000000-0000-4000-8000-000000000003","removed":true}'), 'despublicar avisa removed');

-- La compra sigue funcionando con el trigger
select sandbox.as_service();
select * from public.place_order('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '[{"product_id":"30000000-0000-4000-8000-000000000001","qty":1}]'::jsonb, 'transferencia', '{"name":"Beto"}'::jsonb, 1, 500000, 0, 0, '');
select sandbox.as_operator();
select test.ok(exists (select 1 from realtime.sent where payload->>'id' = '30000000-0000-4000-8000-000000000001' and (payload->>'stock')::int = 2), 'place_order transmite el stock nuevo');

-- Con un catálogo grande, la búsqueda y el listado usan los índices (sin forzar al planner)
insert into public.products (sku, title, brand, category, price, stock, status, created_at)
select 'FILL-' || g, 'Producto generico ' || g, 'Marca ' || (g % 40), (array['computadoras','notebooks','componentes','perifericos'])[1 + g % 4],
       1000 + g, g % 7, case when g % 10 = 0 then 'borrador' else 'publicado' end, now() - g * interval '1 minute'
from generate_series(1, 3000) g;
analyze public.products;
create function pg_temp.plan(q text) returns text language plpgsql as $f$
declare v text := ''; l text;
begin
  for l in execute 'explain ' || q loop v := v || l || E'
'; end loop;
  return v;
end $f$;
select test.ok(pg_temp.plan($q$select id from public.products p where p.status = 'publicado' and public.cs_search_text(p.title, p.brand, p.tags, p.sku) like '%rtx 4060%'$q$) like '%products_pub_search_idx%', 'la búsqueda usa el índice trigram');
select test.ok(pg_temp.plan($q$select id from public.products p where p.status = 'publicado' order by (p.stock > 0) desc, p.created_at desc limit 24$q$) like '%products_pub_relevance_idx%', 'el listado por relevancia usa su índice');
select test.ok(pg_temp.plan($q$select id from public.products p where p.status = 'publicado' order by p.price limit 24$q$) like '%products_pub_price_idx%', 'el orden por precio usa su índice');
select test.ok((public.search_products(p_words => '{rtx}')->>'total')::int = 1, 'la búsqueda sigue dando lo mismo con 3000 productos');
