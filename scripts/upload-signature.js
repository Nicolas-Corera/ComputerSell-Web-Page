// Sube la firma (assets/images/firma.png, ignorada por git) al bucket privado
// "docs" de Supabase. Así no viaja en el repo pero sí se ve en la nota de venta
// (local y en Vercel). Uso: npm run firma [ruta/a/imagen.png]
const fs = require("fs");
const path = require("path");
const { ROOT, readEnv } = require("./lib");

(async () => {
  const env = readEnv();
  const key = env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("Falta SUPABASE_SECRET_KEY en el .env (Supabase -> Project Settings -> API Keys -> secret)");
  const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, "assets", "images", "firma.png");
  if (!fs.existsSync(file)) throw new Error("No existe " + file);
  const ext = path.extname(file).toLowerCase();
  const type = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[ext];
  if (!type) throw new Error("Formato no permitido: " + ext);
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/docs/firma${ext === ".jpeg" ? ".jpg" : ext}`, {
    method: "POST",
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": type, "x-upsert": "true" },
    body: fs.readFileSync(file),
  });
  if (!res.ok) throw new Error(`Supabase respondió ${res.status}: ${await res.text()}`);
  console.log("[firma] subida a docs/firma" + ext + " (" + Math.round(fs.statSync(file).size / 1024) + " KB)");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
