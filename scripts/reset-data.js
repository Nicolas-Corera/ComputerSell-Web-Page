// Borra TODOS los datos de prueba: pedidos, productos, favoritos, notas,
// comprobantes, notificaciones, archivos (products/avatars/receipts) y cuentas.
// Conserva el esquema, la allowlist de admins y la firma del bucket "docs".
// Uso: npm run reset            (borra todo, incluidas las cuentas)
//      npm run reset -- --keep-users   (conserva las cuentas)
const { readEnv, sql } = require("./lib");

(async () => {
  const env = readEnv();
  const keepUsers = process.argv.includes("--keep-users");
  const key = env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("Falta SUPABASE_SECRET_KEY en el .env");
  const base = env.SUPABASE_URL + "/storage/v1";
  const headers = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };

  // Archivos: la API de Storage (por SQL está bloqueado)
  for (const bucket of ["products", "avatars", "receipts"]) {
    const objs = await sql(env, `select name from storage.objects where bucket_id = '${bucket}'`);
    if (!objs.length) continue;
    const res = await fetch(`${base}/object/${bucket}`, { method: "DELETE", headers, body: JSON.stringify({ prefixes: objs.map((o) => o.name) }) });
    console.log(`[reset] ${bucket}: ${objs.length} archivo(s) -> ${res.ok ? "ok" : res.status}`);
  }

  await sql(
    env,
    `delete from public.notifications;
     delete from public.payment_receipts;
     delete from public.invoices;
     delete from public.order_events;
     delete from public.order_items;
     delete from public.orders;
     delete from public.reservations;
     delete from public.favorites;
     delete from public.products;
     ${keepUsers ? "" : "delete from auth.users;"}
     alter sequence public.order_number_seq restart with 10480;
     alter sequence public.invoice_number_seq restart with 1;
     alter sequence public.reservation_number_seq restart with 120;`,
  );
  const c = await sql(env, "select (select count(*) from public.products) p, (select count(*) from public.orders) o, (select count(*) from auth.users) u");
  console.log(`[reset] listo · productos: ${c[0].p} · pedidos: ${c[0].o} · cuentas: ${c[0].u}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
