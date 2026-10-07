-- Seguridad: secuestro previo de cuenta (pre-account takeover).
-- Si alguien se registra con un correo ajeno, la cuenta queda sin confirmar
-- con SU contraseña. Cuando el dueño real se registra después, Supabase no
-- cambia la contraseña ("we can't be sure of their claimed identity") y solo
-- reenvía la confirmación: al confirmar, la cuenta quedaba con la contraseña
-- del atacante (y como admin, si el correo está en la allowlist).
--
-- Confirmar el correo prueba quién es el dueño de la casilla, pero no quién
-- eligió la contraseña. Por eso, al confirmar desde el mail, se borra la
-- contraseña guardada: quien tocó el enlace queda con la sesión iniciada y
-- auth.js le pide la contraseña (panel "nueva") antes de entrar.
--
-- Solo cuentas de email que confirmaron desde un mail (confirmation_sent_at):
-- no toca Google ni las altas con MAILER_AUTOCONFIRM=true (sin mail).
create or replace function public.reset_password_on_confirm()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.raw_app_meta_data->>'provider', 'email') = 'email' then
    new.encrypted_password := '';
  end if;
  return new;
end $$;
revoke all on function public.reset_password_on_confirm() from public, anon, authenticated;

drop trigger if exists on_auth_user_confirm_reset_password on auth.users;
create trigger on_auth_user_confirm_reset_password
  before update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null and new.confirmation_sent_at is not null)
  execute function public.reset_password_on_confirm();
