-- [LOW] POST /api/mp/pay sin límite de intentos (órdenes rechazadas ilimitadas).
-- Regresión: el mismo ciclo de decline-loop.txt (place_order + mp_apply_payment
-- 'failed') se corta al 6.º intento en la hora; transferencia y otros usuarios siguen.

select sandbox.as_service();
do $$
declare v_id uuid; i int;
begin
  for i in 1..5 loop
    select id into v_id from public.place_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '[{"product_id":"11111111-1111-4111-8111-111111111111","qty":1}]'::jsonb, 'credito', '{"name":"Ana"}'::jsonb, 1, 1000, 0, 0, '');
    perform public.mp_apply_payment(v_id, '', 'failed', 'cc_rejected_other_reason', '{}'::jsonb);
  end loop;
end $$;

select test.fails($$select * from public.place_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '[{"product_id":"11111111-1111-4111-8111-111111111111","qty":1}]'::jsonb, 'debito', '{"name":"Ana"}'::jsonb, 1, 1000, 0, 0, '')$$,
  'demasiados intentos', 'el 6.º intento con tarjeta en la hora se rechaza');

select sandbox.as_operator();
select test.ok((select count(*) from public.orders where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and payment_method in ('credito', 'debito')) = 5, 'no se creó la 6.ª orden');
select test.ok((select stock from public.products where sku = 'SKU-1') = 4, 'el stock quedó intacto');

select sandbox.as_service();
select * from public.place_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '[{"product_id":"11111111-1111-4111-8111-111111111111","qty":1}]'::jsonb, 'transferencia', '{"name":"Ana"}'::jsonb, 1, 1000, 0, 0, '');
select * from public.place_order('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '[{"product_id":"11111111-1111-4111-8111-111111111111","qty":1}]'::jsonb, 'credito', '{"name":"Beto"}'::jsonb, 1, 1000, 0, 0, '');
select test.ok(true, 'transferencia del mismo usuario y tarjeta de otro usuario siguen funcionando');

-- Pasada la hora, puede volver a intentar
select sandbox.as_operator();
update public.orders set created_at = now() - interval '61 minutes' where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and status = 'cancelado';
select sandbox.as_service();
select * from public.place_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '[{"product_id":"11111111-1111-4111-8111-111111111111","qty":1}]'::jsonb, 'credito', '{"name":"Ana"}'::jsonb, 1, 1000, 0, 0, '');
select test.ok(true, 'después de una hora puede volver a pagar con tarjeta');
