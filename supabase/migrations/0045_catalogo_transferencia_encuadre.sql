-- Las tarjetas del catálogo (búsqueda paginada y cambios en vivo) tienen que
-- traer también el precio con transferencia (0042) y el encuadre de la imagen
-- principal (0044): sin esto la página de productos no los mostraba.
-- Es la definición de 0021 con esas dos columnas más; el resto no cambia.
-- OJO: si se vuelven a redefinir, partir de esta versión.

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
      select p.id, p.title, p.brand, p.category, p.subcategory, p.price, p.transfer_price, p.old_price, p.on_sale, p.stock,
             p.installments, p.free_shipping, p.delivery, p.weight, p.weight_unit, p.images[1:1] as images,
             case when p.image_frames is null then null else jsonb_build_array(p.image_frames->0) end as image_frames,
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

grant execute on function public.search_products(text[], text[], text[], text[], text[], boolean, boolean, boolean, integer, integer, text, integer, integer) to anon, authenticated;

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
      'price', r.price, 'transfer_price', r.transfer_price, 'old_price', r.old_price, 'on_sale', r.on_sale, 'stock', r.stock,
      'installments', r.installments, 'free_shipping', r.free_shipping, 'delivery', r.delivery,
      'weight', r.weight, 'weight_unit', r.weight_unit, 'images', to_jsonb(r.images[1:1]),
      'image_frames', case when r.image_frames is null then null else jsonb_build_array(r.image_frames->0) end, 'featured', r.featured);
  end if;
  begin
    perform realtime.send(v, 'product', 'catalog', false);
  exception when others then
    raise warning 'products_broadcast: %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.products_broadcast() from public, anon, authenticated;
