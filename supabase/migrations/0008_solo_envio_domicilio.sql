-- No hay local: la entrega es siempre por envío a domicilio.
-- (place_order ya crea todas las órdenes con 'domicilio' desde la 0007)
update public.orders set shipping_method = 'domicilio' where shipping_method <> 'domicilio';
alter table public.orders drop constraint if exists orders_shipping_method_check;
alter table public.orders add constraint orders_shipping_method_check check (shipping_method = 'domicilio');
