-- Texto legal / condiciones que se muestra debajo de un banner de campaña
-- (solo lo usan los lugares que lo piden, ver legal: true en
-- assets/js/config/banner-slots.js). Sin texto no se muestra nada.
alter table public.store_banners add column if not exists legal text;
alter table public.store_banners drop constraint if exists store_banners_legal_check;
alter table public.store_banners add constraint store_banners_legal_check check (legal is null or length(legal) <= 600);
