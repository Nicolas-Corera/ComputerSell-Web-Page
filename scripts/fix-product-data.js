// Corrige datos de productos publicados que el QA pre-lanzamiento (08/10/2026)
// encontró mal cargados (specs contradictorias, typos, peso irreal, marca).
// Se aplica una sola vez (private.data_fixes) y no toca precios ni stock.
// Uso: node scripts/fix-product-data.js
// Las garantías por debajo del mínimo legal las corrige la migración 0031.
const { readEnv, sql } = require("./lib");

const FIX = "qa_2026_10_08_product_data";

const query = `
create or replace function pg_temp.set_spec(p jsonb, k text, v text) returns jsonb language sql as $$
  select coalesce(jsonb_agg(case when e->>'k' = k then jsonb_build_object('k', k, 'v', v) else e end order by o), '[]'::jsonb)
  from jsonb_array_elements(p) with ordinality t(e, o);
$$;
create or replace function pg_temp.rename_first_spec(p jsonb, old_k text, new_k text) returns jsonb language sql as $$
  select coalesce(jsonb_agg(case when o = 1 and e->>'k' = old_k then jsonb_build_object('k', new_k, 'v', e->'v') else e end order by o), '[]'::jsonb)
  from jsonb_array_elements(p) with ordinality t(e, o);
$$;
create or replace function pg_temp.drop_spec(p jsonb, k text) returns jsonb language sql as $$
  select coalesce(jsonb_agg(e order by o), '[]'::jsonb) from jsonb_array_elements(p) with ordinality t(e, o) where e->>'k' <> k;
$$;
create or replace function pg_temp.fix_highlights(p jsonb) returns jsonb language sql as $$
  select coalesce(jsonb_agg(to_jsonb(replace(replace(replace(e #>> '{}', 'Soperte', 'Soporte'), 'ulrtra', 'ultra'), 'Facil instalación', 'Fácil instalación')) order by o), '[]'::jsonb)
  from jsonb_array_elements(p) with ordinality t(e, o);
$$;

do $fix$
begin
  if exists (select 1 from private.data_fixes where name = '${FIX}') then
    raise notice 'ya aplicado';
    return;
  end if;

  -- Ryzen 7 5700 (sin G): no tiene gráficos integrados; 8 núcleos / 16 hilos, 16 MB de caché L3, 3,7 GHz base
  update public.products set
    title = 'Microprocesador Pc AMD Ryzen 7 5700 3.7GHz 8 núcleos Socket Am4 (sin gráficos integrados)',
    specs = pg_temp.set_spec(pg_temp.set_spec(pg_temp.set_spec(specs, 'Cantidad de núcleos de CPU', '8'), 'Caché', '16 MB'), 'Frecuencia mínima de reloj', '3,7 GHz'),
    description = replace(replace(description, 'Cantidad de núcleos de CPU: 4', 'Cantidad de núcleos de CPU: 8'), 'Frecuencia mínima de reloj: 3.8 GHz', 'Frecuencia mínima de reloj: 3.7 GHz')
  where id = '384b74e7-3a31-477a-bbca-d3b7b979fd77';

  -- Typos en destacados (procesadores y SSD)
  update public.products set highlights = pg_temp.fix_highlights(highlights)
  where highlights::text ~ '(Soperte|ulrtra|Facil instalación)';

  -- SSD: la primera fila es la marca, no el modelo; la lectura del Hiksemi es 550 MB/s (6 Gbps es la interfaz)
  update public.products set specs = pg_temp.rename_first_spec(specs, 'Modelo', 'Marca')
  where id in ('3d72775e-97d7-4032-ac42-94f733f5078b', '71505b4f-7a20-465e-8184-af1bf451e174');
  update public.products set specs = pg_temp.set_spec(specs, 'Velocidad máxima de lectura SSD', '550 MB/s')
  where id = '3d72775e-97d7-4032-ac42-94f733f5078b';

  -- Asus Vivobook Go 15 (E1504FA): 1920 x 1080, Ryzen 5 7520U
  update public.products set specs = pg_temp.set_spec(pg_temp.set_spec(specs, 'Resolución de la pantalla', '1920 px x 1080 px'), 'Modelo del procesador', '7520U')
  where id = '1c7350b2-0f6d-4f06-bf58-3799c7caead6';

  -- HP 15-fc0287la: admite hasta 16 GB; descripción con un error de tipeo
  update public.products set
    specs = pg_temp.set_spec(specs, 'Capacidad máxima soportada de la memoria RAM', '16 GB'),
    description = replace(description, 'Acorde perfecta para tu vida híbrida.', 'Perfecta para tu vida híbrida.')
  where id = '9b1faa07-4622-4d94-8951-4f695decaf08';

  -- Conversor HDMI a VGA: marca genérica; el color del título no coincide con la foto
  update public.products set
    title = 'Conversor HDMI a VGA 1080p',
    brand = 'Genérico',
    specs = pg_temp.drop_spec(pg_temp.set_spec(specs, 'Marca', 'Genérico'), 'Color')
  where id = '0c340438-9df5-4a49-9c77-d47d0b9a0521';

  -- Tablet Samsung Galaxy Tab A11: pesa ~340 g (0,5 kg con caja); el peso se usa para el envío
  update public.products set weight = 0.5, weight_unit = 'kg'
  where id = 'af331bcc-f6f9-4c15-83cf-7b17414eb1ab';

  -- Redmi Pad 2: la marca es Xiaomi (Redmi es la línea)
  update public.products set brand = 'Xiaomi'
  where id = '526219f8-a821-48dd-b192-e0261a6e90bb';

  insert into private.data_fixes (name) values ('${FIX}');
end $fix$;
`;

sql(readEnv(), query)
  .then(() => console.log("[productos] datos corregidos (o ya estaban)"))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
