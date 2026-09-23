-- Seguridad: no había límite de comprobantes por pedido. Un cliente podía
-- insertar filas en payment_receipts (y subir archivos al bucket receipts) sin
-- fin; cada fila genera un aviso al panel que ningún cliente puede borrar y
-- recarga todos los paneles abiertos.
--
-- Ahora la base aplica la misma regla que ya mostraba la tienda
-- (compra-detalle.js: canUpload): solo se puede cargar un comprobante para un
-- pedido propio por transferencia que siga pendiente y que no tenga otro
-- comprobante en revisión o aprobado. Si el admin lo rechaza, se puede subir
-- otro. Vale para la fila y para el archivo del bucket (cuyo nombre es
-- <user_id>/<order_id>[-<timestamp>].<ext>).

create or replace function public.can_upload_receipt(p_order uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.orders o
    where o.id = p_order and o.user_id = auth.uid()
      and o.status = 'pendiente' and o.payment_method = 'transferencia'
      and not exists (select 1 from public.payment_receipts r where r.order_id = o.id and r.status in ('pendiente', 'aprobado'))
  );
$$;
revoke all on function public.can_upload_receipt(uuid) from public, anon;
grant execute on function public.can_upload_receipt(uuid) to authenticated;

drop policy if exists receipts_insert on public.payment_receipts;
create policy receipts_insert on public.payment_receipts for insert
  with check (user_id = auth.uid() and public.can_upload_receipt(order_id));

-- Archivo: <user_id>/<order_id>... -> el id del pedido son los 36 primeros caracteres del nombre
create or replace function public.receipt_object_order(p_name text)
returns uuid language sql immutable as $$
  select case when left(split_part(p_name, '/', 2), 36) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then left(split_part(p_name, '/', 2), 36)::uuid end;
$$;
grant execute on function public.receipt_object_order(text) to authenticated;

drop policy if exists "receipts own insert" on storage.objects;
create policy "receipts own insert" on storage.objects for insert
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.can_upload_receipt(public.receipt_object_order(name))
  );
