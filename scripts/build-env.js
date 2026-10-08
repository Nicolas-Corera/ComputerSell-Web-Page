// Genera assets/js/core/env.js a partir del .env (o de las variables de
// entorno en Vercel). Es el único archivo que el navegador lee con la
// configuración pública: URL + anon key de Supabase, la public key de
// Mercado Pago (la usa el SDK para tokenizar la tarjeta) y la clave pública
// VAPID de las notificaciones push (la privada nunca). Los correos de
// admin (ADMIN_EMAILS) no van acá: no son públicos.
const fs = require("fs");
const path = require("path");
const { ROOT, readEnv } = require("./lib");

const env = readEnv();
const url = env.SUPABASE_URL || "";
const anon = env.SUPABASE_ANON_KEY || "";
const mpPublicKey = env.MP_PUBLIC_KEY || env.PUBLIC_KEY || "";
const vapidPublicKey = env.VAPID_PUBLIC_KEY || "";
// CAPTCHA (Turnstile): la site key es pública; el secreto nunca sale del .env
const captchaSiteKey = env.CAPTCHA_SITE_KEY || "";

if (!url || !anon) {
  console.warn("[env] Falta SUPABASE_URL o SUPABASE_ANON_KEY: el sitio no va a poder conectarse.");
}
if (!mpPublicKey) {
  console.warn("[env] Falta PUBLIC_KEY (Mercado Pago): el pago con tarjeta no va a funcionar.");
}
if (!vapidPublicKey) {
  console.warn("[env] Falta VAPID_PUBLIC_KEY: no se ofrecen notificaciones push (npm run push:keys).");
}

const out = `// Archivo generado por scripts/build-env.js — no editar a mano.
window.CS_ENV = ${JSON.stringify({ SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, MP_PUBLIC_KEY: mpPublicKey, VAPID_PUBLIC_KEY: vapidPublicKey, CAPTCHA_SITE_KEY: captchaSiteKey }, null, 2)};
`;
const dest = path.join(ROOT, "assets", "js", "core", "env.js");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log("[env] assets/js/core/env.js generado");
