-- Nuevas categorías de producto: tablets y celulares.
-- 0001 creó el check de products.category con las cuatro originales; se
-- reemplaza por uno que también acepta 'tablets' y 'celulares'.
alter table public.products drop constraint if exists products_category_check;
alter table public.products add constraint products_category_check
  check (category in ('computadoras', 'notebooks', 'tablets', 'celulares', 'componentes', 'perifericos'));
