-- [LOW] admin_allowlist legible por anon (correos de los administradores).
-- Regresión: anon y clientes no pueden listar la tabla; is_admin_email solo
-- responde sí/no para un correo; el alta como admin sigue funcionando.

select sandbox.as_anon();
select test.fails('select email from public.admin_allowlist', 'permission denied', 'anon no puede leer admin_allowlist');
select test.ok(public.is_admin_email('ADMIN@example.test'), 'is_admin_email reconoce un correo habilitado (sin importar mayúsculas)');
select test.ok(not public.is_admin_email('customer-a@example.test'), 'is_admin_email rechaza un correo no habilitado');
select test.ok(not public.is_admin_email('%'), 'is_admin_email no acepta comodines');

select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select test.fails('select email from public.admin_allowlist', 'permission denied', 'un cliente no puede leer admin_allowlist');

-- handle_new_user / promote_allowlisted siguen leyendo la tabla (SECURITY DEFINER)
select sandbox.as_operator();
insert into public.admin_allowlist (email) values ('otro-admin@example.test');
insert into auth.users (id, email) values ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'otro-admin@example.test');
select test.ok((select role from public.profiles where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff') = 'admin', 'el alta de un correo habilitado sigue creando un admin');
