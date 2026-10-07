-- Verificación en dos pasos (2FA) opcional para administrar.
-- 0026 la exigía a todo admin. Ahora el login del panel la ofrece (modal) y
-- cada admin decide; pero quien la activó queda protegido igual: si tiene un
-- factor verificado, una sesión con solo la contraseña (aal1) no es admin
-- para la base. Así una contraseña robada no alcanza para quien usa 2FA.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
     and (
       coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
       or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
     );
$$;
