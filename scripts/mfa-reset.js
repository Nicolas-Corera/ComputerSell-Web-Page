// Restablece la verificación en dos pasos (2FA) de una cuenta: borra sus
// factores para que el próximo ingreso al panel pida configurarla de nuevo
// (QR). Para cuando un admin pierde o cambia el celular.
// Uso: npm run mfa:reset -- correo@ejemplo.com
const { readEnv, sql } = require("./lib");

(async () => {
  const email = (process.argv[2] || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Uso: npm run mfa:reset -- correo@ejemplo.com");
  const env = readEnv();
  const q = "'" + email.replace(/'/g, "''") + "'";
  const rows = await sql(
    env,
    `with u as (select id from auth.users where lower(email) = ${q}),
          d as (delete from auth.mfa_factors f using u where f.user_id = u.id returning f.id)
     select (select count(*) from u) as cuentas, (select count(*) from d) as factores;`,
  );
  const r = rows[0] || {};
  if (!Number(r.cuentas)) throw new Error("No hay ninguna cuenta con " + email);
  console.log(`[mfa] ${email}: ${r.factores} factor(es) borrado(s). Al entrar al panel va a configurar la verificación de nuevo.`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
