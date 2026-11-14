-- Recargo del pago con tarjeta según el margen de cada producto.
--
-- El recargo se calcula en el servidor (api/_lib/card-pricing.js) con el costo
-- de los productos. products.cost no se puede leer desde la tienda (0017) y el
-- service role solo ejecuta RPCs, así que el backend lo pide con esta función.
-- Solo service_role: ni anon ni authenticated la pueden ejecutar, así el costo
-- nunca llega al navegador.
create or replace function public.quote_product_costs(p_ids uuid[])
returns table (id uuid, cost integer)
language sql stable security definer set search_path = public as $$
  select p.id, p.cost
  from public.products p
  where p.id = any(coalesce(p_ids, '{}'::uuid[])) and p.status = 'publicado';
$$;

revoke all on function public.quote_product_costs(uuid[]) from public, anon, authenticated;
grant execute on function public.quote_product_costs(uuid[]) to service_role;
