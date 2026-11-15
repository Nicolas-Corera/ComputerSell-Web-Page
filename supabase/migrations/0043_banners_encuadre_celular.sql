-- Encuadre propio para celular (pantallas de hasta 640 px): el admin reacomoda
-- la imagen (la de escritorio o la de celular) por separado, solo para celular.
-- Nulos = el celular usa el mismo encuadre que escritorio (como hasta ahora).
alter table public.store_banners add column if not exists m_fit text;
alter table public.store_banners add column if not exists m_zoom numeric(4,2);
alter table public.store_banners add column if not exists m_pos_x smallint;
alter table public.store_banners add column if not exists m_pos_y smallint;
alter table public.store_banners drop constraint if exists store_banners_encuadre_celular_check;
alter table public.store_banners add constraint store_banners_encuadre_celular_check
  check ((m_fit is null or m_fit in ('cover', 'contain'))
    and (m_zoom is null or m_zoom between 1 and 3)
    and (m_pos_x is null or m_pos_x between 0 and 100)
    and (m_pos_y is null or m_pos_y between 0 and 100));
