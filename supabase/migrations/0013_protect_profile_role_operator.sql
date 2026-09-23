-- Seguridad: protect_profile_role revertía TODO cambio de rol hecho sin un
-- admin logueado, incluido el de `npm run admins:sync` (Management API, sin
-- JWT: auth.uid() es null e is_admin() da false). Resultado: sacar un correo
-- de ADMIN_EMAILS no le quitaba el rol admin a esa cuenta.
--
-- Ahora el bloqueo aplica a las sesiones de clientes (PostgREST: siempre traen
-- el sub del JWT y corren como anon/authenticated). Las sesiones de operador
-- sin JWT (Management API, SQL editor, service role) pueden cambiar el rol.
-- Un cliente sigue sin poder cambiarse el rol a sí mismo.
create or replace function public.protect_profile_role()
returns trigger language plpgsql as $$
begin
  if new.role <> old.role and not public.is_admin()
     and (auth.uid() is not null or current_user in ('anon', 'authenticated')) then
    new.role := old.role;
  end if;
  new.email := old.email;
  return new;
end $$;
