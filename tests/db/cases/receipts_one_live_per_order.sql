-- [LOW] payment_receipts y bucket receipts sin límite por pedido.
-- Regresión: el loop de 30 inserts de check2.txt ahora solo admite 1 fila (y
-- 1 aviso); tras un rechazo se puede subir otro; el bucket aplica la misma regla.

select sandbox.as_operator();
create temp table n0 as select count(*) c from public.notifications;
grant select on n0 to public;

select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
do $$
declare i int; ok int := 0;
begin
  for i in 1..30 loop
    begin
      insert into public.payment_receipts (order_id, user_id, file_path, amount)
      values (test.fx('order_a'), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/x-' || i || '.png', 1000);
      ok := ok + 1;
    exception when insufficient_privilege then null;
    end;
  end loop;
  perform test.ok(ok = 1, format('de 30 inserts solo entra 1 (entraron %s)', ok));
end $$;

select sandbox.as_operator();
select test.ok((select count(*) from public.notifications) - (select c from n0) = 1, 'un solo aviso nuevo al panel');

-- Storage: con un comprobante en revisión no se puede subir otro archivo
select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select test.fails(format($$insert into storage.objects (bucket_id, name) values ('receipts', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/%s-2.png')$$, test.fx('order_a')),
  'row-level security', 'bucket: no se sube otro archivo con un comprobante en revisión');
select test.fails($$insert into storage.objects (bucket_id, name) values ('receipts', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cualquier-cosa.png')$$,
  'row-level security', 'bucket: el archivo tiene que nombrar un pedido propio');

-- El admin rechaza -> se puede subir otro (archivo y fila)
select sandbox.as_user('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select public.review_receipt((select id from public.payment_receipts where order_id = test.fx('order_a')), false);
select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into storage.objects (bucket_id, name) values ('receipts', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' || test.fx('order_a') || '-3.png');
insert into public.payment_receipts (order_id, user_id, file_path, amount)
values (test.fx('order_a'), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' || test.fx('order_a') || '-3.png', 1000);
select test.ok(true, 'después de un rechazo se puede subir un comprobante nuevo');

-- B no puede subir archivos a nombre de un pedido de A, ni en su propia carpeta
select sandbox.as_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select test.fails(format($$insert into storage.objects (bucket_id, name) values ('receipts', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/%s.png')$$, test.fx('order_a')),
  'row-level security', 'bucket: B no puede subir comprobantes de un pedido ajeno');

-- Pedido pagado: ya no admite comprobantes
select sandbox.as_user('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select public.set_order_status(test.fx('order_a'), 'pagado', '');
select sandbox.as_operator();
update public.payment_receipts set status = 'rechazado' where order_id = test.fx('order_a');
select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select test.fails(format($$insert into public.payment_receipts (order_id, user_id, file_path) values (%L, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'x')$$, test.fx('order_a')),
  'row-level security', 'un pedido que ya no está pendiente no admite comprobantes');
