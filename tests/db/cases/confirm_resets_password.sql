-- [HIGH] Secuestro previo de cuenta: alguien se registraba con un correo
-- ajeno y, cuando el dueño confirmaba, la cuenta quedaba con la contraseña
-- del atacante (y admin si el correo estaba en la allowlist). Migración 0025.
-- Regresión: confirmar desde el mail borra la contraseña guardada; Google y
-- las altas sin mail (autoconfirm) no se tocan.

select sandbox.as_operator();
insert into public.admin_allowlist (email) values ('victima@example.test');

-- El atacante se registra con el correo de la víctima (mail de confirmación enviado)
insert into auth.users (id, email, encrypted_password, raw_app_meta_data, confirmation_sent_at)
values ('66666666-6666-4666-8666-666666666666', 'victima@example.test', 'hash-del-atacante', '{"provider":"email"}', now());

-- La víctima confirma desde su casilla
update auth.users set email_confirmed_at = now() where id = '66666666-6666-4666-8666-666666666666';
select test.ok((select encrypted_password from auth.users where id = '66666666-6666-4666-8666-666666666666') = '', 'al confirmar se borra la contraseña que eligió el atacante');
select test.ok((select role from public.profiles where id = '66666666-6666-4666-8666-666666666666') = 'admin', 'la cuenta confirmada sigue pasando a admin (la usa quien abrió el mail)');

-- Google: llega confirmado, no tiene contraseña que borrar ni se toca
insert into auth.users (id, email, encrypted_password, raw_app_meta_data, confirmation_sent_at)
values ('55555555-5555-4555-8555-555555555555', 'google@example.test', 'x', '{"provider":"google"}', null);
update auth.users set email_confirmed_at = now() where id = '55555555-5555-4555-8555-555555555555';
select test.ok((select encrypted_password from auth.users where id = '55555555-5555-4555-8555-555555555555') = 'x', 'una cuenta de Google no se toca');

-- Autoconfirm (sin mail de confirmación): la contraseña se conserva
insert into auth.users (id, email, encrypted_password, raw_app_meta_data, confirmation_sent_at)
values ('44444444-4444-4444-8444-444444444444', 'auto@example.test', 'hash-propio', '{"provider":"email"}', null);
update auth.users set email_confirmed_at = now() where id = '44444444-4444-4444-8444-444444444444';
select test.ok((select encrypted_password from auth.users where id = '44444444-4444-4444-8444-444444444444') = 'hash-propio', 'sin mail de confirmación (autoconfirm) la contraseña se conserva');

-- Una cuenta ya confirmada que cambia otra cosa no pierde la contraseña
update auth.users set raw_user_meta_data = '{"x":1}' where id = '44444444-4444-4444-8444-444444444444';
select test.ok((select encrypted_password from auth.users where id = '44444444-4444-4444-8444-444444444444') = 'hash-propio', 'otros cambios no borran la contraseña');
