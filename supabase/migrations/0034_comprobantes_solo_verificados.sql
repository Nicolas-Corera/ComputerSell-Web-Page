-- payment_receipts solo acepta archivos que revisó api/orders/receipt
-- (private.receipt_scans, migración 0033). Sin esto, alguien podría subir al
-- bucket un archivo disfrazado (un HTML o un ejecutable con extensión .png)
-- salteando la revisión del navegador y registrarlo como comprobante.
-- Aplicar DESPUÉS de publicar el sitio que registra los comprobantes por la API.

create or replace function public.receipts_require_scan()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from private.receipt_scans s where s.file_path = new.file_path) then
    raise exception 'No pudimos verificar el archivo del comprobante. Volvé a subirlo.';
  end if;
  return new;
end $$;
revoke all on function public.receipts_require_scan() from public, anon, authenticated;
drop trigger if exists receipts_require_scan on public.payment_receipts;
create trigger receipts_require_scan before insert on public.payment_receipts
  for each row execute function public.receipts_require_scan();
