-- Seguridad: anon y cualquier cliente podían leer products.cost (costo de
-- compra y margen) y products.created_by (uuid del admin) de los productos
-- publicados. Se reemplaza el SELECT de toda la tabla por un SELECT de columnas
-- que excluye esas dos. El panel lee la fila completa con admin_products()
-- (solo admins). Las escrituras del panel no cambian.
--
-- OJO: si se agrega una columna nueva a products que la tienda tenga que leer,
-- hay que otorgarla también: grant select (columna) on public.products to anon, authenticated;
revoke select on public.products from anon, authenticated;

do $$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'products' and column_name not in ('cost', 'created_by');
  execute format('grant select (%s) on public.products to anon, authenticated', v_cols);
end $$;

create or replace function public.admin_products()
returns setof public.products language sql stable security definer set search_path = public as $$
  select * from public.products where public.is_admin();
$$;
revoke all on function public.admin_products() from public, anon;
grant execute on function public.admin_products() to authenticated;
