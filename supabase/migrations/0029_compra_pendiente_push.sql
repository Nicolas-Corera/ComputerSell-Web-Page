-- Compra pendiente y notificaciones push.
--
-- 1) Compra pendiente: el carrito vive en el navegador (localStorage), así que
--    si el cliente se va del pago y borra los datos del sitio, se pierde. Lo
--    que está en /pago se guarda también en la cuenta (checkout_drafts). Al
--    volver —en otra visita, aunque haya borrado todo— el sitio recupera el
--    carrito y deja el aviso "Tenés una compra pendiente" en Avisos.
--    Al crearse un pedido el borrador y su aviso se borran solos.
-- 2) Push: cada navegador que acepta notificaciones guarda su suscripción Web
--    Push (push_subscriptions). /api/notify-mail, que ya recibe cada aviso
--    del cliente por el trigger notifications_mail, además del correo manda
--    la notificación push a esos navegadores.

-- ---------------------------------------------------------------------
-- 1) Compra pendiente
-- ---------------------------------------------------------------------
create table if not exists public.checkout_drafts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  items jsonb not null default '[]'::jsonb, -- [{id, qty}]
  updated_at timestamptz not null default now(),
  notified_at timestamptz
);
alter table public.checkout_drafts enable row level security;
-- Sin políticas: se usa solo por las funciones de abajo
revoke all on public.checkout_drafts from public, anon, authenticated;

-- Guarda lo que hay en el pago (lo llama pago.js). Solo productos publicados,
-- cantidades 1..99 y hasta 50 ítems. Vacío = no hay compra pendiente.
create or replace function public.save_checkout_draft(p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_items jsonb;
begin
  if v_uid is null then
    raise exception 'Tenés que iniciar sesión';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'qty', x.qty) order by x.ord), '[]'::jsonb)
    into v_items
  from (
    select distinct on (it.id) it.id, it.qty, it.ord
    from (
      select
        case when e.item->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (e.item->>'id')::uuid end as id,
        case when e.item->>'qty' ~ '^[0-9]{1,4}$'
          then least(greatest((e.item->>'qty')::int, 1), 99) else 1 end as qty,
        e.ord
      from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end)
        with ordinality as e(item, ord)
      where e.ord <= 50
    ) it
    where it.id is not null
    order by it.id, it.ord
  ) x
  join public.products p on p.id = x.id and p.status = 'publicado';

  if jsonb_array_length(v_items) = 0 then
    delete from public.checkout_drafts where user_id = v_uid;
    return;
  end if;
  -- Volvió a estar en el pago: si se va de nuevo, se lo vuelve a avisar
  insert into public.checkout_drafts (user_id, items, updated_at, notified_at)
  values (v_uid, v_items, now(), null)
  on conflict (user_id) do update set items = excluded.items, updated_at = now(), notified_at = null;
end;
$$;

-- Vació el carrito: ya no hay compra pendiente (ni su aviso)
create or replace function public.clear_checkout_draft()
returns void language sql security definer set search_path = public as $$
  delete from public.checkout_drafts where user_id = auth.uid();
  delete from public.notifications where user_id = auth.uid() and type = 'carrito';
$$;

-- Al volver al sitio (primera página de la visita, con sesión):
-- devuelve {items, notified} o null si no hay compra pendiente.
-- p_notify: crear el aviso (no desde el pago mismo). Se avisa una vez por
-- abandono y solo si pasaron 2 minutos desde la última vez en el pago (una
-- pestaña nueva mientras sigue pagando no cuenta como "se fue").
create or replace function public.pending_checkout(p_notify boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  d public.checkout_drafts;
  v_qty int;
begin
  if v_uid is null then
    return null;
  end if;
  select * into d from public.checkout_drafts where user_id = v_uid;
  if not found then
    return null;
  end if;
  if not p_notify or d.notified_at is not null or d.updated_at > now() - interval '2 minutes' then
    return jsonb_build_object('items', d.items, 'notified', false);
  end if;

  select coalesce(sum((x->>'qty')::int), 0) into v_qty from jsonb_array_elements(d.items) x;
  delete from public.notifications where user_id = v_uid and type = 'carrito';
  perform public.notify_user(v_uid, 'carrito', 'shopping_cart', 'Tenés una compra pendiente',
    format('Dejaste %s producto%s sin pagar. Tu carrito te espera para terminar la compra.',
      v_qty, case when v_qty = 1 then '' else 's' end),
    jsonb_build_object('url', '/pago.html'));
  update public.checkout_drafts set notified_at = now() where user_id = v_uid;
  return jsonb_build_object('items', d.items, 'notified', true);
end;
$$;

revoke all on function public.save_checkout_draft(jsonb) from public, anon;
revoke all on function public.clear_checkout_draft() from public, anon;
revoke all on function public.pending_checkout(boolean) from public, anon;
grant execute on function public.save_checkout_draft(jsonb) to authenticated;
grant execute on function public.clear_checkout_draft() to authenticated;
grant execute on function public.pending_checkout(boolean) to authenticated;

-- Pedido creado (cualquier medio de pago): la compra ya no está pendiente
create or replace function private.orders_clear_checkout_draft()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  delete from public.checkout_drafts where user_id = new.user_id;
  delete from public.notifications where user_id = new.user_id and type = 'carrito';
  return new;
end;
$$;
revoke all on function private.orders_clear_checkout_draft() from public, anon, authenticated;

drop trigger if exists orders_clear_checkout_draft on public.orders;
create trigger orders_clear_checkout_draft after insert on public.orders
  for each row execute function private.orders_clear_checkout_draft();

-- ---------------------------------------------------------------------
-- 2) Suscripciones Web Push (una por navegador)
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  -- Solo servicios de push de navegadores (evita que el backend haga pedidos a
  -- cualquier URL: misma lista que api/_lib/push.js)
  endpoint text primary key check (
    length(endpoint) <= 1000
    and endpoint ~ '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)(:443)?/'
  ),
  user_id uuid not null references public.profiles(id) on delete cascade,
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}=*$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{16,32}=*$'),
  user_agent text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id, created_at desc);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
-- /api/notify-mail las lee con el service role y borra las vencidas
grant select, delete on public.push_subscriptions to service_role;

-- Este navegador acepta notificaciones de la cuenta. Si el navegador estaba
-- con otra cuenta pasa a esta. Hasta 10 navegadores por cuenta.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Tenés que iniciar sesión';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, user_agent)
  values (p_endpoint, v_uid, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
  delete from public.push_subscriptions
  where user_id = v_uid
    and endpoint not in (
      select endpoint from public.push_subscriptions where user_id = v_uid order by created_at desc limit 10
    );
end;
$$;

-- Este navegador deja de recibir notificaciones (desactivó o cerró sesión)
create or replace function public.delete_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- ---------------------------------------------------------------------
-- 3) El aviso de compra pendiente se ve en el sitio (el cliente acaba de
--    volver): no se manda por correo ni por push.
-- ---------------------------------------------------------------------
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
  if new.type = 'carrito' then
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
