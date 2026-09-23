-- [MEDIUM] El cliente podía insertar un comprobante ya "aprobado".
-- Regresión: el insert con status='aprobado' y reviewed_at queda pendiente y
-- sin revisar; review_receipt (admin) sigue aprobando.

select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.payment_receipts (order_id, user_id, file_path, bank, reference, amount, status, reviewed_at)
values (test.fx('order_a'), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'nonexistent/forged.pdf', 'b', 'r', 1, 'aprobado', now());

select sandbox.as_operator();
create temp table rc as select * from public.payment_receipts where order_id = test.fx('order_a');
grant select on rc to public;
select test.ok((select count(*) from rc) = 1, 'el comprobante se insertó');
select test.ok((select status from rc) = 'pendiente', 'status forzado a pendiente');
select test.ok((select reviewed_at from rc) is null, 'reviewed_at forzado a null');

-- Control: otro cliente no puede cargar comprobantes en un pedido ajeno
select sandbox.as_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select test.fails(format($$insert into public.payment_receipts (order_id, user_id, file_path) values (%L, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'x')$$, test.fx('order_a')),
  'row-level security', 'B no puede cargar comprobantes para el pedido de A');

-- El admin aprueba por el camino normal
select sandbox.as_user('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select public.review_receipt((select id from rc), true);
select sandbox.as_operator();
select test.ok((select status from public.payment_receipts where id = (select id from rc)) = 'aprobado', 'review_receipt aprueba');
select test.ok((select reviewed_at from public.payment_receipts where id = (select id from rc)) is not null, 'review_receipt marca reviewed_at');
select test.ok((select status from public.orders where id = test.fx('order_a')) = 'pagado', 'aprobar el comprobante confirma el pedido');
