// Carga los datos privados de quien vende (SELLER_* y BANK_* del .env) en
// private.seller_info. No van en el repo ni en archivos públicos: el navegador
// los pide con el RPC seller_private(), solo con sesión iniciada (checkout por
// transferencia y nota de venta). Uso: npm run seller:sync
const { readEnv, sql } = require("./lib");

(async () => {
  const env = readEnv();
  const data = {
    owner: env.SELLER_OWNER || "",
    doc: env.SELLER_DOC || "",
    bank: {
      holder: env.BANK_HOLDER || env.SELLER_OWNER || "",
      cbu: env.BANK_CBU || "",
      alias: env.BANK_ALIAS || "",
      cuil: env.BANK_CUIL || "",
    },
  };
  const missing = ["SELLER_OWNER", "SELLER_DOC", "BANK_CBU", "BANK_ALIAS", "BANK_CUIL"].filter((k) => !env[k]);
  if (missing.length) console.warn("[seller] Faltan en el .env:", missing.join(", "));
  const json = JSON.stringify(data).replace(/'/g, "''");
  await sql(
    env,
    `insert into private.seller_info (id, data, updated_at) values (true, '${json}'::jsonb, now())
     on conflict (id) do update set data = excluded.data, updated_at = now();`,
  );
  console.log("[seller] datos del vendedor cargados en private.seller_info");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
