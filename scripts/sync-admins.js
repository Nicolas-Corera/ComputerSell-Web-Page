// Sincroniza ADMIN_EMAILS del .env con la tabla admin_allowlist de Supabase.
// Los correos que ya tienen cuenta confirmada pasan a rol admin
// automáticamente (los que no, al confirmar el correo); los que se quitan del
// .env vuelven a ser clientes.
const { readEnv, sql } = require("./lib");

(async () => {
  const env = readEnv();
  const admins = (env.ADMIN_EMAILS || "")
    .split(/[,\s;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!admins.length) throw new Error("ADMIN_EMAILS está vacío en el .env");
  const q = (e) => "'" + e.replace(/'/g, "''") + "'";
  const inList = admins.map(q).join(",");
  await sql(
    env,
    `insert into public.admin_allowlist (email) values ${admins.map((e) => "(" + q(e) + ")").join(",")} on conflict (email) do nothing;
     delete from public.admin_allowlist where email not in (${inList});
     update public.profiles set role = 'customer' where role = 'admin' and lower(email) not in (${inList});
     update public.profiles p set role = 'admin' from auth.users u
       where u.id = p.id and u.email_confirmed_at is not null and lower(p.email) in (${inList});`,
  );
  console.log("[admins] allowlist sincronizada:", admins.join(", "));
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
