-- Seguridad: la política receipts_insert no restringe columnas, así que un
-- cliente podía insertar su comprobante ya "aprobado" (y con reviewed_at)
-- directo contra PostgREST. Todo comprobante nuevo nace pendiente y sin
-- revisar, venga lo que venga del cliente: solo review_receipt (admin) puede
-- aprobarlo o rechazarlo.
create or replace function public.receipts_reset_review_columns()
returns trigger language plpgsql as $$
begin
  new.status := 'pendiente';
  new.reviewed_at := null;
  return new;
end $$;

drop trigger if exists receipts_reset_review on public.payment_receipts;
create trigger receipts_reset_review before insert on public.payment_receipts
  for each row execute function public.receipts_reset_review_columns();
