// Genera el par de claves VAPID de las notificaciones push y lo agrega al .env
// (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) si todavía no están. Uso: npm run push:keys
// Las mismas dos variables van en Vercel (Settings -> Environment Variables).
// Una vez publicadas no se cambian: las suscripciones de los navegadores quedan
// atadas a la clave pública y con otra hay que volver a aceptar.
const fs = require("fs");
const path = require("path");
const { ROOT, readEnv } = require("./lib");
const { generateVapidKeys } = require("../api/_lib/push");

const env = readEnv();
if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
  console.log("[push] El .env ya tiene claves VAPID: no se tocan.");
  console.log("VAPID_PUBLIC_KEY=" + env.VAPID_PUBLIC_KEY);
  process.exit(0);
}

const keys = generateVapidKeys();
const file = path.join(ROOT, ".env");
const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
const block =
  "\n# ===== Notificaciones push (Web Push / VAPID): npm run push:keys =====\n" +
  `VAPID_PUBLIC_KEY=${keys.publicKey}\n` +
  `VAPID_PRIVATE_KEY=${keys.privateKey}\n`;
fs.writeFileSync(file, prev.replace(/\s*$/, "\n") + block);
console.log("[push] Claves agregadas al .env. Cargalas también en Vercel:");
console.log("VAPID_PUBLIC_KEY=" + keys.publicKey);
console.log("VAPID_PRIVATE_KEY=" + keys.privateKey);
