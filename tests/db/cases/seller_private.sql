-- [MEDIUM] Datos personales y bancarios del vendedor en archivos públicos.
-- Regresión: private.seller_info no se lee desde la API; seller_private()
-- no la puede llamar anon y solo responde con sesión.

select sandbox.as_operator();
insert into private.seller_info (id, data) values (true, '{"owner":"Vendedor Test","doc":"CUIT 20-12345678-9","bank":{"cbu":"0000000000000000000000","alias":"test.alias"}}')
  on conflict (id) do update set data = excluded.data;

select sandbox.as_anon();
select test.fails('select data from private.seller_info', 'permission denied', 'anon no puede leer private.seller_info');
select test.fails('select public.seller_private()', 'permission denied', 'anon no puede llamar seller_private()');

select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select test.fails('select data from private.seller_info', 'permission denied', 'un cliente no puede leer la tabla directamente');
select test.ok(public.seller_private()->'bank'->>'cbu' = '0000000000000000000000', 'un cliente con sesión ve la cuenta para transferir');
select test.ok(public.seller_private()->>'doc' = 'CUIT 20-12345678-9', 'un cliente con sesión ve el DNI/CUIT de la nota de venta');
