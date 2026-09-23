-- [LOW] products.cost y created_by legibles por anon.
-- Regresión: anon/clientes no pueden leer esas columnas pero sí el resto del
-- catálogo; el admin las ve con admin_products() y puede seguir escribiendo.

select test.ok(not has_column_privilege('anon', 'public.products', 'cost', 'select'), 'anon sin SELECT en cost');
select test.ok(not has_column_privilege('anon', 'public.products', 'created_by', 'select'), 'anon sin SELECT en created_by');
select test.ok(not has_column_privilege('authenticated', 'public.products', 'cost', 'select'), 'authenticated sin SELECT en cost');
select test.ok(has_column_privilege('anon', 'public.products', 'price', 'select'), 'anon sigue leyendo price');

-- Columnas que pide la tienda (PRODUCT_COLUMNS en assets/js/core/supabase.js)
select sandbox.as_anon();
select test.fails('select cost from public.products', 'permission denied', 'anon no puede leer cost');
select test.fails('select created_by from public.products', 'permission denied', 'anon no puede leer created_by');
select test.fails('select * from public.products', 'permission denied', 'anon no puede hacer select *');
select test.ok((select count(*) from (
  select id, sku, title, brand, category, subcategory, description, tags, price, old_price, on_sale, stock, stock_min, status,
         warranty, warranty_unit, featured, installments, free_shipping, delivery, weight, weight_unit, dimensions, dimensions_unit,
         condition, images, specs, highlights, created_at, updated_at
  from public.products where status = 'publicado') s) = 1, 'anon lee el catálogo con la lista de columnas públicas');

select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select test.fails('select cost from public.products', 'permission denied', 'un cliente no puede leer cost');
select test.ok((select count(*) from public.admin_products()) = 0, 'admin_products no devuelve nada a un cliente');

select sandbox.as_anon();
select test.fails('select * from public.admin_products()', 'permission denied', 'anon no puede llamar admin_products');

-- Admin: lee cost y created_by, y puede crear / editar / borrar productos
select sandbox.as_user('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select test.ok((select cost from public.admin_products() where sku = 'SKU-1') = 700, 'el admin ve el costo');
select test.ok((select created_by from public.admin_products() where sku = 'SKU-1') = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'el admin ve created_by');
-- alta y edición como las hace dashboard.js (insert / update; un upsert que
-- lea excluded.cost necesitaría SELECT sobre cost)
insert into public.products (id, sku, title, category, price, cost, stock, status, created_by)
values ('22222222-2222-4222-8222-222222222222', 'SKU-2', 'Nuevo', 'perifericos', 500, 300, 2, 'publicado', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
update public.products set title = 'Editado', price = 600, cost = 350 where id = '22222222-2222-4222-8222-222222222222';
update public.products set stock = 9 where id = '22222222-2222-4222-8222-222222222222';
select test.ok((select cost from public.admin_products() where sku = 'SKU-2') = 350, 'el alta y la edición del panel guardan el costo');
delete from public.products where id = '22222222-2222-4222-8222-222222222222';
select test.ok(not exists (select 1 from public.admin_products() where sku = 'SKU-2'), 'el admin puede borrar');

-- La compra (place_order lee la fila completa como dueño) sigue funcionando
select sandbox.as_service();
select * from public.place_order('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '[{"product_id":"11111111-1111-4111-8111-111111111111","qty":1}]'::jsonb, 'transferencia', '{"name":"Beto"}'::jsonb, 1, 1000, 0, 0, '');
select test.ok(true, 'place_order sigue funcionando');
