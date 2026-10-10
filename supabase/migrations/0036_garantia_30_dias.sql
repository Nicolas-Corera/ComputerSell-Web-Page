-- Garantía estándar del vendedor: 30 días.
-- Todos los productos pasan a 30 días y los nuevos nacen con 30 días (el
-- panel también propone 30 días al cargar uno). Se puede cambiar por producto.
alter table public.products alter column warranty set default 30;
alter table public.products alter column warranty_unit set default 'dias';
update public.products set warranty = 30, warranty_unit = 'dias'
  where warranty is distinct from 30 or warranty_unit is distinct from 'dias';
