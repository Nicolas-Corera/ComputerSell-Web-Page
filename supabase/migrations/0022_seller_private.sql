-- Seguridad: los datos personales y bancarios de quien vende (nombre completo,
-- DNI/CUIT, CBU, alias, CUIL) estaban escritos en archivos estáticos
-- (tienda/pago.html y assets/js/config/seller.js), así que cualquiera los podía
-- leer sin sesión y quedaban expuestos a buscadores y scrapers.
-- Ahora viven en private.seller_info (sin acceso directo desde la API) y el
-- navegador los pide con el RPC seller_private(), solo con sesión iniciada
-- (checkout por transferencia y nota de venta).
-- Los valores no van en el repo: se cargan desde el .env con `npm run seller:sync`.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.seller_info (
  id boolean primary key default true check (id),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
revoke all on private.seller_info from public, anon, authenticated;

-- { owner, doc, bank: { holder, cbu, alias, cuil } }
create or replace function public.seller_private()
returns jsonb language sql stable security definer set search_path = public, private as $$
  select case when auth.uid() is null then '{}'::jsonb
    else coalesce((select s.data from private.seller_info s where s.id), '{}'::jsonb) end;
$$;
revoke all on function public.seller_private() from public, anon;
grant execute on function public.seller_private() to authenticated;
