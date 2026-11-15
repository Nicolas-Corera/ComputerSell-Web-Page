-- Precio con transferencia (migración 0042).
-- Regresión: la base cobra el precio especial solo con transferencia, no deja
-- cargar uno que no sea menor al precio y lo expone a la tienda (anon).

select test.ok(public.product_unit_price(1000, 900, 'transferencia') = 900, 'transferencia usa el precio especial');
select test.ok(public.product_unit_price(1000, 900, 'credito') = 1000, 'tarjeta usa el precio normal');
select test.ok(public.product_unit_price(1000, null, 'transferencia') = 1000, 'sin precio especial, el normal');
select test.ok(public.product_unit_price(1000, 1000, 'transferencia') = 1000, 'un precio especial no menor se ignora');

select sandbox.as_user('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
update public.products set transfer_price = 900 where sku = 'SKU-1';
select test.ok((select transfer_price from public.products where sku = 'SKU-1') = 900, 'el admin carga el precio con transferencia');
select test.fails($$update public.products set transfer_price = 5000 where sku = 'SKU-1'$$, 'check constraint', 'no se puede cargar uno mayor al precio');

select sandbox.as_anon();
select test.ok((select transfer_price from public.products where sku = 'SKU-1') = 900, 'anon lee el precio con transferencia');
