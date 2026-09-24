-- /api/notify-mail lee la notificación y el correo del cliente con el service
-- role: sin estos permisos PostgREST respondía "permission denied".
grant select on public.notifications to service_role;
grant select on public.profiles to service_role;
