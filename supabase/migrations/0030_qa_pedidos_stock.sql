-- QA pre-lanzamiento (08/10/2026): pedidos, stock, comprobantes y arrepentimiento.
--
-- 1) Montos con formato argentino en avisos y mails ($1.899.999, no $1,899,999).
-- 2) Pedidos por transferencia:
--    - el pedido se crea ANTES de transferir (reserva el stock y fija el monto);
--      el comprobante se sube después desde la confirmación o el detalle;
--    - idempotencia: reintentar con la misma clave (client_key) devuelve el
--      mismo pedido en lugar de crear otro;
--    - tope de unidades por producto y de productos por pedido;
--    - vencen solos a las 48 h sin comprobante (pg_cron cada 15 min y, por las
--      dudas, también al crear pedidos);
--    - el cliente puede cancelar su pedido mientras no haya pagado.
-- 3) Comprobantes: el monto lo pone la base (total del pedido), la ruta del
--    archivo tiene que ser del cliente y del pedido y existir en el bucket, y
--    hay un tope de archivos por pedido.
-- 4) review_receipt solo revisa comprobantes pendientes (sin avisos duplicados).
-- 5) Estados: "entregado", cancelar un pedido despachado (devolución) y no se
--    vuelve a "pendiente" (generaba un aviso vacío).
-- 6) Stock: ajuste con control de concurrencia (set_product_stock) para que
--    editar un producto no pise las ventas hechas mientras tanto.
-- 7) Arrepentimiento: sin oráculo de pedidos por email, con límite de intentos,
--    y el panel puede gestionar las solicitudes (set_revocation_status).

-- =====================================================================
--  0) Utilidades
-- =====================================================================
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Correcciones de datos que se aplican una sola vez (db:push re-ejecuta todo)
create table if not exists private.data_fixes (
  name text primary key,
  applied_at timestamptz not null default now()
);
revoke all on private.data_fixes from public, anon, authenticated;

-- 1899999 -> '1.899.999' (sin depender del locale de la base, que es en_US)
create or replace function public.ar_money(p bigint)
returns text language sql immutable set search_path = public as $$
  select replace(to_char(coalesce(p, 0), 'FM999,999,999,999'), ',', '.');
$$;
grant execute on function public.ar_money(bigint) to anon, authenticated, service_role;

-- IP del pedido HTTP (PostgREST deja los headers en request.headers)
create or replace function private.request_ip()
returns text language sql stable set search_path = public as $$
  select coalesce(
    nullif(trim(h->>'cf-connecting-ip'), ''),
    nullif(trim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), ''),
    nullif(trim(h->>'x-real-ip'), ''),
    'sin-ip')
  from (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json as h) x;
$$;
revoke all on function private.request_ip() from public, anon, authenticated;

-- =====================================================================
--  1) Estados del pedido: se suma "entregado"
-- =====================================================================
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pendiente', 'pagado', 'preparando', 'enviado', 'entregado', 'cancelado'));

-- Clave de idempotencia del checkout (una por intento de compra del navegador)
alter table public.orders add column if not exists client_key uuid;
create unique index if not exists orders_user_client_key_idx on public.orders (user_id, client_key) where client_key is not null;
-- Vencimiento de la reserva de un pedido por transferencia
alter table public.orders add column if not exists expires_at timestamptz;

-- =====================================================================
--  2) Vencimiento de pedidos por transferencia sin comprobante
-- =====================================================================
-- Cancela los pedidos por transferencia pendientes que vencieron sin un
-- comprobante en revisión o aprobado. Si el último comprobante fue rechazado,
-- el cliente tiene al menos 24 h desde el rechazo para subir otro.
create or replace function public.expire_stale_transfer_orders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  c_reupload constant interval := interval '24 hours';
  v_o record;
  v_it record;
  v_n integer := 0;
begin
  for v_o in
    select o.id, o.number, o.user_id from public.orders o
    where o.status = 'pendiente' and o.payment_method = 'transferencia'
      and coalesce(o.expires_at, o.created_at + interval '48 hours') < now()
      and not exists (select 1 from public.payment_receipts r where r.order_id = o.id and r.status in ('pendiente', 'aprobado'))
      and coalesce((select max(r.reviewed_at) from public.payment_receipts r where r.order_id = o.id and r.status = 'rechazado'), '-infinity'::timestamptz) + c_reupload < now()
    for update skip locked
  loop
    update public.orders set status = 'cancelado' where orders.id = v_o.id;
    for v_it in select product_id, qty from public.order_items where order_id = v_o.id and product_id is not null loop
      update public.products set stock = stock + v_it.qty where products.id = v_it.product_id;
    end loop;
    delete from public.invoices where order_id = v_o.id;
    insert into public.order_events (order_id, status, note)
    values (v_o.id, 'cancelado', 'Vencido: no recibimos el comprobante de la transferencia a tiempo');
    perform public.notify_user(v_o.user_id, 'pedido', 'cancel', format('Pedido CS-%s: Tu pedido fue cancelado', v_o.number),
      'No recibimos el comprobante de la transferencia dentro del plazo y liberamos el stock. Si ya transferiste, escribinos por WhatsApp con el número de pedido.',
      jsonb_build_object('order', v_o.id));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.expire_stale_transfer_orders() from public, anon, authenticated;
grant execute on function public.expire_stale_transfer_orders() to service_role;

-- Pedidos con tarjeta y por transferencia: un solo punto de entrada
create or replace function public.expire_stale_orders()
returns integer language plpgsql security definer set search_path = public as $$
begin
  return public.expire_stale_card_orders() + public.expire_stale_transfer_orders();
end $$;
revoke all on function public.expire_stale_orders() from public, anon, authenticated;
grant execute on function public.expire_stale_orders() to service_role;

-- pg_cron: el vencimiento corre solo cada 15 minutos (no depende de que
-- alguien compre). Si la extensión no está disponible, queda el vencimiento al
-- crear pedidos y al abrir el detalle del pedido.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron no disponible: %', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule(jobid) from cron.job where jobname = 'cs-expire-stale-orders';
      perform cron.schedule('cs-expire-stale-orders', '*/15 * * * *', 'select public.expire_stale_orders()');
    exception when others then
      raise notice 'No se pudo programar el vencimiento: %', sqlerrm;
    end;
  end if;
end $$;

-- =====================================================================
--  3) place_order: idempotencia, topes de cantidad y vencimiento
-- =====================================================================
drop function if exists public.place_order(uuid, jsonb, text, jsonb, integer, integer, integer, integer, text);

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
    perform public.notify_admins('venta', 'shopping_cart', format('Nueva venta CS-%s', v_order.number),
      format('%s compró %s%s por $%s. Esperando la transferencia.', coalesce(nullif(p_customer->>'name', ''), 'Un cliente'), v_first_title,
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
--  4) El cliente cancela su pedido por transferencia sin pagar
-- =====================================================================
create or replace function public.cancel_my_order(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_o public.orders%rowtype;
  v_it record;
begin
  if auth.uid() is null then raise exception 'Tenés que iniciar sesión'; end if;
  select * into v_o from public.orders o where o.id = p_order and o.user_id = auth.uid() for update;
  if not found then raise exception 'Pedido inexistente'; end if;
  if v_o.status <> 'pendiente' or v_o.payment_method <> 'transferencia' then
    raise exception 'Este pedido ya no se puede cancelar desde acá. Si necesitás ayuda, escribinos por WhatsApp.';
  end if;
  if exists (select 1 from public.payment_receipts r where r.order_id = v_o.id and r.status in ('pendiente', 'aprobado')) then
    raise exception 'Ya nos enviaste el comprobante de este pedido. Escribinos por WhatsApp para cancelarlo y coordinar el reintegro.';
  end if;

  update public.orders set status = 'cancelado' where orders.id = v_o.id;
  for v_it in select product_id, qty from public.order_items where order_id = v_o.id and product_id is not null loop
    update public.products set stock = stock + v_it.qty where products.id = v_it.product_id;
  end loop;
  delete from public.invoices where order_id = v_o.id;
  insert into public.order_events (order_id, status, note) values (v_o.id, 'cancelado', 'Cancelado por el cliente antes de pagar');
  perform public.notify_admins('sistema', 'cancel', format('Pedido cancelado · CS-%s', v_o.number),
    format('%s canceló el pedido antes de pagar. El stock volvió al catálogo.', coalesce(nullif(v_o.customer->>'name', ''), 'El cliente')),
    jsonb_build_object('view', 'ordenes', 'tab', 'ventas', 'order', v_o.id));
end $$;
revoke all on function public.cancel_my_order(uuid) from public, anon;
grant execute on function public.cancel_my_order(uuid) to authenticated;

-- =====================================================================
--  5) Comprobantes de transferencia
-- =====================================================================
-- Archivos ya subidos para un pedido (tope por pedido en el bucket)
create or replace function public.receipt_object_count(p_user uuid, p_order uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer from storage.objects o
  where o.bucket_id = 'receipts' and o.name like p_user::text || '/' || p_order::text || '%';
$$;
revoke all on function public.receipt_object_count(uuid, uuid) from public, anon;
grant execute on function public.receipt_object_count(uuid, uuid) to authenticated;

-- Archivo: <user_id>/<order_id>-<timestamp>.<pdf|png|jpg|jpeg>, como máximo 5 por pedido
drop policy if exists "receipts own insert" on storage.objects;
create policy "receipts own insert" on storage.objects for insert
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~* ('^' || auth.uid()::text || '/[0-9a-f-]{36}(-[0-9]{10,16})?\.(pdf|png|jpe?g)$')
    and public.can_upload_receipt(public.receipt_object_order(name))
    and public.receipt_object_count(auth.uid(), public.receipt_object_order(name)) < 5
  );

-- La fila del comprobante: estado, monto y archivo los fija la base
create or replace function public.receipts_reset_review_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_o public.orders%rowtype;
begin
  select * into v_o from public.orders where orders.id = new.order_id;
  if not found or v_o.user_id <> new.user_id then raise exception 'Pedido inexistente'; end if;
  new.status := 'pendiente';
  new.reviewed_at := null;
  new.amount := v_o.total;                         -- nunca el monto que declara el navegador
  new.bank := left(trim(coalesce(new.bank, '')), 80);
  new.reference := left(trim(coalesce(new.reference, '')), 80);
  if new.file_path !~* ('^' || new.user_id::text || '/' || new.order_id::text || '(-[0-9]{10,16})?\.(pdf|png|jpe?g)$')
     or not exists (select 1 from storage.objects o where o.bucket_id = 'receipts' and o.name = new.file_path) then
    raise exception 'Subí el archivo del comprobante antes de enviarlo';
  end if;
  if exists (select 1 from public.payment_receipts r where r.file_path = new.file_path) then
    raise exception 'Ese archivo ya se usó en otro comprobante';
  end if;
  return new;
end $$;
revoke all on function public.receipts_reset_review_columns() from public, anon, authenticated;

-- Aviso al panel: con el total del pedido y un enlace directo al comprobante
create or replace function public.on_receipt_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype;
begin
  select * into v_o from public.orders where orders.id = new.order_id;
  perform public.notify_admins('pago', 'account_balance', format('Comprobante recibido · CS-%s', v_o.number),
    format('%s envió el comprobante de la transferencia del pedido ($%s). Pendiente de revisión.',
           coalesce(nullif(v_o.customer->>'name', ''), 'Cliente'), public.ar_money(v_o.total)),
    jsonb_build_object('view', 'facturas', 'tab', 'recibidos', 'receipt', new.id, 'order', new.order_id));
  return new;
end $$;
revoke all on function public.on_receipt_insert() from public, anon, authenticated;

-- Solo se revisan comprobantes pendientes: un doble click o un modal viejo no
-- duplica avisos ni aprueba comprobantes de pedidos cancelados
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
    perform public.notify_user(v_r.user_id, 'pago', 'error', format('Pedido CS-%s: comprobante rechazado', v_o.number),
      'No pudimos validar la transferencia. Subí un comprobante nuevo desde el detalle del pedido dentro de las próximas 24 hs.',
      jsonb_build_object('order', v_r.order_id));
  end if;
end $$;
revoke all on function public.review_receipt(uuid, boolean) from public, anon;
grant execute on function public.review_receipt(uuid, boolean) to authenticated;

-- =====================================================================
--  6) Estados del pedido desde el panel
-- =====================================================================
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
  v_body text;
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

  update public.orders set status = p_status,
    tracking = coalesce(v_tracking, tracking),
    paid_at = case when p_status = 'pagado' and paid_at is null then now() else paid_at end
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
    when p_status = 'enviado' and coalesce(v_tracking, v_o.tracking, '') <> '' then 'Código de seguimiento: ' || coalesce(v_tracking, v_o.tracking)
    when p_status = 'cancelado' and v_o.status <> 'pendiente' then
      concat_ws(' ', nullif(v_note, ''), 'Te vamos a contactar para coordinar el reintegro del pago.')
    when v_note <> '' then v_note
    when p_status = 'pagado' then 'Ya estamos preparando tu compra.'
    when p_status = 'preparando' then 'Te avisamos cuando lo despachemos.'
    when p_status = 'entregado' then '¡Gracias por tu compra!'
    else '' end;

  perform public.notify_user(v_o.user_id, 'pedido', coalesce(v_icons->>p_status, 'local_shipping'),
    format('Pedido CS-%s: %s', v_o.number, v_labels->>p_status), v_body, jsonb_build_object('order', p_order));
end $$;
revoke all on function public.set_order_status(uuid, text, text, text) from public, anon;
grant execute on function public.set_order_status(uuid, text, text, text) to authenticated;

-- =====================================================================
--  7) Mercado Pago (inactivo hoy): montos con formato local y aviso al
--     cliente cuando el pago con tarjeta se rechaza o vence
-- =====================================================================
create or replace function public.mp_apply_payment(p_order uuid, p_mp_order_id text, p_status text, p_status_detail text default '', p_payment jsonb default '{}'::jsonb)
returns table (id uuid, number integer, status text, total integer)
language plpgsql security definer set search_path = public as $$
declare
  v_o public.orders%rowtype;
  v_it record;
  v_card text;
  v_first_title text := '';
  v_count integer := 0;
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

      select count(*) into v_count from public.order_items where order_id = p_order;
      select title into v_first_title from public.order_items where order_id = p_order limit 1;
      perform public.notify_admins('venta', 'shopping_cart', format('Nueva venta CS-%s', v_o.number),
        format('%s compró %s%s por $%s.', coalesce(nullif(v_o.customer->>'name', ''), 'Un cliente'), v_first_title,
               case when v_count > 1 then format(' y %s más', v_count - 1) else '' end, public.ar_money(v_o.total)),
        jsonb_build_object('view', 'ordenes', 'tab', 'ventas', 'order', p_order));
      perform public.notify_user(v_o.user_id, 'venta', 'shopping_bag', format('Recibimos tu pedido CS-%s', v_o.number),
        'El pago se acreditó. Ya estamos preparando tu compra.', jsonb_build_object('order', p_order));
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
--  8) Stock: ajuste con control de concurrencia
-- =====================================================================
-- Cambia el stock solo si sigue siendo el que vio el admin (p_expected). Si
-- mientras tanto hubo una venta, falla y el panel muestra el valor actual.
create or replace function public.set_product_stock(p_product uuid, p_expected integer, p_new integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_stock integer;
begin
  if not public.is_admin() then raise exception 'Solo administradores'; end if;
  if p_new is null or p_new < 0 or p_new > 1000000 then raise exception 'El stock tiene que ser un número entero entre 0 y 1.000.000'; end if;
  select stock into v_stock from public.products where id = p_product for update;
  if not found then raise exception 'Producto inexistente'; end if;
  if p_expected is not null and v_stock <> p_expected then
    raise exception 'El stock cambió mientras editabas (ahora es %). Revisalo y volvé a guardar.', v_stock;
  end if;
  update public.products set stock = p_new where id = p_product;
  return p_new;
end $$;
revoke all on function public.set_product_stock(uuid, integer, integer) from public, anon;
grant execute on function public.set_product_stock(uuid, integer, integer) to authenticated;

-- Aviso de stock: solo productos publicados y con plural correcto
create or replace function public.on_stock_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'publicado' and new.stock <= new.stock_min and new.stock < old.stock and old.stock > old.stock_min then
    perform public.notify_admins('stock', 'inventory_2', case when new.stock = 0 then 'Sin stock' else 'Stock bajo' end,
      format('%s: %s.', new.title, case when new.stock = 0 then 'se agotó' when new.stock = 1 then 'queda 1 unidad' else format('quedan %s unidades', new.stock) end),
      jsonb_build_object('view', 'cargas', 'product', new.id));
  end if;
  return new;
end $$;
revoke all on function public.on_stock_change() from public, anon, authenticated;

-- =====================================================================
--  9) Arrepentimiento
-- =====================================================================
create or replace function public.request_revocation(p_order_number integer, p_email text default '', p_name text default '', p_dni text default '', p_received_on date default null, p_reason text default '')
returns table (request_code text, request_status text, order_number integer, deadline_date date, requested_at timestamptz, already_existed boolean)
language plpgsql security definer set search_path = public as $$
declare
  c_days constant integer := 10;
  c_transit constant integer := 20;
  c_tz constant text := 'America/Argentina/Buenos_Aires';
  c_generic constant text := 'No encontramos un pedido con ese número y ese email. Revisá los datos o escribinos.';
  v_uid uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_o public.orders%rowtype;
  v_found boolean;
  v_profile_email text;
  v_r public.revocation_requests%rowtype;
  v_shipped timestamptz;
  v_delivered timestamptz;
  v_bought date;
  v_start date;
  v_deadline date;
  v_today date := (now() at time zone c_tz)::date;
begin
  -- Validaciones que no dependen del pedido, ANTES de buscarlo: ningún
  -- mensaje distinto revela si un número de pedido es de un email
  if p_order_number is null or p_order_number < 1 then raise exception '%', c_generic; end if;
  if p_received_on is not null and p_received_on > v_today then
    raise exception 'La fecha en que recibiste el producto no puede ser futura.';
  end if;

  -- Límite de intentos (adivinar pedidos de otra persona): por IP y por pedido
  if not public.mail_rate_hit(jsonb_build_array(
       jsonb_build_object('key', 'revocation:ip:' || private.request_ip(), 'limit', 10, 'window', 3600),
       jsonb_build_object('key', 'revocation:order:' || p_order_number, 'limit', 6, 'window', 3600))) then
    raise exception 'Hiciste demasiados intentos. Esperá una hora o escribinos por WhatsApp.';
  end if;

  select * into v_o from public.orders o where o.number = p_order_number;
  v_found := found;
  if v_found then
    select lower(p.email) into v_profile_email from public.profiles p where p.id = v_o.user_id;
  end if;

  if not v_found
     or not (
       (v_uid is not null and v_o.user_id = v_uid)
       or (v_email <> '' and v_email in (lower(coalesce(v_o.customer->>'email', '')), coalesce(v_profile_email, '')))
     ) then
    raise exception '%', c_generic;
  end if;

  if v_o.status = 'cancelado' then
    raise exception 'El pedido CS-% ya está cancelado: no hace falta pedir el arrepentimiento. Si pagaste, el reintegro ya está en curso.', v_o.number;
  end if;

  select * into v_r from public.revocation_requests r
    where r.order_id = v_o.id and r.status in ('recibida', 'en_curso', 'reintegrada')
    order by r.created_at desc limit 1;
  if found then
    return query select v_r.code, v_r.status, v_o.number, v_r.deadline, v_r.created_at, true;
    return;
  end if;

  select min(e.created_at) into v_shipped from public.order_events e where e.order_id = v_o.id and e.status = 'enviado';
  select min(e.created_at) into v_delivered from public.order_events e where e.order_id = v_o.id and e.status = 'entregado';
  v_bought := (v_o.created_at at time zone c_tz)::date;

  if p_received_on is not null and p_received_on < coalesce((v_shipped at time zone c_tz)::date, v_bought) then
    raise exception 'La fecha en que recibiste el producto no puede ser anterior al despacho del pedido.';
  end if;

  -- 10 días corridos desde la compra o la entrega (lo último). Entrega: la que
  -- informa el cliente, la registrada en el panel o la presunta (despacho + tránsito)
  v_start := greatest(
    v_bought,
    coalesce(p_received_on, (v_delivered at time zone c_tz)::date, (v_shipped at time zone c_tz)::date + c_transit, v_today)
  );
  v_deadline := v_start + c_days;

  if v_today > v_deadline then
    raise exception 'El plazo de 10 días para arrepentirte de la compra CS-% venció el %. Si recibiste el producto más tarde, indicá la fecha de recepción o escribinos.',
      v_o.number, to_char(v_deadline, 'DD/MM/YYYY');
  end if;

  insert into public.revocation_requests (code, order_id, user_id, name, email, dni, reason, received_on, shipped_at, deadline)
  values (
    'ARR-' || lpad(nextval('public.revocation_number_seq')::text, 6, '0'),
    v_o.id, v_o.user_id,
    left(trim(coalesce(p_name, '')), 120),
    left(coalesce(nullif(v_email, ''), lower(coalesce(v_o.customer->>'email', ''))), 120),
    left(regexp_replace(coalesce(p_dni, ''), '\D', '', 'g'), 12),
    left(trim(coalesce(p_reason, '')), 1000),
    p_received_on, v_shipped, v_deadline
  )
  returning * into v_r;

  insert into public.order_events (order_id, status, note)
  values (v_o.id, v_o.status, 'Solicitud de arrepentimiento ' || v_r.code);

  perform public.notify_admins('venta', 'receipt_long', format('Arrepentimiento · CS-%s', v_o.number),
    format('%s pidió revocar la compra (solicitud %s). Coordinar la devolución y el reintegro del total.',
           coalesce(nullif(v_r.name, ''), nullif(v_o.customer->>'name', ''), 'El cliente'), v_r.code),
    jsonb_build_object('view', 'arrepentimientos', 'revocation', v_r.id, 'order', v_o.id));
  perform public.notify_user(v_o.user_id, 'pedido', 'info', format('Recibimos tu arrepentimiento · CS-%s', v_o.number),
    format('Código de tu solicitud: %s. Te vamos a contactar para coordinar la devolución del producto y el reintegro.', v_r.code),
    jsonb_build_object('order', v_o.id));

  return query select v_r.code, v_r.status, v_o.number, v_r.deadline, v_r.created_at, false;
end $$;
revoke all on function public.request_revocation(integer, text, text, text, date, text) from public;
grant execute on function public.request_revocation(integer, text, text, text, date, text) to anon, authenticated;

-- El panel cambia el estado de una solicitud (queda en el historial del
-- pedido y se le avisa al cliente)
create or replace function public.set_revocation_status(p_id uuid, p_status text, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_r public.revocation_requests%rowtype;
  v_o public.orders%rowtype;
  v_note text := left(trim(coalesce(p_note, '')), 500);
  v_labels jsonb := '{"en_curso":"en curso","reintegrada":"reintegrada","rechazada":"rechazada","desistida":"desistida"}';
begin
  if not public.is_admin() then raise exception 'Solo administradores'; end if;
  if p_status not in ('en_curso', 'reintegrada', 'rechazada', 'desistida') then raise exception 'Estado inválido'; end if;
  if p_status = 'rechazada' and v_note = '' then raise exception 'Indicá el motivo del rechazo: se le informa al cliente.'; end if;
  select * into v_r from public.revocation_requests where id = p_id for update;
  if not found then raise exception 'Solicitud inexistente'; end if;
  if v_r.status in ('reintegrada', 'rechazada', 'desistida') then raise exception 'La solicitud % ya está cerrada', v_r.code; end if;
  if v_r.status = p_status then return; end if;

  update public.revocation_requests
    set status = p_status,
        admin_note = case when v_note <> '' then v_note else admin_note end,
        resolved_at = case when p_status in ('reintegrada', 'rechazada', 'desistida') then now() else null end
    where id = p_id;
  select * into v_o from public.orders where id = v_r.order_id;
  insert into public.order_events (order_id, status, note)
  values (v_o.id, v_o.status, format('Arrepentimiento %s: %s', v_r.code, v_labels->>p_status) || case when v_note <> '' then ' · ' || v_note else '' end);
  perform public.notify_user(v_r.user_id, 'pedido', 'info', format('Arrepentimiento %s: %s', v_r.code, v_labels->>p_status),
    case when v_note <> '' then v_note
         when p_status = 'en_curso' then 'Estamos coordinando la devolución del producto y el reintegro.'
         when p_status = 'reintegrada' then 'Te reintegramos el total de la compra.'
         else '' end,
    jsonb_build_object('order', v_o.id));
end $$;
revoke all on function public.set_revocation_status(uuid, text, text) from public, anon;
grant execute on function public.set_revocation_status(uuid, text, text) to authenticated;

-- Los cambios pasan por set_revocation_status (historial + aviso al cliente)
drop policy if exists revocations_admin_update on public.revocation_requests;
revoke update on public.revocation_requests from authenticated;
