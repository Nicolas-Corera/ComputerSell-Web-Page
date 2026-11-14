-- Correos por cancelación o reembolso y aviso al panel por pagos rechazados (0038).
-- Regresión: al cancelar desde el panel y al reembolsar desde Mercado Pago el
-- cliente recibe correo (notifications.mail = true); un pago con tarjeta
-- rechazado avisa al panel (sin correo) con el motivo y no al cliente por correo;
-- "pagado" y "despachado" siguen saliendo por correo.

-- 1) Cancelación desde el panel: correo al cliente
select sandbox.as_user('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select public.set_order_status(test.fx('order_a'), 'cancelado', 'Sin stock');
select sandbox.as_operator();
select test.ok(exists (select 1 from public.notifications where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and title like '%fue cancelado' and mail), 'cancelar desde el panel avisa al cliente por correo');

-- 2) Pago con tarjeta rechazado: aviso al panel, sin correo
select sandbox.as_service();
create temp table orej as select * from public.place_order('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '[{"product_id":"11111111-1111-4111-8111-111111111111","qty":1}]'::jsonb, 'credito',
  '{"name":"Beto B","email":"customer-b@example.test"}'::jsonb, 1, 1000, 0, 0, '');
select public.mp_apply_payment((select id from orej), 'ORDTST1', 'failed', 'cc_rejected_other_reason', '{}'::jsonb);
select sandbox.as_operator();
select test.ok((select status from public.orders where id = (select id from orej)) = 'cancelado', 'el rechazo cancela el pedido');
select test.ok(exists (select 1 from public.notifications where audience = 'admin' and title like 'Pago con tarjeta rechazado%' and body like '%Beto B%' and body like '%cc_rejected_other_reason%' and not mail), 'el panel recibe el aviso del rechazo con el motivo, sin correo');
select test.ok(exists (select 1 from public.notifications where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and body like 'Mercado Pago no aprobó el pago%' and not mail), 'el cliente ve el aviso en su cuenta, sin correo');

-- Vencimiento o cancelación (no es un rechazo): no se avisa al panel
select sandbox.as_service();
create temp table oexp as select * from public.place_order('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '[{"product_id":"11111111-1111-4111-8111-111111111111","qty":1}]'::jsonb, 'credito',
  '{"name":"Beto B","email":"customer-b@example.test"}'::jsonb, 1, 1000, 0, 0, '');
select public.mp_apply_payment((select id from oexp), 'ORDTST2', 'expired', '', '{}'::jsonb);
select sandbox.as_operator();
select test.ok((select count(*) from public.notifications where audience = 'admin' and title like 'Pago con tarjeta rechazado%') = 1, 'solo el rechazo (no el vencimiento) avisa al panel');

-- 3) Reembolso desde Mercado Pago: correo al cliente
select sandbox.as_service();
create temp table opaid as select * from public.place_order('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '[{"product_id":"11111111-1111-4111-8111-111111111111","qty":1}]'::jsonb, 'credito',
  '{"name":"Beto B","email":"customer-b@example.test"}'::jsonb, 1, 1000, 0, 0, '');
select public.mp_apply_payment((select id from opaid), 'ORDTST3', 'processed', 'accredited', '{}'::jsonb);
select public.mp_apply_payment((select id from opaid), 'ORDTST3', 'refunded', '', '{}'::jsonb);
select sandbox.as_operator();
select test.ok((select status from public.orders where id = (select id from opaid)) = 'cancelado', 'el reembolso cancela el pedido');
select test.ok(exists (select 1 from public.notifications where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and body like 'El pago fue reembolsado%' and mail), 'el reembolso avisa al cliente por correo');

-- 4) Lo que ya salía por correo sigue igual (pago confirmado con tarjeta)
select test.ok(exists (select 1 from public.notifications where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and title like '%Pago confirmado' and mail), 'el pago confirmado sigue saliendo por correo');
