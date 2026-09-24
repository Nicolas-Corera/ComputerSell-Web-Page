-- Correos de las notificaciones. Cada notificación para un cliente (pedido
-- recibido, cambios de estado, comprobante recibido/rechazado, cancelación) y
-- las del panel de ventas y pagos se mandan por mail: el trigger llama con
-- pg_net a /api/notify-mail (Vercel), que lee la notificación con el service
-- role y la envía por Resend. La URL y la clave viven en private.mail_hook
-- (se cargan fuera de la migración, no se commitean).
-- Si el hook falla la notificación se guarda igual: nunca corta una compra.
create extension if not exists pg_net;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.mail_hook (
  id int primary key default 1 check (id = 1),
  url text not null default '',
  secret text not null default ''
);
revoke all on private.mail_hook from public, anon, authenticated;

create or replace function private.notifications_mail()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_url text;
  v_secret text;
begin
  if new.audience = 'admin' and new.type not in ('venta', 'pago') then
    return new;
  end if;
  select url, secret into v_url, v_secret from private.mail_hook where id = 1;
  if coalesce(v_url, '') = '' then
    return new;
  end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', v_secret),
    timeout_milliseconds := 10000
  );
  return new;
exception when others then
  raise warning 'notifications_mail: %', sqlerrm;
  return new;
end;
$$;
revoke all on function private.notifications_mail() from public, anon, authenticated;

drop trigger if exists notifications_mail on public.notifications;
create trigger notifications_mail after insert on public.notifications
  for each row execute function private.notifications_mail();

-- Acuse al cliente cuando sube un comprobante de transferencia
create or replace function private.receipts_notify_user()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_number bigint;
begin
  select number into v_number from public.orders where id = new.order_id;
  perform public.notify_user(new.user_id, 'pago', 'receipt_long',
    format('Pedido CS-%s: recibimos tu comprobante', v_number),
    'Lo estamos revisando. Te avisamos cuando se acredite el pago.',
    jsonb_build_object('order', new.order_id));
  return new;
end;
$$;
revoke all on function private.receipts_notify_user() from public, anon, authenticated;

drop trigger if exists receipts_notify_user on public.payment_receipts;
create trigger receipts_notify_user after insert on public.payment_receipts
  for each row execute function private.receipts_notify_user();
