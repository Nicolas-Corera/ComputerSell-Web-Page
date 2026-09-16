-- ComputerSell · esquema inicial
-- Se aplica con: npm run db:push (usa el token de Supabase del .env)

create extension if not exists pgcrypto;

-- =====================================================================
--  ADMINS PERMITIDOS (se sincroniza desde ADMIN_EMAILS del .env)
-- =====================================================================
create table if not exists public.admin_allowlist (
  email text primary key,
  created_at timestamptz not null default now()
);

-- =====================================================================
--  PERFILES (1:1 con auth.users)
-- =====================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  first_name text not null default '',
  last_name text not null default '',
  phone text not null default '',
  avatar_url text,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  address jsonb not null default '{}'::jsonb,
  marketing boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Crea el perfil al registrarse. El rol es admin solo si el correo está en la allowlist.
-- Con Google se toma el nombre y la foto de perfil de la cuenta.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  full_name text := coalesce(meta->>'full_name', meta->>'name', '');
  fn text := coalesce(meta->>'first_name', split_part(full_name, ' ', 1), '');
  ln text := coalesce(meta->>'last_name', nullif(regexp_replace(full_name, '^\S+\s*', ''), ''), '');
  is_allowed boolean := exists (select 1 from public.admin_allowlist a where lower(a.email) = lower(new.email));
begin
  insert into public.profiles (id, email, first_name, last_name, phone, avatar_url, role, marketing)
  values (
    new.id,
    new.email,
    fn, ln,
    coalesce(meta->>'phone', ''),
    coalesce(meta->>'avatar_url', meta->>'picture'),
    case when is_allowed then 'admin' else 'customer' end,
    coalesce((meta->>'marketing')::boolean, true)
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Si se agrega un correo a la allowlist y el usuario ya existe, pasa a admin.
create or replace function public.promote_allowlisted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set role = 'admin' where lower(email) = lower(new.email);
  return new;
end $$;
drop trigger if exists allowlist_promote on public.admin_allowlist;
create trigger allowlist_promote after insert on public.admin_allowlist
  for each row execute function public.promote_allowlisted();

-- =====================================================================
--  PRODUCTOS
-- =====================================================================
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  title text not null,
  brand text not null default '',
  category text not null check (category in ('computadoras', 'notebooks', 'componentes', 'perifericos')),
  subcategory text not null default '',
  description text not null default '',
  tags text[] not null default '{}',
  price integer not null check (price >= 0),
  cost integer not null default 0,
  old_price integer not null default 0,
  on_sale boolean not null default false,
  stock integer not null default 0 check (stock >= 0),
  stock_min integer not null default 3,
  status text not null default 'publicado' check (status in ('publicado', 'borrador', 'pausado')),
  warranty_months integer not null default 12,
  featured boolean not null default false,
  installments integer not null default 0,
  free_shipping boolean not null default false,
  delivery text not null default '24-48hs',
  weight numeric not null default 0,
  dimensions text not null default '',
  condition text not null default 'nuevo',
  images text[] not null default '{}',
  specs jsonb not null default '[]'::jsonb,
  highlights jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_status_idx on public.products (status, category);
drop trigger if exists products_updated_at on public.products;
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

-- =====================================================================
--  FAVORITOS
-- =====================================================================
create table if not exists public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

-- =====================================================================
--  ÓRDENES
-- =====================================================================
create sequence if not exists public.order_number_seq start 10480;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  number integer not null default nextval('public.order_number_seq') unique,
  user_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'pagado', 'preparando', 'enviado', 'entregado', 'cancelado')),
  payment_method text not null check (payment_method in ('credito', 'debito', 'transferencia', 'mercadopago')),
  installments integer not null default 1,
  shipping_method text not null default 'domicilio' check (shipping_method in ('domicilio', 'retiro')),
  shipping_cost integer not null default 0,
  surcharge integer not null default 0,
  subtotal integer not null default 0,
  total integer not null default 0,
  customer jsonb not null default '{}'::jsonb, -- snapshot: name, email, phone, dni, address
  note text not null default '',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_user_idx on public.orders (user_id, created_at desc);
create index if not exists orders_created_idx on public.orders (created_at desc);
drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  title text not null,
  sku text not null default '',
  image text,
  unit_price integer not null,
  qty integer not null check (qty > 0)
);
create index if not exists order_items_order_idx on public.order_items (order_id);

-- Historial de estados (timeline)
create table if not exists public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  status text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events (order_id, created_at);

-- =====================================================================
--  FACTURAS (se emiten al confirmar el pago)
-- =====================================================================
create sequence if not exists public.invoice_number_seq start 20000;
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  number text not null unique,
  type text not null default 'B' check (type in ('A', 'B', 'C', 'NC')),
  total integer not null,
  cae text not null,
  issued_at timestamptz not null default now()
);
create index if not exists invoices_order_idx on public.invoices (order_id);

-- =====================================================================
--  COMPROBANTES DE TRANSFERENCIA
-- =====================================================================
create table if not exists public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  file_path text not null,
  bank text not null default '',
  reference text not null default '',
  amount integer not null default 0,
  status text not null default 'pendiente' check (status in ('pendiente', 'aprobado', 'rechazado')),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- =====================================================================
--  RESERVAS (seña) — el panel las gestiona; la tienda las crea a futuro
-- =====================================================================
create sequence if not exists public.reservation_number_seq start 120;
create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  number integer not null default nextval('public.reservation_number_seq') unique,
  user_id uuid not null references public.profiles(id) on delete restrict,
  product_id uuid references public.products(id) on delete set null,
  qty integer not null default 1,
  deposit integer not null default 0,
  status text not null default 'activa' check (status in ('activa', 'por-vencer', 'retirada', 'vencida', 'cancelada')),
  note text not null default '',
  customer jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists reservations_updated_at on public.reservations;
create trigger reservations_updated_at before update on public.reservations
  for each row execute function public.set_updated_at();

-- =====================================================================
--  NOTIFICACIONES
--  audience = 'admin' -> para todos los administradores (leídas por read_by)
--  audience = 'user'  -> para user_id
-- =====================================================================
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('admin', 'user')),
  user_id uuid references public.profiles(id) on delete cascade,
  type text not null default 'sistema',
  icon text not null default 'notifications',
  title text not null,
  body text not null default '',
  target jsonb not null default '{}'::jsonb,
  read_by uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_admin_idx on public.notifications (audience, created_at desc);

create or replace function public.notify_admins(p_type text, p_icon text, p_title text, p_body text, p_target jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (audience, type, icon, title, body, target)
  values ('admin', p_type, p_icon, p_title, p_body, coalesce(p_target, '{}'::jsonb));
$$;

create or replace function public.notify_user(p_user uuid, p_type text, p_icon text, p_title text, p_body text, p_target jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (audience, user_id, type, icon, title, body, target)
  values ('user', p_user, p_type, p_icon, p_title, p_body, coalesce(p_target, '{}'::jsonb));
$$;

-- Emite la factura de una orden (una sola vez)
create or replace function public.issue_invoice(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_n bigint;
begin
  select * into v_o from public.orders where orders.id = p_order;
  if not found or exists (select 1 from public.invoices where order_id = p_order and type <> 'NC') then return; end if;
  v_n := nextval('public.invoice_number_seq');
  insert into public.invoices (order_id, number, type, total, cae)
  values (p_order, 'B-0003-' || lpad(v_n::text, 8, '0'), 'B', v_o.total, (76000000000000 + floor(random() * 999999999))::bigint::text);
end $$;

-- =====================================================================
--  RPC: crear orden (valida stock, descuenta, snapshot de precios)
-- =====================================================================
create or replace function public.place_order(
  p_items jsonb,            -- [{product_id, qty}]
  p_payment_method text,
  p_shipping_method text,
  p_customer jsonb,
  p_installments integer default 1,
  p_note text default ''
)
returns table (id uuid, number integer, status text, total integer)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_prod public.products%rowtype;
  v_qty integer;
  v_subtotal integer := 0;
  v_shipping integer := 0;
  v_rate numeric := 0;
  v_surcharge integer := 0;
  v_total integer := 0;
  v_order public.orders%rowtype;
  v_status text;
  v_all_free boolean := true;
  v_first_title text := '';
  v_count integer := 0;
begin
  if v_uid is null then raise exception 'Tenés que iniciar sesión para comprar'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'El carrito está vacío'; end if;
  if p_payment_method not in ('credito', 'debito', 'transferencia', 'mercadopago') then raise exception 'Medio de pago inválido'; end if;

  -- Primera pasada: validar stock y calcular subtotal (bloqueando filas)
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item->>'qty')::integer, 1));
    select * into v_prod from public.products where products.id = (v_item->>'product_id')::uuid for update;
    if not found or v_prod.status <> 'publicado' then
      raise exception 'Un producto del carrito ya no está disponible';
    end if;
    if v_prod.stock < v_qty then
      raise exception 'Sin stock suficiente de "%": quedan % unidad(es)', v_prod.title, v_prod.stock;
    end if;
    v_subtotal := v_subtotal + v_prod.price * v_qty;
    v_all_free := v_all_free and v_prod.free_shipping;
    v_count := v_count + 1;
    if v_first_title = '' then v_first_title := v_prod.title; end if;
  end loop;

  v_shipping := case when p_shipping_method = 'retiro' or v_all_free then 0 else 15000 end;
  v_rate := case p_payment_method when 'credito' then 0.10 when 'debito' then 0.03 when 'mercadopago' then 0.05 else 0 end;
  v_surcharge := round(v_subtotal * v_rate);
  v_total := v_subtotal + v_shipping + v_surcharge;
  -- Simulación de pago: tarjeta/MP se acreditan al instante; transferencia queda pendiente
  v_status := case when p_payment_method = 'transferencia' then 'pendiente' else 'pagado' end;

  insert into public.orders (user_id, status, payment_method, installments, shipping_method, shipping_cost, surcharge, subtotal, total, customer, note, paid_at)
  values (v_uid, v_status, p_payment_method, greatest(1, coalesce(p_installments, 1)), coalesce(p_shipping_method, 'domicilio'), v_shipping, v_surcharge, v_subtotal, v_total, coalesce(p_customer, '{}'::jsonb), coalesce(p_note, ''),
          case when v_status = 'pagado' then now() end)
  returning * into v_order;

  -- Segunda pasada: ítems y descuento de stock
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item->>'qty')::integer, 1));
    select * into v_prod from public.products where products.id = (v_item->>'product_id')::uuid;
    insert into public.order_items (order_id, product_id, title, sku, image, unit_price, qty)
    values (v_order.id, v_prod.id, v_prod.title, v_prod.sku, v_prod.images[1], v_prod.price, v_qty);
    update public.products set stock = stock - v_qty where products.id = v_prod.id;
  end loop;

  insert into public.order_events (order_id, status, note) values (v_order.id, 'pendiente', 'Orden creada');
  if v_status = 'pagado' then
    insert into public.order_events (order_id, status, note) values (v_order.id, 'pagado', 'Pago acreditado');
    perform public.issue_invoice(v_order.id);
  end if;

  perform public.notify_admins('venta', 'shopping_cart', format('Nueva venta CS-%s', v_order.number),
    format('%s compró %s%s por $%s.', coalesce(p_customer->>'name', 'Un cliente'), v_first_title,
           case when v_count > 1 then format(' y %s más', v_count - 1) else '' end, to_char(v_total, 'FM999G999G999')),
    jsonb_build_object('view', 'ordenes', 'tab', 'ventas', 'order', v_order.id));
  perform public.notify_user(v_uid, 'venta', 'shopping_bag', format('Recibimos tu pedido CS-%s', v_order.number),
    case when v_status = 'pagado' then 'El pago se acreditó. Ya estamos preparando tu compra.'
         else 'Cuando revisemos tu comprobante de transferencia te avisamos por acá.' end,
    jsonb_build_object('order', v_order.id));

  return query select v_order.id, v_order.number, v_order.status, v_order.total;
end $$;

-- =====================================================================
--  RPC: cambiar estado de orden (solo admin)
-- =====================================================================
create or replace function public.set_order_status(p_order uuid, p_status text, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_it record; v_labels jsonb := '{"pagado":"Pago confirmado","preparando":"Tu pedido está en preparación","enviado":"Tu pedido fue despachado","entregado":"Tu pedido fue entregado","cancelado":"Tu pedido fue cancelado"}';
begin
  if not public.is_admin() then raise exception 'Solo administradores'; end if;
  select * into v_o from public.orders where orders.id = p_order for update;
  if not found then raise exception 'Orden inexistente'; end if;
  if v_o.status = p_status then return; end if;
  if v_o.status in ('cancelado', 'entregado') then raise exception 'La orden ya está cerrada'; end if;

  update public.orders set status = p_status,
    paid_at = case when p_status = 'pagado' and paid_at is null then now() else paid_at end
    where orders.id = p_order;
  insert into public.order_events (order_id, status, note) values (p_order, p_status, coalesce(p_note, ''));

  if p_status = 'pagado' then perform public.issue_invoice(p_order); end if;

  if p_status = 'cancelado' then
    -- devuelve el stock
    for v_it in select product_id, qty from public.order_items where order_id = p_order and product_id is not null loop
      update public.products set stock = stock + v_it.qty where products.id = v_it.product_id;
    end loop;
    if v_o.status <> 'pendiente' then
      insert into public.invoices (order_id, number, type, total, cae)
      values (p_order, 'NC-0003-' || lpad(nextval('public.invoice_number_seq')::text, 8, '0'), 'NC', v_o.total, (76000000000000 + floor(random() * 999999999))::bigint::text);
    end if;
  end if;

  perform public.notify_user(v_o.user_id, 'pedido', 'local_shipping', format('Pedido CS-%s: %s', v_o.number, v_labels->>p_status),
    coalesce(nullif(p_note, ''), ''), jsonb_build_object('order', p_order));
end $$;

-- =====================================================================
--  RPC: revisar comprobante de transferencia (solo admin)
-- =====================================================================
create or replace function public.review_receipt(p_receipt uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_r public.payment_receipts%rowtype; v_o public.orders%rowtype;
begin
  if not public.is_admin() then raise exception 'Solo administradores'; end if;
  select * into v_r from public.payment_receipts where payment_receipts.id = p_receipt for update;
  if not found then raise exception 'Comprobante inexistente'; end if;
  update public.payment_receipts set status = case when p_approve then 'aprobado' else 'rechazado' end, reviewed_at = now()
    where payment_receipts.id = p_receipt;
  select * into v_o from public.orders where orders.id = v_r.order_id;
  if p_approve and v_o.status = 'pendiente' then
    perform public.set_order_status(v_r.order_id, 'pagado', 'Transferencia verificada');
  elsif not p_approve then
    perform public.notify_user(v_r.user_id, 'pago', 'error', format('Pedido CS-%s: comprobante rechazado', v_o.number),
      'No pudimos validar la transferencia. Subí un comprobante nuevo desde el detalle del pedido.', jsonb_build_object('order', v_r.order_id));
  end if;
end $$;

-- Subir comprobante: notifica al panel
create or replace function public.on_receipt_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype;
begin
  select * into v_o from public.orders where orders.id = new.order_id;
  perform public.notify_admins('pago', 'account_balance', format('Comprobante recibido · CS-%s', v_o.number),
    format('%s envió un comprobante de transferencia por $%s%s. Pendiente de revisión.', coalesce(v_o.customer->>'name', 'Cliente'),
           to_char(new.amount, 'FM999G999G999'), case when new.bank <> '' then ' (' || new.bank || ')' else '' end),
    jsonb_build_object('view', 'facturas', 'tab', 'recibidos'));
  return new;
end $$;
drop trigger if exists receipts_notify on public.payment_receipts;
create trigger receipts_notify after insert on public.payment_receipts
  for each row execute function public.on_receipt_insert();

-- Stock bajo: avisa al panel cuando cruza el mínimo
create or replace function public.on_stock_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stock <= new.stock_min and new.stock < old.stock and old.stock > old.stock_min then
    perform public.notify_admins('stock', 'inventory_2', case when new.stock = 0 then 'Sin stock' else 'Stock bajo' end,
      format('%s: %s.', new.title, case when new.stock = 0 then 'se agotó' else format('quedan %s unidad(es)', new.stock) end),
      jsonb_build_object('view', 'cargas', 'product', new.id));
  end if;
  return new;
end $$;
drop trigger if exists products_stock_notify on public.products;
create trigger products_stock_notify after update of stock on public.products
  for each row execute function public.on_stock_change();

-- Marcar notificaciones como leídas (propias o de admin)
create or replace function public.mark_notifications_read(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update public.notifications set read_by = array_append(read_by, auth.uid())
  where id = any(p_ids) and not (read_by @> array[auth.uid()])
    and (user_id = auth.uid() or (audience = 'admin' and public.is_admin()));
$$;

-- =====================================================================
--  RLS
-- =====================================================================
alter table public.admin_allowlist enable row level security;
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.favorites enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
alter table public.invoices enable row level security;
alter table public.payment_receipts enable row level security;
alter table public.reservations enable row level security;
alter table public.notifications enable row level security;

-- allowlist: cualquiera puede consultar si un mail está permitido (para el alta del panel)
drop policy if exists allowlist_read on public.admin_allowlist;
create policy allowlist_read on public.admin_allowlist for select using (true);

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- El rol no se puede cambiar desde el cliente
create or replace function public.protect_profile_role()
returns trigger language plpgsql as $$
begin
  if new.role <> old.role and not public.is_admin() then new.role := old.role; end if;
  new.email := old.email;
  return new;
end $$;
drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role before update on public.profiles
  for each row execute function public.protect_profile_role();

drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products for select using (status = 'publicado' or public.is_admin());
drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists favorites_own on public.favorites;
create policy favorites_own on public.favorites for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists order_items_read on public.order_items;
create policy order_items_read on public.order_items for select using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())));
drop policy if exists order_events_read on public.order_events;
create policy order_events_read on public.order_events for select using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())));
drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices for select using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())));

drop policy if exists receipts_read on public.payment_receipts;
create policy receipts_read on public.payment_receipts for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists receipts_insert on public.payment_receipts;
create policy receipts_insert on public.payment_receipts for insert with check (user_id = auth.uid() and exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));

drop policy if exists reservations_read on public.reservations;
create policy reservations_read on public.reservations for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists reservations_admin on public.reservations;
create policy reservations_admin on public.reservations for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select using (user_id = auth.uid() or (audience = 'admin' and public.is_admin()));

-- =====================================================================
--  REALTIME
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['products','favorites','orders','order_items','order_events','invoices','payment_receipts','reservations','notifications','profiles'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
alter table public.orders replica identity full;
alter table public.products replica identity full;
alter table public.notifications replica identity full;
alter table public.favorites replica identity full;
alter table public.payment_receipts replica identity full;
alter table public.reservations replica identity full;
alter table public.profiles replica identity full;

-- =====================================================================
--  STORAGE (buckets + políticas)
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('products', 'products', true, 5242880, array['image/png','image/jpeg','image/webp']),
       ('avatars', 'avatars', true, 2097152, array['image/png','image/jpeg','image/webp']),
       ('receipts', 'receipts', false, 5242880, array['image/png','image/jpeg','application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "products public read" on storage.objects;
create policy "products public read" on storage.objects for select using (bucket_id = 'products');
drop policy if exists "products admin write" on storage.objects;
create policy "products admin write" on storage.objects for all using (bucket_id = 'products' and public.is_admin()) with check (bucket_id = 'products' and public.is_admin());

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "avatars own write" on storage.objects;
create policy "avatars own write" on storage.objects for all
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "receipts own insert" on storage.objects;
create policy "receipts own insert" on storage.objects for insert
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "receipts read" on storage.objects;
create policy "receipts read" on storage.objects for select
  using (bucket_id = 'receipts' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- =====================================================================
--  PERMISOS (RLS decide fila por fila; acá solo se habilita el acceso)
-- =====================================================================
grant usage on schema public to anon, authenticated;
grant select on public.products, public.admin_allowlist to anon, authenticated;
grant select, insert, update, delete on public.products, public.reservations to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, delete on public.favorites to authenticated;
grant select on public.orders, public.order_items, public.order_events, public.invoices, public.notifications to authenticated;
grant select, insert on public.payment_receipts to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.place_order(jsonb, text, text, jsonb, integer, text) to authenticated;
grant execute on function public.set_order_status(uuid, text, text) to authenticated;
grant execute on function public.review_receipt(uuid, boolean) to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.is_admin() to anon, authenticated;
