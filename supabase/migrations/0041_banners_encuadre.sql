-- Encuadre de la imagen dentro de su lugar (el admin la reacomoda y agranda a
-- mano en el editor visual): ajuste (llenar y recortar / mostrar completa),
-- zoom y posición. Los valores por defecto dejan la imagen como siempre.
alter table public.store_banners add column if not exists fit text not null default 'cover';
alter table public.store_banners add column if not exists zoom numeric(4,2) not null default 1;
alter table public.store_banners add column if not exists pos_x smallint not null default 50;
alter table public.store_banners add column if not exists pos_y smallint not null default 50;
alter table public.store_banners drop constraint if exists store_banners_encuadre_check;
alter table public.store_banners add constraint store_banners_encuadre_check
  check (fit in ('cover', 'contain') and zoom between 1 and 3 and pos_x between 0 and 100 and pos_y between 0 and 100);
