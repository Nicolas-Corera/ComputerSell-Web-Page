-- Menos correos y entrega automática (08/10/2026).
--
-- 1) Correos: solo los de la compra y el pago. Cada notificación tiene una
--    marca `mail`; /api/notify-mail manda correo únicamente si está en true.
--      Cliente: "Pedido CS-X: Pago confirmado" (con transferencia, recién
--               cuando el panel aprueba el comprobante; reemplaza también al
--               acuse "recibimos tu comprobante"), "comprobante rechazado"
--               (tiene 24 hs para subir otro) y "Tu pedido fue despachado".
--      Panel:   "Comprobante recibido · CS-X" y "Nueva venta CS-X" (siempre
--               después de confirmado el pago, nunca al crear el pedido).
--    El resto de los avisos del cliente siguen en Mi cuenta > Avisos y como
--    push (si las activó); los del panel quedan solo en el panel (sin push).
-- 2) "Entregado" ya no se marca a mano: al despachar se fija orders.deliver_by
--    (el último día hábil del plazo de entrega más lento del pedido, contado
--    desde el despacho) y pg_cron pasa el pedido a "entregado" al cumplirse.

-- =====================================================================
--  1) Marca de correo en las notificaciones
-- =====================================================================
alter table public.notifications add column if not exists mail boolean not null default false;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Igual que notify_user / notify_admins, pero el aviso también sale por correo
create or replace function private.notify_user_mail(p_user uuid, p_type text, p_icon text, p_title text, p_body text, p_target jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (audience, user_id, type, icon, title, body, target, mail)
  values ('user', p_user, p_type, p_icon, p_title, p_body, coalesce(p_target, '{}'::jsonb), true);
$$;
revoke all on function private.notify_user_mail(uuid, text, text, text, text, jsonb) from public, anon, authenticated;

create or replace function private.notify_admins_mail(p_type text, p_icon text, p_title text, p_body text, p_target jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (audience, type, icon, title, body, target, mail)
  values ('admin', p_type, p_icon, p_title, p_body, coalesce(p_target, '{}'::jsonb), true);
$$;
revoke all on function private.notify_admins_mail(text, text, text, text, jsonb) from public, anon, authenticated;

-- El hook recibe todos los avisos del cliente (push siempre; correo solo con
-- mail) y del panel solo los que van por correo.
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
  if new.audience = 'admin' and not new.mail then
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

-- Aviso al panel cuando llega un comprobante: por correo
create or replace function public.on_receipt_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype;
begin
  select * into v_o from public.orders where orders.id = new.order_id;
  perform private.notify_admins_mail('pago', 'account_balance', format('Comprobante recibido · CS-%s', v_o.number),
    format('%s envió el comprobante de la transferencia del pedido ($%s). Pendiente de revisión.',
           coalesce(nullif(v_o.customer->>'name', ''), 'Cliente'), public.ar_money(v_o.total)),
    jsonb_build_object('view', 'facturas', 'tab', 'recibidos', 'receipt', new.id, 'order', new.order_id));
  return new;
end $$;
revoke all on function public.on_receipt_insert() from public, anon, authenticated;

-- "Nueva venta" para el panel (por correo), una vez confirmado el pago
create or replace function private.notify_new_sale(p_order uuid, p_suffix text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_o public.orders%rowtype;
  v_first_title text := '';
  v_count integer := 0;
begin
  select * into v_o from public.orders where orders.id = p_order;
  select count(*) into v_count from public.order_items where order_id = p_order;
  select title into v_first_title from public.order_items where order_id = p_order limit 1;
  perform private.notify_admins_mail('venta', 'shopping_cart', format('Nueva venta CS-%s', v_o.number),
    format('%s compró %s%s por $%s.%s', coalesce(nullif(v_o.customer->>'name', ''), 'Un cliente'), coalesce(v_first_title, ''),
           case when v_count > 1 then format(' y %s más', v_count - 1) else '' end, public.ar_money(v_o.total),
           case when coalesce(p_suffix, '') <> '' then ' ' || p_suffix else '' end),
    jsonb_build_object('view', 'ordenes', 'tab', 'ventas', 'order', p_order));
end $$;
revoke all on function private.notify_new_sale(uuid, text) from public, anon, authenticated;

-- =====================================================================
--  2) Plazo de entrega: días hábiles desde el despacho
-- =====================================================================
alter table public.orders add column if not exists deliver_by timestamptz;

-- p_days días hábiles (lunes a viernes) después de p_from, a las 18 hs de
-- Buenos Aires. No contempla feriados.
create or replace function private.business_deadline(p_from timestamptz, p_days integer)
returns timestamptz language plpgsql stable set search_path = public as $$
declare
  c_tz constant text := 'America/Argentina/Buenos_Aires';
  d date := (p_from at time zone c_tz)::date;
  n integer := 0;
begin
  while n < greatest(coalesce(p_days, 1), 1) loop
    d := d + 1;
    if extract(isodow from d) < 6 then n := n + 1; end if;
  end loop;
  return (d + time '18:00') at time zone c_tz;
end $$;
revoke all on function private.business_deadline(timestamptz, integer) from public, anon, authenticated;

-- Plazo máximo del pedido: el producto más lento (products.delivery).
-- "A pedido" o un producto que ya no existe: 10 días hábiles.
create or replace function private.order_delivery_days(p_order uuid)
returns integer language sql stable set search_path = public as $$
  select coalesce(max(case p.delivery when '24-48hs' then 2 when '3-5' then 5 else 10 end), 10)
  from public.order_items i left join public.products p on p.id = i.product_id
  where i.order_id = p_order;
$$;
revoke all on function private.order_delivery_days(uuid) from public, anon, authenticated;

-- Pedidos ya despachados antes de esta migración
update public.orders o
  set deliver_by = private.business_deadline(
    coalesce((select min(e.created_at) from public.order_events e where e.order_id = o.id and e.status = 'enviado'), o.updated_at),
    private.order_delivery_days(o.id))
  where o.status = 'enviado' and o.deliver_by is null;

-- Pasa a "entregado" los pedidos despachados cuyo plazo ya se cumplió
create or replace function public.auto_deliver_orders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_o record;
  v_n integer := 0;
begin
  for v_o in
    select o.id, o.number, o.user_id from public.orders o
    where o.status = 'enviado' and o.deliver_by is not null and o.deliver_by <= now()
    for update skip locked
  loop
    update public.orders set status = 'entregado' where orders.id = v_o.id;
    insert into public.order_events (order_id, status, note)
    values (v_o.id, 'entregado', 'Automático: se cumplió el plazo máximo de entrega');
    perform public.notify_user(v_o.user_id, 'pedido', 'check_circle', format('Pedido CS-%s: Tu pedido fue entregado', v_o.number),
      '¡Gracias por tu compra! Si todavía no lo recibiste, escribinos por WhatsApp con el número de pedido.',
      jsonb_build_object('order', v_o.id));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.auto_deliver_orders() from public, anon, authenticated;
grant execute on function public.auto_deliver_orders() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule(jobid) from cron.job where jobname = 'cs-auto-deliver';
      perform cron.schedule('cs-auto-deliver', '*/30 * * * *', 'select public.auto_deliver_orders()');
    exception when others then
      raise notice 'No se pudo programar la entrega automática: %', sqlerrm;
    end;
  end if;
end $$;

-- =====================================================================
--  3) place_order: con transferencia el panel ve un "pedido nuevo" (sin
--     correo); la "Nueva venta" llega cuando se confirma el pago
-- =====================================================================
create or replace function public.place_order(
  p_user uuid, p_items jsonb, p_payment_method text, p_customer jsonb,
  p_installments integer, p_subtotal integer, p_shipping_cost integer, p_surcharge integer,
  p_note text default '', p_client_key uuid default null
)
returns table (id uuid, number integer, status text, total integer)
language plpgsql security definer set search_path = public as $$
declare
  c_max_qty constant integer := 10;    -- unidades por producto en un pedido
  c_max_lines constant integer := 30;  -- productos distintos en un pedido
  c_transfer_ttl constant interval := interval '48 hours';
  v_item jsonb;
  v_prod public.products%rowtype;
  v_qty integer;
  v_subtotal integer := 0;
  v_total integer := 0;
  v_order public.orders%rowtype;
  v_first_title text := '';
  v_count integer := 0;
begin
  if p_user is null or not exists (select 1 from public.profiles where profiles.id = p_user) then
    raise exception 'Tenés que iniciar sesión para comprar';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'El carrito está vacío'; end if;
  if jsonb_array_length(p_items) > c_max_lines then
    raise exception 'El pedido tiene demasiados productos distintos (máximo %). Dividilo en dos compras.', c_max_lines;
  end if;
  if p_payment_method not in ('credito', 'debito', 'transferencia') then raise exception 'Medio de pago inválido'; end if;
  if coalesce(p_shipping_cost, -1) < 0 or coalesce(p_surcharge, -1) < 0 then raise exception 'Montos inválidos'; end if;

  -- Reintento del mismo intento de compra (doble envío, corte de red): mismo pedido
  if p_client_key is not null then
    select * into v_order from public.orders o where o.user_id = p_user and o.client_key = p_client_key;
    if found then
      return query select v_order.id, v_order.number, v_order.status, v_order.total;
      return;
    end if;
  end if;

  -- Devuelve al stock las reservas vencidas (tarjeta y transferencia)
  perform public.expire_stale_orders();

  if p_payment_method in ('credito', 'debito') and (
    select count(*) from public.orders o
    where o.user_id = p_user and o.payment_method in ('credito', 'debito', 'mercadopago')
      and o.status = 'cancelado' and o.created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception 'Hiciste demasiados intentos de pago con tarjeta. Esperá una hora o elegí pagar por transferencia.';
  end if;

  -- Primera pasada: validar stock y calcular subtotal (bloqueando filas)
  for v_item in select * from jsonb_array_elements(p_items) loop
    if coalesce(v_item->>'qty', '1') !~ '^[0-9]{1,6}$' then raise exception 'Cantidad inválida'; end if;
    v_qty := greatest(1, coalesce((v_item->>'qty')::integer, 1));
    if v_qty > c_max_qty then
      raise exception 'Podés comprar hasta % unidades de cada producto por pedido. Si necesitás más, escribinos por WhatsApp.', c_max_qty;
    end if;
    if coalesce(v_item->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Un producto del carrito ya no está disponible';
    end if;
    select * into v_prod from public.products where products.id = (v_item->>'product_id')::uuid for update;
    if not found or v_prod.status <> 'publicado' then
      raise exception 'Un producto del carrito ya no está disponible';
    end if;
    if v_prod.stock < v_qty then
      raise exception 'Sin stock suficiente de "%": %', v_prod.title,
        case when v_prod.stock = 0 then 'se agotó' when v_prod.stock = 1 then 'queda 1 unidad' else format('quedan %s unidades', v_prod.stock) end;
    end if;
    v_subtotal := v_subtotal + v_prod.price * v_qty;
    v_count := v_count + 1;
    if v_first_title = '' then v_first_title := v_prod.title; end if;
  end loop;

  if v_subtotal <> p_subtotal then
    raise exception 'Los precios cambiaron mientras comprabas. Revisá el total y volvé a intentar.';
  end if;

  v_total := v_subtotal + p_shipping_cost + p_surcharge;

  insert into public.orders (user_id, status, payment_method, installments, shipping_method, shipping_cost, surcharge, subtotal, total, customer, note, client_key, expires_at)
  values (p_user, 'pendiente', p_payment_method, greatest(1, coalesce(p_installments, 1)), 'domicilio', p_shipping_cost, p_surcharge, v_subtotal, v_total,
          coalesce(p_customer, '{}'::jsonb), left(coalesce(p_note, ''), 500), p_client_key,
          case when p_payment_method = 'transferencia' then now() + c_transfer_ttl end)
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item->>'qty')::integer, 1));
    select * into v_prod from public.products where products.id = (v_item->>'product_id')::uuid;
    insert into public.order_items (order_id, product_id, title, sku, image, unit_price, qty)
    values (v_order.id, v_prod.id, v_prod.title, v_prod.sku, v_prod.images[1], v_prod.price, v_qty);
    update public.products set stock = stock - v_qty where products.id = v_prod.id;
  end loop;

  insert into public.order_events (order_id, status, note) values (v_order.id, 'pendiente', 'Pedido creado');

  if p_payment_method = 'transferencia' then
    perform public.notify_admins('venta', 'shopping_cart', format('Pedido nuevo CS-%s', v_order.number),
      format('%s pidió %s%s por $%s. Esperando la transferencia.', coalesce(nullif(p_customer->>'name', ''), 'Un cliente'), v_first_title,
             case when v_count > 1 then format(' y %s más', v_count - 1) else '' end, public.ar_money(v_total)),
      jsonb_build_object('view', 'ordenes', 'tab', 'ventas', 'order', v_order.id));
    perform public.notify_user(p_user, 'venta', 'shopping_bag', format('Recibimos tu pedido CS-%s', v_order.number),
      format('Transferí $%s y subí el comprobante desde el detalle del pedido antes del %s. Si no lo recibimos, el pedido se cancela solo.',
             public.ar_money(v_total), to_char(v_order.expires_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI "hs"')),
      jsonb_build_object('order', v_order.id));
  end if;

  return query select v_order.id, v_order.number, v_order.status, v_order.total;
end $$;
revoke all on function public.place_order(uuid, jsonb, text, jsonb, integer, integer, integer, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.place_order(uuid, jsonb, text, jsonb, integer, integer, integer, integer, text, uuid) to service_role;

-- =====================================================================
--  4) Estados del pedido desde el panel
-- =====================================================================
-- Pago confirmado y despacho: aviso por correo al cliente (y "Nueva venta" al
-- panel). Al despachar se fija el plazo de entrega (deliver_by).
create or replace function public.set_order_status(p_order uuid, p_status text, p_note text default '', p_tracking text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_o public.orders%rowtype;
  v_it record;
  v_tracking text := nullif(left(trim(coalesce(p_tracking, '')), 60), '');
  v_note text := left(trim(coalesce(p_note, '')), 300);
  v_allowed jsonb := '{"pendiente":["pagado","cancelado"],"pagado":["preparando","enviado","cancelado"],"preparando":["enviado","cancelado"],"enviado":["entregado","cancelado"],"entregado":["cancelado"],"cancelado":[]}';
  v_labels jsonb := '{"pagado":"Pago confirmado","preparando":"Tu pedido está en preparación","enviado":"Tu pedido fue despachado","entregado":"Tu pedido fue entregado","cancelado":"Tu pedido fue cancelado"}';
  v_icons jsonb := '{"pagado":"payments","preparando":"inventory_2","enviado":"local_shipping","entregado":"check_circle","cancelado":"cancel"}';
  v_deliver_by timestamptz;
  v_body text;
  v_title text;
begin
  if not public.is_admin() then raise exception 'Solo administradores'; end if;
  select * into v_o from public.orders where orders.id = p_order for update;
  if not found then raise exception 'Orden inexistente'; end if;
  if p_status not in ('pendiente', 'pagado', 'preparando', 'enviado', 'entregado', 'cancelado') then raise exception 'Estado inválido'; end if;

  -- Mismo estado: solo se corrige el código de seguimiento (y se avisa)
  if v_o.status = p_status then
    if v_tracking is not null and v_tracking is distinct from v_o.tracking then
      update public.orders set tracking = v_tracking where orders.id = p_order;
      insert into public.order_events (order_id, status, note) values (p_order, p_status, 'Código de seguimiento actualizado');
      perform public.notify_user(v_o.user_id, 'pedido', 'local_shipping', format('Pedido CS-%s: nuevo código de seguimiento', v_o.number),
        'Código de seguimiento: ' || v_tracking, jsonb_build_object('order', p_order));
    end if;
    return;
  end if;

  if not (v_allowed->v_o.status) ? p_status then
    raise exception 'No se puede pasar un pedido de "%" a "%"', v_o.status, p_status;
  end if;

  if p_status = 'enviado' then
    v_deliver_by := private.business_deadline(now(), private.order_delivery_days(p_order));
  end if;

  update public.orders set status = p_status,
    tracking = coalesce(v_tracking, tracking),
    paid_at = case when p_status = 'pagado' and paid_at is null then now() else paid_at end,
    deliver_by = case when p_status = 'enviado' then v_deliver_by else deliver_by end
    where orders.id = p_order;
  insert into public.order_events (order_id, status, note) values (p_order, p_status, v_note);

  if p_status = 'pagado' then perform public.issue_invoice(p_order); end if;

  if p_status = 'cancelado' then
    for v_it in select product_id, qty from public.order_items where order_id = p_order and product_id is not null loop
      update public.products set stock = stock + v_it.qty where products.id = v_it.product_id;
    end loop;
    delete from public.invoices where order_id = p_order;
  end if;

  v_body := case
    when p_status = 'pagado' and exists (select 1 from public.payment_receipts r where r.order_id = p_order and r.status = 'aprobado') then
      'Recibimos tu comprobante y verificamos la transferencia. Ya estamos preparando tu compra.'
    when p_status = 'pagado' and v_o.payment_method = 'transferencia' then
      'Verificamos tu transferencia. Ya estamos preparando tu compra.'
    when p_status = 'pagado' then 'Ya estamos preparando tu compra.'
    when p_status = 'enviado' then concat_ws(' ',
      case when coalesce(v_tracking, v_o.tracking, '') <> '' then 'Código de seguimiento: ' || coalesce(v_tracking, v_o.tracking) || '.' end,
      'Llega a más tardar el ' || to_char(v_deliver_by at time zone 'America/Argentina/Buenos_Aires', 'DD/MM') || '.')
    when p_status = 'cancelado' and v_o.status <> 'pendiente' then
      concat_ws(' ', nullif(v_note, ''), 'Te vamos a contactar para coordinar el reintegro del pago.')
    when v_note <> '' then v_note
    when p_status = 'preparando' then 'Te avisamos cuando lo despachemos.'
    when p_status = 'entregado' then '¡Gracias por tu compra!'
    else '' end;
  v_title := format('Pedido CS-%s: %s', v_o.number, v_labels->>p_status);

  if p_status in ('pagado', 'enviado') then
    perform private.notify_user_mail(v_o.user_id, 'pedido', v_icons->>p_status, v_title, v_body, jsonb_build_object('order', p_order));
  else
    perform public.notify_user(v_o.user_id, 'pedido', coalesce(v_icons->>p_status, 'local_shipping'), v_title, v_body, jsonb_build_object('order', p_order));
  end if;

  if p_status = 'pagado' then
    perform private.notify_new_sale(p_order, case when v_o.payment_method = 'transferencia' then 'Transferencia verificada.' else '' end);
  end if;
end $$;
revoke all on function public.set_order_status(uuid, text, text, text) from public, anon;
grant execute on function public.set_order_status(uuid, text, text, text) to authenticated;

-- =====================================================================
--  5) Mercado Pago (inactivo hoy): mismos correos que con transferencia
-- =====================================================================
create or replace function public.mp_apply_payment(p_order uuid, p_mp_order_id text, p_status text, p_status_detail text default '', p_payment jsonb default '{}'::jsonb)
returns table (id uuid, number integer, status text, total integer)
language plpgsql security definer set search_path = public as $$
declare
  v_o public.orders%rowtype;
  v_it record;
  v_card text;
  v_last text;
begin
  select * into v_o from public.orders where orders.id = p_order for update;
  if not found then raise exception 'Orden inexistente'; end if;

  update public.orders
    set mp_order_id = coalesce(p_mp_order_id, mp_order_id),
        payment = payment || coalesce(p_payment, '{}'::jsonb) || jsonb_build_object('provider', 'mercadopago', 'status', p_status, 'status_detail', coalesce(p_status_detail, ''))
    where orders.id = p_order
    returning * into v_o;

  v_card := trim(concat_ws(' ', nullif(v_o.payment->>'brand', ''), case when coalesce(v_o.payment->>'last_four', '') <> '' then '•••• ' || (v_o.payment->>'last_four') end));
  v_card := case when v_card <> '' then 'Mercado Pago · ' || v_card else 'Mercado Pago' end;

  if p_status = 'processed' then
    if v_o.status = 'pendiente' then
      update public.orders set status = 'pagado', paid_at = coalesce(paid_at, now()) where orders.id = p_order;
      insert into public.order_events (order_id, status, note) values (p_order, 'pagado', 'Pago acreditado (' || v_card || ')');
      perform public.issue_invoice(p_order);

      perform private.notify_new_sale(p_order);
      perform private.notify_user_mail(v_o.user_id, 'pedido', 'payments', format('Pedido CS-%s: Pago confirmado', v_o.number),
        'El pago con tarjeta se acreditó. Ya estamos preparando tu compra.', jsonb_build_object('order', p_order));
    elsif v_o.status = 'cancelado' then
      insert into public.order_events (order_id, status, note) values (p_order, 'cancelado', 'Mercado Pago acreditó el pago de una orden cancelada: reembolsar desde el panel de Mercado Pago');
      perform public.notify_admins('pago', 'error', format('Revisar pago · CS-%s', v_o.number),
        'Mercado Pago acreditó un pago sobre una orden cancelada. Hay que reembolsarlo.',
        jsonb_build_object('view', 'ordenes', 'tab', 'ventas', 'order', p_order));
    end if;

  elsif p_status in ('failed', 'canceled', 'expired') then
    if v_o.status = 'pendiente' then
      update public.orders set status = 'cancelado' where orders.id = p_order;
      for v_it in select product_id, qty from public.order_items where order_id = p_order and product_id is not null loop
        update public.products set stock = stock + v_it.qty where products.id = v_it.product_id;
      end loop;
      insert into public.order_events (order_id, status, note)
      values (p_order, 'cancelado', case p_status when 'failed' then 'Pago rechazado' when 'expired' then 'Pago vencido' else 'Pago cancelado' end
                                    || case when coalesce(p_status_detail, '') <> '' then ' (' || p_status_detail || ')' else '' end);
      delete from public.invoices where order_id = p_order;
      perform public.notify_user(v_o.user_id, 'pedido', 'cancel', format('Pedido CS-%s: el pago no se completó', v_o.number),
        'Mercado Pago no aprobó el pago y el pedido se canceló. Tu tarjeta no fue cobrada; podés volver a intentar la compra.',
        jsonb_build_object('order', p_order));
    end if;

  elsif p_status = 'refunded' then
    if v_o.status not in ('cancelado') then
      update public.orders set status = 'cancelado' where orders.id = p_order;
      for v_it in select product_id, qty from public.order_items where order_id = p_order and product_id is not null loop
        update public.products set stock = stock + v_it.qty where products.id = v_it.product_id;
      end loop;
      insert into public.order_events (order_id, status, note) values (p_order, 'cancelado', 'Pago reembolsado desde Mercado Pago');
      delete from public.invoices where order_id = p_order;
      perform public.notify_user(v_o.user_id, 'pedido', 'cancel', format('Pedido CS-%s: Tu pedido fue cancelado', v_o.number),
        'El pago fue reembolsado a tu medio de pago.', jsonb_build_object('order', p_order));
    end if;

  elsif p_status = 'charged_back' then
    insert into public.order_events (order_id, status, note) values (p_order, v_o.status, 'Contracargo en Mercado Pago (' || coalesce(p_status_detail, '') || ')');
    perform public.notify_admins('pago', 'error', format('Contracargo · CS-%s', v_o.number),
      'El cliente desconoció el pago en Mercado Pago. Revisá el caso desde el panel de Mercado Pago.',
      jsonb_build_object('view', 'ordenes', 'tab', 'ventas', 'order', p_order));

  else
    select note into v_last from public.order_events where order_id = p_order order by created_at desc limit 1;
    if v_o.status = 'pendiente' and coalesce(v_last, '') not like 'Pago en proceso%' then
      insert into public.order_events (order_id, status, note) values (p_order, 'pendiente', 'Pago en proceso en Mercado Pago' || case when coalesce(p_status_detail, '') <> '' then ' (' || p_status_detail || ')' else '' end);
    end if;
  end if;

  return query select o.id, o.number, o.status, o.total from public.orders o where o.id = p_order;
end $$;
revoke all on function public.mp_apply_payment(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mp_apply_payment(uuid, text, text, text, jsonb) to service_role;

-- =====================================================================
--  6) Comprobante rechazado: aviso por correo al cliente (tiene 24 hs para
--     subir otro antes de que el pedido se cancele solo)
-- =====================================================================
create or replace function public.review_receipt(p_receipt uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_r public.payment_receipts%rowtype; v_o public.orders%rowtype;
begin
  if not public.is_admin() then raise exception 'Solo administradores'; end if;
  select * into v_r from public.payment_receipts where payment_receipts.id = p_receipt for update;
  if not found then raise exception 'Comprobante inexistente'; end if;
  if v_r.status <> 'pendiente' then raise exception 'Este comprobante ya fue revisado'; end if;
  select * into v_o from public.orders where orders.id = v_r.order_id for update;
  if p_approve and v_o.status <> 'pendiente' then
    raise exception 'El pedido CS-% no está pendiente de pago (%): no se puede aprobar el comprobante', v_o.number, v_o.status;
  end if;
  update public.payment_receipts set status = case when p_approve then 'aprobado' else 'rechazado' end, reviewed_at = now()
    where payment_receipts.id = p_receipt;
  if p_approve then
    perform public.set_order_status(v_r.order_id, 'pagado', 'Transferencia verificada');
  elsif v_o.status = 'pendiente' then
    -- Tiene 24 h desde el rechazo para subir otro (expire_stale_transfer_orders)
    perform private.notify_user_mail(v_r.user_id, 'pago', 'error', format('Pedido CS-%s: comprobante rechazado', v_o.number),
      'No pudimos validar la transferencia. Subí un comprobante nuevo desde el detalle del pedido dentro de las próximas 24 hs.',
      jsonb_build_object('order', v_r.order_id));
  end if;
end $$;
revoke all on function public.review_receipt(uuid, boolean) from public, anon;
grant execute on function public.review_receipt(uuid, boolean) to authenticated;
