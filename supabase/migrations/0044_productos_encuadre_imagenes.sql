-- Encuadre de las imágenes de un producto: el panel reacomoda y agranda cada
-- imagen sobre la vista previa de la tarjeta. products.image_frames es una lista
-- en el mismo orden que products.images; cada elemento es null (como siempre) o
-- {"fit": "cover"|"contain", "zoom": 1-3, "x": 0-100, "y": 0-100}.
-- La tienda usa el de la primera imagen en la tarjeta del producto.

create or replace function public.valid_image_frames(f jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  e jsonb;
begin
  if f is null then return true; end if;
  if jsonb_typeof(f) <> 'array' or jsonb_array_length(f) > 8 then return false; end if;
  for e in select * from jsonb_array_elements(f) loop
    if jsonb_typeof(e) = 'null' then continue; end if;
    if jsonb_typeof(e) <> 'object' then return false; end if;
    if e - 'fit' - 'zoom' - 'x' - 'y' <> '{}'::jsonb then return false; end if;
    if e->>'fit' is null or e->>'fit' not in ('cover', 'contain') then return false; end if;
    if jsonb_typeof(e->'zoom') <> 'number' or (e->>'zoom')::numeric not between 1 and 3 then return false; end if;
    if jsonb_typeof(e->'x') <> 'number' or (e->>'x')::numeric not between 0 and 100 then return false; end if;
    if jsonb_typeof(e->'y') <> 'number' or (e->>'y')::numeric not between 0 and 100 then return false; end if;
  end loop;
  return true;
end $$;

alter table public.products add column if not exists image_frames jsonb;
alter table public.products drop constraint if exists products_image_frames_check;
alter table public.products add constraint products_image_frames_check check (public.valid_image_frames(image_frames));

-- La tienda lee las columnas por separado (0017): esta también es pública
grant select (image_frames) on public.products to anon, authenticated;

-- Que la API vea la columna nueva sin esperar
notify pgrst, 'reload schema';
