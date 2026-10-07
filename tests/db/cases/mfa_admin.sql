-- [HIGH] Panel sin segundo factor: con solo la contraseña de un admin se
-- podía administrar todo. Migración 0026: is_admin() exige sesión aal2.
-- Regresión: el admin con solo contraseña (aal1) no ve ni cambia nada de
-- admin; con 2FA (aal2) sí; los clientes no se ven afectados.

-- Admin con solo contraseña
select sandbox.as_user('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'aal1');
select test.ok(not public.is_admin(), 'un admin sin 2FA no es admin para la base');
select test.fails(format($$select public.set_order_status(%L, 'pagado', '')$$, test.fx('order_a')), 'Solo administradores', 'sin 2FA no puede cambiar pedidos');
select test.ok((select count(*) from public.admin_products()) = 0, 'sin 2FA no ve el costo de los productos');
select test.ok((select count(*) from public.orders) = 0, 'sin 2FA no ve los pedidos de los clientes');

-- Admin con 2FA verificado
select sandbox.as_user('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'aal2');
select test.ok(public.is_admin(), 'con 2FA es admin');
select test.ok((select count(*) from public.orders) >= 1, 'con 2FA ve los pedidos');

-- Un cliente con aal2 sigue siendo cliente
select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aal2');
select test.ok(not public.is_admin(), 'un cliente no es admin aunque tenga 2FA');

-- account_security: solo con sesión y solo la propia
select sandbox.as_anon();
select test.fails('select public.account_security()', 'permission denied', 'anon no puede consultar account_security');
select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select test.ok(public.account_security() ? 'has_password', 'account_security responde para la cuenta propia');

-- Funciones de trigger no se pueden llamar como RPC
select test.fails('select public.handle_new_user()', 'permission denied|trigger', 'handle_new_user no es un RPC');
select sandbox.as_anon();
select test.fails($$select public.set_order_status(gen_random_uuid(), 'pagado', '')$$, 'permission denied', 'anon no puede llamar set_order_status');

-- Límite de pedidos por transferencia pendientes (2 por cliente)
select sandbox.as_service();
select public.place_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[{"product_id":"11111111-1111-4111-8111-111111111111","qty":1}]'::jsonb, 'transferencia',
  '{"name":"Ana A","email":"customer-a@example.test","dni":"12345678"}'::jsonb, 1, 1000, 0, 0, '');
select test.fails($$select public.place_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[{"product_id":"11111111-1111-4111-8111-111111111111","qty":1}]'::jsonb, 'transferencia',
  '{"name":"Ana A","email":"customer-a@example.test","dni":"12345678"}'::jsonb, 1, 1000, 0, 0, '')$$, 'esperando la confirmación', 'el tercer pedido por transferencia pendiente se rechaza');
select test.ok((select public.place_order('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '[{"product_id":"11111111-1111-4111-8111-111111111111","qty":1}]'::jsonb, 'transferencia',
  '{"name":"Beto B","email":"customer-b@example.test","dni":"87654321"}'::jsonb, 1, 1000, 0, 0, '') limit 1) is not null, 'otro cliente puede seguir comprando');
