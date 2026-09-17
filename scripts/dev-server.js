// Servidor local para probar sin subir a Vercel: npm run dev
// Regenera assets/js/core/env.js al arrancar y reproduce el ruteo de vercel.json:
//   http://localhost:3000       -> tienda/   (dominio raíz)
//   http://dash.localhost:3000  -> dash/     (subdominio del panel)
// Lo compartido (/assets, y también /dash y /tienda) se sirve desde la raíz.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { ROOT } = require("./lib");

execFileSync(process.execPath, [path.join(__dirname, "build-env.js")], { stdio: "inherit" });

const PORT = +(process.env.PORT || 3000);
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

http
  .createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    const app = /^dash./i.test(req.headers.host || "") ? "dash" : "tienda";
    // Primero la carpeta de la app, después la raíz (assets compartidos).
    // URLs limpias: /productos -> productos.html (igual que cleanUrls en Vercel)
    const found = [app, ""].flatMap((dir) => {
      const base = path.normalize(path.join(ROOT, dir, url));
      return [base, base + ".html", path.join(base, "index.html")];
    });
    const file = found.find((f) => f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile());
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
  .listen(PORT, () => console.log(`[dev] http://localhost:${PORT}`));
