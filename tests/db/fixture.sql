-- Datos ficticios para los casos (se aplican como superusuario sobre la plantilla).
-- Clientes A y B, un admin (su correo está en la allowlist antes del alta), un
-- producto publicado con stock 5 y un pedido por transferencia pendiente de A
-- creado con el RPC real. El id del pedido queda en test.fx.
insert into public.admin_allowlist(email) values ('admin@example.test') on conflict do nothing;
insert into auth.users(id, email, raw_user_meta_data, email_confirmed_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'customer-a@example.test', '{"first_name":"Ana","last_name":"A"}', now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'customer-b@example.test', '{"first_name":"Beto","last_name":"B"}', now()),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'admin@example.test', '{"first_name":"Admin","last_name":"Root"}', now())
on conflict do nothing;

insert into public.products(id, sku, title, category, price, cost, stock, status, installments, created_by)
values ('11111111-1111-4111-8111-111111111111', 'SKU-1', 'Producto de prueba', 'componentes', 1000, 700, 5, 'publicado', 0, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')
on conflict do nothing;

select sandbox.as_service();
create temp table fx_order as
  select * from public.place_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '[{"product_id":"11111111-1111-4111-8111-111111111111","qty":1}]'::jsonb, 'transferencia',
    '{"name":"Ana A","email":"customer-a@example.test","dni":"12345678"}'::jsonb, 1, 1000, 0, 0, '');
select sandbox.as_operator();

create table test.fx (key text primary key, id uuid not null);
insert into test.fx select 'order_a', id from fx_order;
grant select on test.fx to anon, authenticated, service_role;
create or replace function test.fx(k text) returns uuid language sql stable as $$ select id from test.fx where key = k $$;
grant execute on function test.fx(text) to anon, authenticated, service_role;
