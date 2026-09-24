// Build para Vercel: genera env.js y copia a public/ solo lo que el sitio
// sirve (tienda, panel y assets). Vercel publica únicamente public/, así que
// scripts, migraciones, tests, README, package.json, etc. no quedan expuestos.
// Las funciones de api/ las arma Vercel aparte desde el repo.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { ROOT } = require("./lib");

execFileSync(process.execPath, [path.join(__dirname, "build-env.js")], { stdio: "inherit" });

const OUT = path.join(ROOT, "public");
fs.rmSync(OUT, { recursive: true, force: true });
for (const dir of ["assets", "dash", "tienda"]) {
  fs.cpSync(path.join(ROOT, dir), path.join(OUT, dir), {
    recursive: true,
    // Nada que empiece con "." (.DS_Store, .gitkeep...)
    filter: (src) => !path.basename(src).startsWith("."),
  });
}
fs.copyFileSync(path.join(ROOT, "404.html"), path.join(OUT, "404.html"));
console.log("[build] public/ listo (assets, dash, tienda)");
