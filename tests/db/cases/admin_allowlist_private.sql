-- [LOW] admin_allowlist legible por anon (correos de los administradores).
-- [MEDIUM] is_admin_email() respondía a anon si un correo era admin, y un
-- correo de la allowlist pasaba a admin sin confirmarlo (migración 0023).
-- Regresión: nadie lee la tabla ni pregunta por un correo; solo se promueve
-- a admin una cuenta con el correo confirmado.

select sandbox.as_anon();
select test.fails('select email from public.admin_allowlist', 'permission denied', 'anon no puede leer admin_allowlist');
select test.fails($$select public.is_admin_email('admin@example.test')$$, 'does not exist', 'is_admin_email ya no existe');

select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select test.fails('select email from public.admin_allowlist', 'permission denied', 'un cliente no puede leer admin_allowlist');

-- Alta con correo sin confirmar: queda cliente aunque esté en la allowlist
select sandbox.as_operator();
insert into public.admin_allowlist (email) values ('otro-admin@example.test');
insert into auth.users (id, email) values ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'otro-admin@example.test');
select test.ok((select role from public.profiles where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff') = 'customer', 'un correo de la allowlist sin confirmar no es admin');

-- Al confirmar el correo pasa a admin
update auth.users set email_confirmed_at = now() where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
select test.ok((select role from public.profiles where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff') = 'admin', 'al confirmar el correo pasa a admin');

-- Alta ya confirmada (Google): admin de entrada
insert into public.admin_allowlist (email) values ('google-admin@example.test');
insert into auth.users (id, email, email_confirmed_at) values ('99999999-9999-4999-8999-999999999999', 'google-admin@example.test', now());
select test.ok((select role from public.profiles where id = '99999999-9999-4999-8999-999999999999') = 'admin', 'un alta confirmada de la allowlist es admin');

-- Agregar a la allowlist una cuenta sin confirmar no la promueve
insert into auth.users (id, email) values ('88888888-8888-4888-8888-888888888888', 'tarde@example.test');
insert into public.admin_allowlist (email) values ('tarde@example.test');
select test.ok((select role from public.profiles where id = '88888888-8888-4888-8888-888888888888') = 'customer', 'la allowlist no promueve una cuenta sin confirmar');

-- Confirmar un correo que no está en la allowlist no da admin
insert into auth.users (id, email) values ('77777777-7777-4777-8777-777777777777', 'cliente-nuevo@example.test');
update auth.users set email_confirmed_at = now() where id = '77777777-7777-4777-8777-777777777777';
select test.ok((select role from public.profiles where id = '77777777-7777-4777-8777-777777777777') = 'customer', 'un cliente que confirma sigue siendo cliente');
