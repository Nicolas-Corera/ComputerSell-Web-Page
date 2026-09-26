-- Catálogo escalable. Antes cada página de la tienda bajaba TODOS los
-- productos publicados (con descripción, specs, etc.) y filtraba en el
-- navegador, y cada visitante tenía una suscripción postgres_changes a
-- products (Realtime evalúa RLS por cada suscriptor en cada cambio: con miles
-- de visitantes, cada venta = miles de lecturas).
--
-- Ahora:
--   * search_products(): filtros, búsqueda, orden y paginación en la base.
--     Devuelve solo la página pedida (24 tarjetas) + el total.
--   * catalog_facets(): contadores de los filtros (categoría, tipo, marca,
--     disponibilidad) en una sola consulta agregada.
--   * Índices parciales (solo publicados) para cada filtro/orden y un índice
--     trigram para la búsqueda por texto (LIKE '%rtx%').
--   * products_broadcast: un trigger manda el cambio de cada producto por
--     Realtime Broadcast (canal público "catalog") con los datos de la tarjeta.
--     La tienda actualiza lo que tiene en pantalla sin volver a consultar.
--
-- Normalización (igual que normalize/slugify de la tienda): sin acentos,
-- minúsculas, sin espacios en los extremos; el slug además cambia espacios por "-".
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create or replace function public.cs_normalize(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select lower(trim(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, ''))))
$$;

create or replace function public.cs_slug(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select regexp_replace(public.cs_normalize(t), '\s+', '-', 'g')
$$;

-- Texto en el que busca el buscador: título, marca, tags y SKU
create or replace function public.cs_search_text(title text, brand text, tags text[], sku text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select public.cs_normalize(coalesce(title, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(array_to_string(tags, ' '), '') || ' ' || coalesce(sku, ''))
$$;

-- ---------- Índices (solo productos publicados: es lo único que lee la tienda) ----------
-- fastupdate = off: products se escribe poco; así cada alta/edición entra directo
-- al índice y las búsquedas nunca recorren la lista pendiente de GIN.
create index if not exists products_pub_search_idx on public.products
  using gin (public.cs_search_text(title, brand, tags, sku) extensions.gin_trgm_ops) with (fastupdate = off) where status = 'publicado';
alter index public.products_pub_search_idx set (fastupdate = off);
create index if not exists products_pub_relevance_idx on public.products ((stock > 0) desc, created_at desc) where status = 'publicado';
create index if not exists products_pub_created_idx on public.products (created_at desc) where status = 'publicado';
create index if not exists products_pub_price_idx on public.products (price) where status = 'publicado';
create index if not exists products_pub_brand_idx on public.products (public.cs_normalize(brand)) where status = 'publicado';
create index if not exists products_pub_featured_idx on public.products (created_at desc) where status = 'publicado' and featured;
-- category ya tiene products_status_idx (status, category)

-- ---------- Búsqueda paginada ----------
-- p_words: palabras del buscador (todas tienen que aparecer, en cualquier orden)
-- p_componentes / p_perifericos: slugs de subcategoría (solo filtran dentro de su categoría)
-- p_sort: relevancia (con stock primero, después lo más nuevo) | menor-precio | mayor-precio | novedades
-- Devuelve { total, items: [tarjetas] }. SECURITY INVOKER: aplica RLS y los
-- permisos por columna de anon (migración 0017).
create or replace function public.search_products(
  p_words text[] default '{}',
  p_categories text[] default '{}',
  p_componentes text[] default '{}',
  p_perifericos text[] default '{}',
  p_brands text[] default '{}',
  p_in_stock boolean default false,
  p_free_shipping boolean default false,
  p_on_sale boolean default false,
  p_min integer default null,
  p_max integer default null,
  p_sort text default 'relevancia',
  p_limit integer default 24,
  p_offset integer default 0
) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
  v_search constant text := 'public.cs_search_text(p.title, p.brand, p.tags, p.sku)';
  v_where text[] := array['p.status = ''publicado'''];
  v_patterns text[];
  v_brands text[];
  v_order text;
  v_limit int := least(greatest(coalesce(p_limit, 24), 1), 60);
  v_offset int := least(greatest(coalesce(p_offset, 0), 0), 100000);
  v_res jsonb;
  v_total bigint;
begin
  -- Patrones LIKE de cada palabra (escapando % _ \), la más larga primero:
  -- esa es la que resuelve el índice trigram, el resto filtra.
  select array_agg('%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%' order by length(w) desc)
    into v_patterns
  from (select distinct left(public.cs_normalize(raw), 60) w from unnest(coalesce(p_words, '{}')) with ordinality u(raw, i) where i <= 8) s
  where w <> '';
  if v_patterns is not null then
    v_where := v_where || array[v_search || ' like $1', v_search || ' like all ($2)'];
  end if;

  if cardinality(p_categories) > 0 then v_where := array_append(v_where, 'p.category = any ($3)'); end if;
  if cardinality(p_componentes) > 0 then v_where := array_append(v_where, '(p.category <> ''componentes'' or public.cs_slug(p.subcategory) = any ($4))'); end if;
  if cardinality(p_perifericos) > 0 then v_where := array_append(v_where, '(p.category <> ''perifericos'' or public.cs_slug(p.subcategory) = any ($5))'); end if;
  if cardinality(p_brands) > 0 then
    select array_agg(public.cs_normalize(b)) into v_brands from unnest(p_brands) b;
    v_where := array_append(v_where, 'public.cs_normalize(p.brand) = any ($6)');
  end if;
  if p_in_stock then v_where := array_append(v_where, 'p.stock > 0'); end if;
  if p_free_shipping then v_where := array_append(v_where, 'p.free_shipping'); end if;
  if p_on_sale then v_where := array_append(v_where, '(p.on_sale and p.old_price > p.price)'); end if;
  if p_min is not null then v_where := array_append(v_where, 'p.price >= $7'); end if;
  if p_max is not null then v_where := array_append(v_where, 'p.price <= $8'); end if;

  v_order := case p_sort
    when 'menor-precio' then 'p.price asc, p.id'
    when 'mayor-precio' then 'p.price desc, p.id'
    when 'novedades' then 'p.created_at desc, p.id'
    else '(p.stock > 0) desc, p.created_at desc, p.id'
  end;

  -- SQL dinámico: cada llamada se planifica con sus valores reales, así el
  -- planner usa el índice que corresponde a los filtros activos.
  execute format($q$
    select jsonb_build_object(
      'total', coalesce(max(s.total), 0),
      'items', coalesce(jsonb_agg(to_jsonb(s) - 'total' - 'ord' order by s.ord), '[]'::jsonb))
    from (
      select p.id, p.title, p.brand, p.category, p.subcategory, p.price, p.old_price, p.on_sale, p.stock,
             p.installments, p.free_shipping, p.delivery, p.weight, p.weight_unit, p.images[1:1] as images,
             row_number() over (order by %1$s) as ord, count(*) over () as total
      from public.products p
      where %2$s
      order by %1$s
      limit $9 offset $10
    ) s
  $q$, v_order, array_to_string(v_where, ' and '))
  into v_res
  using v_patterns[1], v_patterns, p_categories, p_componentes, p_perifericos, v_brands, p_min, p_max, v_limit, v_offset;

  -- Página fuera de rango: el total sale aparte (para que la tienda vuelva a la última)
  if (v_res->>'total')::bigint = 0 and v_offset > 0 then
    execute format('select count(*) from public.products p where %s', array_to_string(v_where, ' and '))
      into v_total
      using v_patterns[1], v_patterns, p_categories, p_componentes, p_perifericos, v_brands, p_min, p_max;
    v_res := jsonb_build_object('total', v_total, 'items', '[]'::jsonb);
  end if;
  return v_res;
end $$;

-- ---------- Contadores de los filtros ----------
-- Sobre todo el catálogo publicado (no dependen de los filtros marcados).
-- La tienda los cachea unos minutos por visitante.
create or replace function public.catalog_facets() returns jsonb
language sql stable set search_path = public as $$
  with p as (
    select category, subcategory, brand, stock, free_shipping, on_sale, old_price, price
    from public.products where status = 'publicado'
  )
  select jsonb_build_object(
    'total', (select count(*) from p),
    'categories', coalesce((select jsonb_object_agg(category, n) from (select category, count(*) n from p group by 1) c), '{}'::jsonb),
    'subcategories', coalesce((select jsonb_object_agg(k, n) from (select category || '/' || public.cs_slug(subcategory) k, count(*) n from p where trim(subcategory) <> '' group by 1) c), '{}'::jsonb),
    'brands', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'name', name, 'count', n)) from (select public.cs_normalize(brand) k, min(brand) name, count(*) n from p where trim(brand) <> '' group by 1) b), '[]'::jsonb),
    'stock', (select count(*) from p where stock > 0),
    'shipping', (select count(*) from p where free_shipping),
    'sale', (select count(*) from p where on_sale and old_price > price)
  )
$$;

grant execute on function public.search_products(text[], text[], text[], text[], text[], boolean, boolean, boolean, integer, integer, text, integer, integer) to anon, authenticated;
grant execute on function public.catalog_facets() to anon, authenticated;

-- ---------- Cambios en vivo por Broadcast ----------
-- Un solo mensaje por cambio para todos los visitantes (sin lecturas por
-- suscriptor). Lleva solo columnas públicas de la tarjeta (nunca cost ni
-- created_by). Producto despublicado o borrado: { id, removed: true }.
-- Si Realtime falla, la escritura del producto sigue igual (compras incluidas).
create or replace function public.products_broadcast() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.products;
  v jsonb;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  -- Borradores/pausados que siguen sin publicar: la tienda nunca los vio
  if (tg_op = 'INSERT' and new.status <> 'publicado')
     or (tg_op = 'DELETE' and old.status <> 'publicado')
     or (tg_op = 'UPDATE' and old.status <> 'publicado' and new.status <> 'publicado') then
    return null;
  end if;
  if tg_op = 'DELETE' or r.status <> 'publicado' then
    v := jsonb_build_object('id', r.id, 'removed', true);
  else
    v := jsonb_build_object(
      'id', r.id, 'title', r.title, 'brand', r.brand, 'category', r.category, 'subcategory', r.subcategory,
      'price', r.price, 'old_price', r.old_price, 'on_sale', r.on_sale, 'stock', r.stock,
      'installments', r.installments, 'free_shipping', r.free_shipping, 'delivery', r.delivery,
      'weight', r.weight, 'weight_unit', r.weight_unit, 'images', to_jsonb(r.images[1:1]), 'featured', r.featured);
  end if;
  begin
    perform realtime.send(v, 'product', 'catalog', false);
  exception when others then
    raise warning 'products_broadcast: %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.products_broadcast() from public, anon, authenticated;

drop trigger if exists products_broadcast on public.products;
create trigger products_broadcast after insert or update or delete on public.products
  for each row execute function public.products_broadcast();
