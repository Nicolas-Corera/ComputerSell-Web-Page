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

// Headers de seguridad de vercel.json (los mismos que en producción). La
// regla con "has" es la del editor visual del panel: el inicio con ?editor=1
// puede abrirse en un iframe del panel (y solo ahí).
const VERCEL_JSON = path.join(ROOT, "vercel.json");
const RULES = (fs.existsSync(VERCEL_JSON) && JSON.parse(fs.readFileSync(VERCEL_JSON, "utf8")).headers) || [];
const toObject = (rule) => Object.fromEntries(rule.headers.map((x) => [x.key, x.value]));
const SECURITY_HEADERS = toObject(RULES.find((r) => !r.has && !r.missing) || { headers: [] });
const EDITOR_HEADERS = toObject(RULES.find((r) => r.has) || { headers: [] });
// En local el panel (dash.localhost) embebe la tienda (localhost): lo permite el frame-src (y cualquier puerto, por si el 3000 está ocupado)
const devCsp = (h) => (h["Content-Security-Policy"] ? { ...h, "Content-Security-Policy": h["Content-Security-Policy"].replace("frame-src ", "frame-src http://localhost:* ").replace("http://dash.localhost:3000", "http://dash.localhost:*") } : h);
const headersFor = (app, url, query) => devCsp(app === "tienda" && url === "/" && new URLSearchParams(query).get("editor") === "1" && Object.keys(EDITOR_HEADERS).length ? EDITOR_HEADERS : SECURITY_HEADERS);

const PORT = +(process.env.PORT || 3000);
const HOST = process.env.DEV_HOST || "127.0.0.1";
// Carpetas de la raíz que se pueden servir (igual que en Vercel)
const SHARED = ["assets", "dash", "tienda"].map((d) => path.join(ROOT, d));
// ¿file está dentro de dir? (con separador: "app-sibling" no está dentro de "app")
const inside = (dir, file) => {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};
// Ningún segmento puede empezar con "." (.env, .git, .vercel...)
const hasDotSegment = (f) => path.relative(ROOT, f).split(path.sep).some((seg) => seg.startsWith("."));
// Archivos que tampoco publica el build (scripts/build.js): firma y plantilla interna
const isPrivate = (f) => /^firma\./i.test(path.basename(f)) || /^plantilla-legal\.html$/i.test(path.basename(f));
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
  if (!inside(path.join(ROOT, "api"), file) || /(^|[\/])_/.test(rel) || !fs.existsSync(file)) {
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
    // Un %-encoding inválido (p. ej. /%E0%A4%A) no puede tirar el proceso
    let url;
    try {
      url = decodeURIComponent(req.url.split("?")[0]);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("400 · URL inválida");
    }
    if (url.startsWith("/api/")) return runApi(url, req, res);
    const app = /^dash./i.test(req.headers.host || "") ? "dash" : "tienda";
    const SEC = headersFor(app, url, req.url.split("?")[1] || "");
    if (app === "tienda" && url === "/sitemap.xml") return runApi("/api/sitemap", req, res);
    if (app === "tienda" && url === "/.well-known/security.txt") url = "/security.txt";
    // Primero la carpeta de la app, después la raíz (assets compartidos).
    // URLs limpias: /productos -> productos.html (igual que cleanUrls en Vercel)
    const found = [app, ""].flatMap((dir) => {
      const base = path.normalize(path.join(ROOT, dir, url));
      return [base, base + ".html", path.join(base, "index.html")];
    });
    const isFile = (f) => {
      try {
        return fs.statSync(f).isFile();
      } catch (e) {
        return false; // no existe, nombre inválido, sin permiso...
      }
    };
    const file = found.find((f) => SHARED.some((dir) => inside(dir, f)) && !hasDotSegment(f) && !isPrivate(f) && isFile(f));
    if (!file) {
      // Igual que Vercel: la página 404.html de la raíz
      const page = path.join(ROOT, "404.html");
      if (req.method === "GET" && /\.html$|\/[^.]*$/.test(url) && fs.existsSync(page)) {
        res.writeHead(404, { ...SEC, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        return fs.createReadStream(page).pipe(res);
      }
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404 · " + url);
    }
    res.writeHead(200, {
      ...SEC,
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(file)
      .on("error", () => res.destroy())
      .pipe(res);
  })
  .listen(PORT, HOST, () => console.log(`[dev] http://localhost:${PORT}` + (HOST === "127.0.0.1" ? "" : ` (escuchando en ${HOST})`)));
