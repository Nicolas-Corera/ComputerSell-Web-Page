// Servidor local para probar sin subir a Vercel: npm run dev
// Regenera assets/js/core/env.js al arrancar y reproduce el ruteo de vercel.json:
//   http://localhost:3000       -> tienda/   (dominio raíz)
//   http://dash.localhost:3000  -> dash/     (subdominio del panel)
// Lo compartido (/assets, y también /dash y /tienda) se sirve desde la raíz;
// nada más de la raíz del repo (.env, .git, scripts, package.json...).
// Escucha solo en 127.0.0.1; DEV_HOST=0.0.0.0 lo expone en la red local.
// /api/* ejecuta las funciones de api/ (mismas que Vercel) para probar el
// pago con Mercado Pago en local.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { ROOT } = require("./lib");

execFileSync(process.execPath, [path.join(__dirname, "build-env.js")], { stdio: "inherit" });

const PORT = +(process.env.PORT || 3000);
const HOST = process.env.DEV_HOST || "127.0.0.1";
// Carpetas de la raíz que se pueden servir (igual que en Vercel)
const SHARED = ["assets", "dash", "tienda"].map((d) => path.join(ROOT, d));
// Ningún segmento puede empezar con "." (.env, .git, .vercel...)
const hasDotSegment = (f) => path.relative(ROOT, f).split(path.sep).some((seg) => seg.startsWith("."));
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

// Funciones serverless (api/mp/pay.js -> /api/mp/pay). Se recargan en cada
// request para no reiniciar el server al editarlas.
function runApi(url, req, res) {
  const rel = url.replace(/^\/api\//, "").replace(/\/$/, "");
  const file = path.normalize(path.join(ROOT, "api", rel + ".js"));
  if (!file.startsWith(path.join(ROOT, "api")) || /(^|[\/])_/.test(rel) || !fs.existsSync(file)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "404 · " + url }));
  }
  // (también las tarifas de assets/js que usa api/_lib/checkout.js)
  Object.keys(require.cache)
    .filter((k) => k.startsWith(path.join(ROOT, "api")) || k.startsWith(path.join(ROOT, "assets", "js")))
    .forEach((k) => delete require.cache[k]);
  Promise.resolve()
    .then(() => require(file)(req, res))
    .catch((e) => {
      console.error("[api]", e);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message || "Error interno" }));
    });
}

http
  .createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    if (url.startsWith("/api/")) return runApi(url, req, res);
    const app = /^dash./i.test(req.headers.host || "") ? "dash" : "tienda";
    // Primero la carpeta de la app, después la raíz (assets compartidos).
    // URLs limpias: /productos -> productos.html (igual que cleanUrls en Vercel)
    const found = [app, ""].flatMap((dir) => {
      const base = path.normalize(path.join(ROOT, dir, url));
      return [base, base + ".html", path.join(base, "index.html")];
    });
    const file = found.find((f) => SHARED.some((dir) => f.startsWith(dir)) && !hasDotSegment(f) && fs.existsSync(f) && fs.statSync(f).isFile());
    if (!file) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404 · " + url);
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, HOST, () => console.log(`[dev] http://localhost:${PORT}` + (HOST === "127.0.0.1" ? "" : ` (escuchando en ${HOST})`)));
