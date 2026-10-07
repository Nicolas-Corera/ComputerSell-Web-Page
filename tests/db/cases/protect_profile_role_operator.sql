-- [MEDIUM] admins:sync no podía degradar admins (protect_profile_role lo revertía).
-- Regresión: el SQL de scripts/sync-admins.js, corrido sin JWT, degrada al
-- admin que ya no está en ADMIN_EMAILS; un cliente sigue sin poder promoverse.

-- Un cliente no puede cambiarse el rol (ni el email)
select sandbox.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
update public.profiles set role = 'admin', email = 'otro@example.test' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select sandbox.as_operator();
select test.ok((select role from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 'customer', 'el cliente no se puede promover a admin');
select test.ok((select email from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 'customer-a@example.test', 'el cliente no puede cambiar su email de perfil');

-- admins:sync (operador, sin JWT) con ADMIN_EMAILS = nuevo-admin@... : el admin anterior se degrada
select sandbox.as_operator();
insert into auth.users(id, email, email_confirmed_at) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'nuevo-admin@example.test', now());
select test.ok(auth.uid() is null and not public.is_admin(), 'la sesión del operador no tiene JWT');
insert into public.admin_allowlist (email) values ('nuevo-admin@example.test') on conflict (email) do nothing;
delete from public.admin_allowlist where email not in ('nuevo-admin@example.test');
update public.profiles set role = 'customer' where role = 'admin' and lower(email) not in ('nuevo-admin@example.test');
update public.profiles p set role = 'admin' from auth.users u
  where u.id = p.id and u.email_confirmed_at is not null and lower(p.email) in ('nuevo-admin@example.test');
select test.ok((select role from public.profiles where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd') = 'customer', 'admins:sync degrada al admin quitado');
select test.ok((select role from public.profiles where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') = 'admin', 'admins:sync promueve al admin nuevo');

-- El ex admin ya no pasa is_admin()
select sandbox.as_user('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select test.ok(not public.is_admin(), 'el ex admin pierde los permisos');
select test.fails(format($$select public.set_order_status(%L, 'pagado', '')$$, test.fx('order_a')), 'Solo administradores', 'el ex admin no puede cambiar pedidos');

-- Un admin logueado sigue pudiendo cambiar roles desde el panel
select sandbox.as_user('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
update public.profiles set role = 'admin' where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
select sandbox.as_operator();
select test.ok((select role from public.profiles where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') = 'admin', 'el admin conserva su rol');
