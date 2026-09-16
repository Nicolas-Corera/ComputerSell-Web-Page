-- Unidades para garantía, peso y dimensiones (se eligen en el panel)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'warranty_months') then
    alter table public.products rename column warranty_months to warranty;
  end if;
end $$;
alter table public.products
  add column if not exists warranty_unit text not null default 'meses' check (warranty_unit in ('dias', 'meses', 'anios')),
  add column if not exists weight_unit text not null default 'kg' check (weight_unit in ('g', 'kg')),
  add column if not exists dimensions_unit text not null default 'cm' check (dimensions_unit in ('mm', 'cm', 'm'));
