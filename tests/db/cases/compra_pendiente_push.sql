-- Compra pendiente (checkout_drafts) y suscripciones push (migración 0029).
-- Cada cliente ve y toca solo lo suyo; el aviso sale una vez por abandono y
-- desaparece al crear el pedido; las tablas no se leen directo.

-- Sin sesión: nada
select sandbox.as_anon();
select test.fails($$select public.save_checkout_draft('[]'::jsonb)$$, 'permission denied', 'anon no guarda borradores');
select test.fails($$select public.pending_checkout(true)$$, 'permission denied', 'anon no consulta borradores');
select test.fails($$select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/x', repeat('A', 87), repeat('B', 22), '')$$, 'permission denied', 'anon no suscribe push');

-- Las tablas no se leen ni escriben directo
select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select test.fails($$select * from public.checkout_drafts$$, 'permission denied', 'cliente no lee checkout_drafts directo');
select test.fails($$select * from public.push_subscriptions$$, 'permission denied', 'cliente no lee push_subscriptions directo');

-- Guarda solo productos publicados, ids válidos y cantidades acotadas
select public.save_checkout_draft('[{"id":"11111111-1111-4111-8111-111111111111","qty":500},{"id":"no-es-uuid","qty":1},{"id":"22222222-2222-4222-8222-222222222222","qty":1}]'::jsonb);
select test.ok((public.pending_checkout(false)->'items') = '[{"id":"11111111-1111-4111-8111-111111111111","qty":99}]'::jsonb, 'borrador filtrado y con cantidad máxima 99');

-- Recién guardado (sigue en el pago): no se avisa
select test.ok((public.pending_checkout(true)->>'notified')::boolean = false, 'sin aviso dentro de los 2 minutos');

-- Se fue hace rato: aviso una sola vez
select sandbox.as_operator();
update public.checkout_drafts set updated_at = now() - interval '10 minutes' where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select test.ok((public.pending_checkout(true)->>'notified')::boolean, 'al volver se avisa');
select test.ok((public.pending_checkout(true)->>'notified')::boolean = false, 'el aviso no se repite en la misma vuelta');
select test.ok((select count(*) from public.notifications where type = 'carrito' and target->>'url' = '/pago.html') = 1, 'el cliente ve un aviso de compra pendiente');

-- Otro cliente no ve ni toca el borrador ajeno
select sandbox.as_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select test.ok(public.pending_checkout(true) is null, 'otro cliente no ve el borrador');
select public.clear_checkout_draft();
select sandbox.as_operator();
select test.ok(exists (select 1 from public.checkout_drafts where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'clear_checkout_draft de otro no borra el ajeno');

-- Al crear el pedido el borrador y su aviso se borran
select sandbox.as_service();
select * from public.place_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '[{"product_id":"11111111-1111-4111-8111-111111111111","qty":1}]'::jsonb, 'transferencia', '{"name":"Ana"}'::jsonb, 1, 1000, 0, 0, '');
select sandbox.as_operator();
select test.ok(not exists (select 1 from public.checkout_drafts where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'el pedido borra el borrador');
select test.ok(not exists (select 1 from public.notifications where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and type = 'carrito'), 'el pedido borra el aviso de compra pendiente');

-- Vaciar el carrito borra el borrador
select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.save_checkout_draft('[{"id":"11111111-1111-4111-8111-111111111111","qty":1}]'::jsonb);
select public.clear_checkout_draft();
select test.ok(public.pending_checkout(true) is null, 'vaciar el carrito borra la compra pendiente');

-- Push: solo https, claves con formato, cada uno borra solo lo suyo
select test.fails($$select public.save_push_subscription('http://fcm.googleapis.com/fcm/send/x', repeat('A', 87), repeat('B', 22), '')$$, 'check', 'endpoint sin https rechazado');
select test.fails($$select public.save_push_subscription('https://169.254.169.254/latest', repeat('A', 87), repeat('B', 22), '')$$, 'check', 'endpoint fuera de los servicios de push rechazado');
select test.fails($$select public.save_push_subscription('https://fcm.googleapis.com.evil.example/x', repeat('A', 87), repeat('B', 22), '')$$, 'check', 'host que solo empieza como uno permitido rechazado');
select test.fails($$select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/x', '<script>', repeat('B', 22), '')$$, 'check', 'p256dh inválida rechazada');
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/a', repeat('A', 87), repeat('B', 22), 'UA');
select sandbox.as_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select public.delete_push_subscription('https://fcm.googleapis.com/fcm/send/a');
select sandbox.as_service();
select test.ok((select user_id from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/a') = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'otro cliente no borra la suscripción ajena; el backend la lee');

-- El mismo navegador con otra cuenta pasa a esa cuenta
select sandbox.as_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/a', repeat('C', 87), repeat('D', 22), 'UA');
select sandbox.as_operator();
select test.ok((select user_id from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/a') = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'el navegador queda con la última cuenta');

-- Máximo 10 navegadores por cuenta
select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/n' || i, repeat('A', 87), repeat('B', 22), '') from generate_series(1, 12) i;
select sandbox.as_operator();
select test.ok((select count(*) from public.push_subscriptions where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 10, 'hasta 10 navegadores por cuenta');
