-- [MEDIUM] notify_admins / notify_user ejecutables por anon y cualquier cliente.
-- Regresión: anon y authenticated no pueden llamarlos; los RPCs y triggers
-- que los usan (SECURITY DEFINER) siguen generando notificaciones.

select test.ok(not has_function_privilege('anon', 'public.notify_admins(text,text,text,text,jsonb)', 'execute'), 'anon sin EXECUTE en notify_admins');
select test.ok(not has_function_privilege('authenticated', 'public.notify_admins(text,text,text,text,jsonb)', 'execute'), 'authenticated sin EXECUTE en notify_admins');
select test.ok(not has_function_privilege('anon', 'public.notify_user(uuid,text,text,text,text,jsonb)', 'execute'), 'anon sin EXECUTE en notify_user');
select test.ok(not has_function_privilege('authenticated', 'public.notify_user(uuid,text,text,text,text,jsonb)', 'execute'), 'authenticated sin EXECUTE en notify_user');

select sandbox.as_anon();
select test.fails($$select public.notify_admins('x', 'x', 'anon-title', '', '{}')$$, 'permission denied', 'anon no puede llamar notify_admins');
select test.fails($$select public.notify_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'x', 'x', 't', '', '{}')$$, 'permission denied', 'anon no puede llamar notify_user');

select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select test.fails($$select public.notify_admins('x', 'x', 'cust-title', '', '{}')$$, 'permission denied', 'cliente no puede llamar notify_admins');
select test.fails($$select public.notify_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'x', 'x', 't', '', '{"order":"x\" onmouseover=\"alert(1)"}')$$, 'permission denied', 'cliente no puede forjar avisos para otro usuario');

-- Los flujos legítimos siguen notificando (callers SECURITY DEFINER)
select sandbox.as_operator();
create temp table n0 as select count(*) c from public.notifications;
grant select on n0 to public;

-- trigger on_receipt_insert -> notify_admins
select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.payment_receipts (order_id, user_id, file_path, bank, reference, amount)
values (test.fx('order_a'), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/r.png', 'Banco', 'REF', 1000);

-- set_order_status (admin) -> issue_invoice + notify_user
select sandbox.as_user('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select public.set_order_status(test.fx('order_a'), 'pagado', 'ok');

-- place_order (backend) -> notify_admins + notify_user; mp_apply_payment -> notify_*
select sandbox.as_service();
create temp table o2 as select * from public.place_order('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '[{"product_id":"11111111-1111-4111-8111-111111111111","qty":1}]'::jsonb, 'credito',
  '{"name":"Beto B","email":"customer-b@example.test"}'::jsonb, 1, 1000, 0, 0, '');
select public.mp_apply_payment((select id from o2), 'MP-1', 'processed', 'accredited', '{}'::jsonb);

-- request_revocation (anon) -> notify_admins + notify_user
select sandbox.as_operator();
select number as order_a_number from public.orders where id = test.fx('order_a') \gset
select sandbox.as_anon();
select * from public.request_revocation(:order_a_number, 'customer-a@example.test');

select sandbox.as_operator();
select test.ok((select count(*) from public.notifications) - (select c from n0) = 7,
  'receipt(1) + set_order_status(1) + mp_apply_payment(2) + request_revocation(2) + stock bajo(1) = 7 avisos nuevos');
select test.ok(exists (select 1 from public.invoices where order_id = test.fx('order_a') and type = 'NV'), 'set_order_status sigue emitiendo la nota de venta');
