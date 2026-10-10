-- Garantía del vendedor sin mínimo: días, meses o años (la elige el panel).
-- 0031 no dejaba guardar menos de 6 meses (nuevos) / 3 meses (usados). Se
-- saca esa regla; la unidad sigue limitada a dias/meses/anios (0002).
drop trigger if exists products_check_warranty on public.products;
drop function if exists public.products_check_warranty();
