-- [MEDIUM] Un pedido con tarjeta nunca cobrado retenía el stock para siempre.
-- Regresión: la reserva vence (30 min sin respuesta de MP, 48 h si MP lo dejó
-- en proceso), el pedido se cancela y el stock vuelve; los pedidos recientes
-- y las transferencias no se tocan.

select test.ok(not has_function_privilege('authenticated', 'public.expire_stale_card_orders()', 'execute'), 'authenticated no puede ejecutar la limpieza');
select test.ok(not has_function_privilege('anon', 'public.expire_stale_card_orders()', 'execute'), 'anon no puede ejecutar la limpieza');

-- B reserva todo el stock que queda (4) con tarjeta y el cobro nunca se completa
select sandbox.as_service();
create temp table ob as select * from public.place_order('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '[{"product_id":"11111111-1111-4111-8111-111111111111","qty":4}]'::jsonb, 'credito',
  '{"name":"Beto B","email":"customer-b@example.test"}'::jsonb, 1, 4000, 0, 0, '');
select sandbox.as_operator();
select test.ok((select stock from public.products where sku = 'SKU-1') = 0, 'la reserva deja el stock en 0');

-- Recién creado: la reserva sigue vigente, nadie más puede comprar
select sandbox.as_service();
select test.fails($$select * from public.place_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '[{"product_id":"11111111-1111-4111-8111-111111111111","qty":1}]'::jsonb, 'transferencia', '{"name":"Ana"}'::jsonb, 1, 1000, 0, 0, '')$$,
  'Sin stock suficiente', 'con la reserva vigente no hay stock');

-- Pasan 31 minutos sin respuesta de Mercado Pago
select sandbox.as_operator();
update public.orders set created_at = now() - interval '31 minutes' where id = (select id from ob);

-- La próxima compra libera la reserva vencida y puede comprar
select sandbox.as_service();
create temp table oa as select * from public.place_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '[{"product_id":"11111111-1111-4111-8111-111111111111","qty":1}]'::jsonb, 'transferencia', '{"name":"Ana"}'::jsonb, 1, 1000, 0, 0, '');
select sandbox.as_operator();
select test.ok((select status from public.orders where id = (select id from ob)) = 'cancelado', 'el pedido con tarjeta vencido se cancela');
select test.ok((select stock from public.products where sku = 'SKU-1') = 3, 'el stock vuelve (4) y se descuenta la compra nueva (1)');
select test.ok(exists (select 1 from public.order_events where order_id = (select id from ob) and note like 'Reserva vencida%'), 'queda el evento en el historial');
select test.ok(exists (select 1 from public.notifications where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and body like 'No recibimos la confirmación%'), 'se avisa al cliente');
select test.ok((select status from public.orders where id = test.fx('order_a')) = 'pendiente', 'la transferencia pendiente (vieja o no) no se toca');

-- Pedido que MP dejó "en revisión": 31 min no alcanza, 49 h sí
select sandbox.as_service();
create temp table orv as select * from public.place_order('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '[{"product_id":"11111111-1111-4111-8111-111111111111","qty":1}]'::jsonb, 'debito', '{"name":"Beto"}'::jsonb, 1, 1000, 0, 0, '');
select public.mp_apply_payment((select id from orv), 'MP-9', 'in_review', 'pending_review_manual', '{}'::jsonb);
select sandbox.as_operator();
update public.orders set created_at = now() - interval '31 minutes' where id = (select id from orv);
select sandbox.as_service();
select test.ok(public.expire_stale_card_orders() = 0, 'en revisión en MP: a los 31 min no vence');
select sandbox.as_operator();
update public.orders set created_at = now() - interval '49 hours' where id = (select id from orv);
select sandbox.as_service();
select test.ok(public.expire_stale_card_orders() = 1, 'en revisión en MP: a las 49 h vence');

-- Si MP acredita después del vencimiento, el panel recibe el aviso de reembolso
select public.mp_apply_payment((select id from ob), 'MP-late', 'processed', 'accredited', '{}'::jsonb);
select sandbox.as_operator();
select test.ok((select status from public.orders where id = (select id from ob)) = 'cancelado', 'un pago tardío no revive el pedido');
select test.ok(exists (select 1 from public.notifications where audience = 'admin' and title like 'Revisar pago%'), 'el panel recibe el aviso para reembolsar');
