-- [MEDIUM] El costo de los productos (products.cost) no puede llegar al navegador.
-- quote_product_costs se la da al servidor (recargo de la tarjeta según el margen):
-- solo service_role la ejecuta; anon y authenticated no.

select test.ok(not has_function_privilege('anon', 'public.quote_product_costs(uuid[])', 'execute'), 'anon sin EXECUTE en quote_product_costs');
select test.ok(not has_function_privilege('authenticated', 'public.quote_product_costs(uuid[])', 'execute'), 'authenticated sin EXECUTE en quote_product_costs');
select test.ok(has_function_privilege('service_role', 'public.quote_product_costs(uuid[])', 'execute'), 'service_role puede ejecutar quote_product_costs');

select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select test.fails('select * from public.quote_product_costs(array[''11111111-1111-4111-8111-111111111111''::uuid])', 'permission denied', 'un cliente no puede pedir el costo de un producto');
