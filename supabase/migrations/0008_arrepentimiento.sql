-- Botón de arrepentimiento: solicitudes de revocación de compras a distancia
-- (art. 34 Ley 24.240, arts. 1110 a 1116 CCyC, Disp. SSDCyLC 954/2025).
--
-- - La solicitud se hace desde /arrepentimiento con request_revocation().
--   No exige cuenta (la norma prohíbe pedir registración previa): alcanza con
--   el número de pedido y el email de la compra. Con sesión iniciada, el dueño
--   del pedido no necesita el email.
-- - El código ARR-XXXXXX se devuelve al instante (se muestra en pantalla: el
--   "mismo medio" de la solicitud) y queda en el historial del pedido y en las
--   notificaciones del cliente y del panel.
-- - El cliente solo ve sus solicitudes; el panel ve y actualiza todas.

create sequence if not exists public.revocation_number_seq start 1;

create table if not exists public.revocation_requests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  order_id uuid not null references public.orders(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'recibida'
    check (status in ('recibida', 'en_curso', 'reintegrada', 'rechazada', 'desistida')),
  name text not null default '',
  email text not null default '',
  dni text not null default '',
  reason text not null default '',        -- opcional: la ley no exige dar motivos
  received_on date,                       -- fecha de recepción informada por el cliente
  shipped_at timestamptz,                 -- despacho según el historial del pedido
  deadline date not null,                 -- último día del plazo calculado
  channel text not null default 'web',
  admin_note text not null default '',
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists revocation_requests_order_idx on public.revocation_requests (order_id);
create index if not exists revocation_requests_user_idx on public.revocation_requests (user_id, created_at desc);
create index if not exists revocation_requests_status_idx on public.revocation_requests (status, created_at desc);

drop trigger if exists revocation_requests_updated_at on public.revocation_requests;
create trigger revocation_requests_updated_at before update on public.revocation_requests
  for each row execute function public.set_updated_at();

-- ---------- RLS ----------
alter table public.revocation_requests enable row level security;

drop policy if exists revocations_read on public.revocation_requests;
create policy revocations_read on public.revocation_requests for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists revocations_admin_update on public.revocation_requests;
create policy revocations_admin_update on public.revocation_requests for update
  using (public.is_admin()) with check (public.is_admin());

-- Sin insert directo: solo por request_revocation (security definer)
grant select, update on public.revocation_requests to authenticated;

-- =====================================================================
--  RPC: pedir el arrepentimiento de una compra
--  Valida que el pedido sea de quien lo pide y que esté dentro del plazo.
--  Si ya hay una solicitud vigente para el pedido, devuelve esa (idempotente).
-- =====================================================================
create or replace function public.request_revocation(
  p_order_number integer,
  p_email text default '',
  p_name text default '',
  p_dni text default '',
  p_received_on date default null,
  p_reason text default ''
)
returns table (request_code text, request_status text, order_number integer, deadline_date date, requested_at timestamptz, already_existed boolean)
language plpgsql security definer set search_path = public as $$
declare
  c_days constant integer := 10;     -- días corridos (art. 34 Ley 24.240, art. 1110 CCyC)
  c_transit constant integer := 20;  -- tránsito que se presume si el cliente no informa la fecha de recepción
  c_tz constant text := 'America/Argentina/Buenos_Aires';
  v_uid uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_o public.orders%rowtype;
  v_found boolean;
  v_profile_email text;
  v_r public.revocation_requests%rowtype;
  v_shipped timestamptz;
  v_bought date;
  v_start date;
  v_deadline date;
  v_today date := (now() at time zone c_tz)::date;
begin
  select * into v_o from public.orders o where o.number = p_order_number;
  v_found := found;
  if v_found then
    select lower(p.email) into v_profile_email from public.profiles p where p.id = v_o.user_id;
  end if;

  -- Mismo mensaje si el pedido no existe o no coincide: no revela qué pedidos existen
  if not v_found
     or not (
       (v_uid is not null and v_o.user_id = v_uid)
       or (v_email <> '' and v_email in (lower(coalesce(v_o.customer->>'email', '')), coalesce(v_profile_email, '')))
     ) then
    raise exception 'No encontramos un pedido con ese número y ese email. Revisá los datos o escribinos.';
  end if;

  if v_o.status = 'cancelado' then
    raise exception 'El pedido CS-% ya está cancelado: no hace falta pedir el arrepentimiento. Si pagaste, el reintegro ya está en curso.', v_o.number;
  end if;

  -- Solicitud vigente para el mismo pedido: se devuelve la misma
  select * into v_r from public.revocation_requests r
    where r.order_id = v_o.id and r.status in ('recibida', 'en_curso', 'reintegrada')
    order by r.created_at desc limit 1;
  if found then
    return query select v_r.code, v_r.status, v_o.number, v_r.deadline, v_r.created_at, true;
    return;
  end if;

  select min(e.created_at) into v_shipped from public.order_events e
    where e.order_id = v_o.id and e.status = 'enviado';
  v_bought := (v_o.created_at at time zone c_tz)::date;

  if p_received_on is not null then
    if p_received_on > v_today then
      raise exception 'La fecha en que recibiste el producto no puede ser futura.';
    end if;
    if p_received_on < coalesce((v_shipped at time zone c_tz)::date, v_bought) then
      raise exception 'La fecha en que recibiste el producto no puede ser anterior al despacho del pedido.';
    end if;
  end if;

  -- 10 días corridos desde la celebración del contrato o la entrega, lo último.
  -- Sin despacho todavía, el plazo no empezó a correr (se cuenta desde hoy).
  -- Despachado y sin fecha de recepción informada: se presume la entrega c_transit días después.
  v_start := greatest(
    v_bought,
    coalesce(p_received_on, (v_shipped at time zone c_tz)::date + c_transit, v_today)
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

  -- Queda en el historial del pedido (sin cambiar su estado)
  insert into public.order_events (order_id, status, note)
  values (v_o.id, v_o.status, 'Solicitud de arrepentimiento ' || v_r.code);

  perform public.notify_admins('venta', 'receipt_long', format('Arrepentimiento · CS-%s', v_o.number),
    format('%s pidió revocar la compra (solicitud %s). Coordinar la devolución y el reintegro del total.',
           coalesce(nullif(v_r.name, ''), v_o.customer->>'name', 'El cliente'), v_r.code),
    jsonb_build_object('view', 'ordenes', 'tab', 'ventas', 'order', v_o.id));
  perform public.notify_user(v_o.user_id, 'pedido', 'info', format('Recibimos tu arrepentimiento · CS-%s', v_o.number),
    format('Código de tu solicitud: %s. Te vamos a contactar para coordinar la devolución del producto y el reintegro.', v_r.code),
    jsonb_build_object('order', v_o.id));

  return query select v_r.code, v_r.status, v_o.number, v_r.deadline, v_r.created_at, false;
end $$;

revoke all on function public.request_revocation(integer, text, text, text, date, text) from public;
grant execute on function public.request_revocation(integer, text, text, text, date, text) to anon, authenticated;

-- ---------- Realtime (el panel escucha los cambios) ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'revocation_requests') then
    alter publication supabase_realtime add table public.revocation_requests;
  end if;
end $$;
alter table public.revocation_requests replica identity full;
