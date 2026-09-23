-- [MEDIUM] issue_invoice ejecutable por cualquier cliente: nota de venta para pedidos sin pagar.
-- Regresión: anon y authenticated no pueden llamarla y no aparece ninguna NV
-- para el pedido pendiente; set_order_status y mp_apply_payment siguen emitiéndola.

select test.ok(not has_function_privilege('anon', 'public.issue_invoice(uuid)', 'execute'), 'anon sin EXECUTE en issue_invoice');
select test.ok(not has_function_privilege('authenticated', 'public.issue_invoice(uuid)', 'execute'), 'authenticated sin EXECUTE en issue_invoice');

select sandbox.as_anon();
select test.fails(format('select public.issue_invoice(%L)', test.fx('order_a')), 'permission denied', 'anon no puede emitir notas de venta');
select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select test.fails(format('select public.issue_invoice(%L)', test.fx('order_a')), 'permission denied', 'el cliente no puede emitir la nota de su pedido pendiente');

select sandbox.as_operator();
select test.ok(not exists (select 1 from public.invoices where order_id = test.fx('order_a')), 'el pedido pendiente sigue sin nota de venta');

-- Defensa en profundidad: aunque la llame el dueño, un pedido sin pagar no genera NV
select public.issue_invoice(test.fx('order_a'));
select test.ok(not exists (select 1 from public.invoices where order_id = test.fx('order_a')), 'issue_invoice ignora pedidos no pagados');

-- Flujos legítimos: el admin confirma el pago -> NV
select sandbox.as_user('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select public.set_order_status(test.fx('order_a'), 'pagado', '');
select sandbox.as_operator();
select test.ok((select count(*) from public.invoices where order_id = test.fx('order_a') and type = 'NV') = 1, 'set_order_status emite una NV');

-- Mercado Pago acredita -> NV
select sandbox.as_service();
create temp table o2 as select * from public.place_order('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '[{"product_id":"11111111-1111-4111-8111-111111111111","qty":1}]'::jsonb, 'debito',
  '{"name":"Beto B","email":"customer-b@example.test"}'::jsonb, 1, 1000, 0, 0, '');
select public.mp_apply_payment((select id from o2), 'MP-2', 'processed', 'accredited', '{}'::jsonb);
select sandbox.as_operator();
select test.ok((select count(*) from public.invoices where order_id = (select id from o2) and type = 'NV') = 1, 'mp_apply_payment emite una NV');
