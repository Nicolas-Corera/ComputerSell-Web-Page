// Genera assets/js/core/env.js a partir del .env (o de las variables de
// entorno en Vercel). Es el único archivo que el navegador lee con la
// configuración pública: URL + anon key de Supabase, correos de admin y la
// public key de Mercado Pago (la usa el SDK para tokenizar la tarjeta).
const fs = require("fs");
const path = require("path");
const { ROOT, readEnv } = require("./lib");

const env = readEnv();
const url = env.SUPABASE_URL || "";
const anon = env.SUPABASE_ANON_KEY || "";
const mpPublicKey = env.MP_PUBLIC_KEY || env.PUBLIC_KEY || "";
const admins = (env.ADMIN_EMAILS || "")
  .split(/[,\s;]+/)
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

if (!url || !anon) {
  console.warn("[env] Falta SUPABASE_URL o SUPABASE_ANON_KEY: el sitio no va a poder conectarse.");
}
if (!mpPublicKey) {
  console.warn("[env] Falta PUBLIC_KEY (Mercado Pago): el pago con tarjeta no va a funcionar.");
}

const out = `// Archivo generado por scripts/build-env.js — no editar a mano.
window.CS_ENV = ${JSON.stringify({ SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, ADMIN_EMAILS: admins, MP_PUBLIC_KEY: mpPublicKey }, null, 2)};
`;
const dest = path.join(ROOT, "assets", "js", "core", "env.js");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log("[env] assets/js/core/env.js generado (" + admins.length + " admin(s))");
