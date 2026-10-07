// Regresión de la Content Security Policy (vercel.json): no permite JavaScript
// dentro del HTML, así que un onclick="..." o un <script> inline deja de
// funcionar en producción sin ningún aviso. Estos tests lo detectan antes.
// Uso: node --test tests/js/
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
// Sin comentarios HTML: un <script> comentado (ej. el SDK de Mercado Pago) no se carga
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/<!--[\s\S]*?-->/g, "");

function walk(rel, exts) {
  const abs = path.join(ROOT, rel);
  if (fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(rel, e.name), exts) : exts.test(e.name) && e.name !== "env.js" ? [path.join(rel, e.name)] : [],
  );
}
const HTML = ["tienda", "dash", "404.html"].flatMap((d) => walk(d, /\.html$/));
const JS = ["assets/js", "dash/js"].flatMap((d) => walk(d, /\.js$/));

function csp() {
  const cfg = JSON.parse(read("vercel.json"));
  const all = cfg.headers.find((h) => h.source === "/(.*)");
  const h = all.headers.find((x) => x.key.toLowerCase() === "content-security-policy");
  assert.ok(h, "falta Content-Security-Policy en vercel.json");
  return Object.fromEntries(h.value.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
}

test("[HIGH] la CSP no permite scripts inline ni eval", () => {
  const p = csp();
  assert.ok(p["script-src"], "falta script-src");
  for (const bad of ["'unsafe-inline'", "'unsafe-eval'", "*", "https:", "data:"]) {
    assert.ok(!p["script-src"].includes(bad), `script-src no puede incluir ${bad}`);
  }
  assert.deepStrictEqual(p["object-src"], ["'none'"]);
  assert.deepStrictEqual(p["frame-ancestors"], ["'none'"]);
  assert.deepStrictEqual(p["base-uri"], ["'self'"]);
});

test("[HIGH] ningún HTML ni template de JS tiene handlers inline (onclick=, onerror=...)", () => {
  const bad = [];
  for (const f of [...HTML, ...JS]) {
    const src = read(f).replace(/^\s*\/\/.*$/gm, "");
    const m = src.match(/\son[a-z]+\s*=\s*["'\\]/i);
    if (m) bad.push(`${f}: ${m[0].trim()}`);
  }
  assert.deepStrictEqual(bad, []);
});

test("[HIGH] ningún HTML tiene <script> inline ni javascript: en enlaces", () => {
  const bad = [];
  for (const f of HTML) {
    const src = read(f);
    for (const m of src.matchAll(/<script\b([^>]*)>/gi)) {
      if (!/\bsrc=/.test(m[1]) && !/type="application\/(ld\+)?json"/.test(m[1])) bad.push(`${f}: <script${m[1]}>`);
    }
    if (/href="javascript:/i.test(src)) bad.push(`${f}: href="javascript:"`);
  }
  assert.deepStrictEqual(bad, []);
});

test("[MEDIUM] los scripts externos van con versión exacta y huella de integridad (SRI)", () => {
  const bad = [];
  for (const f of HTML) {
    for (const m of read(f).matchAll(/<script\b[^>]*\bsrc="(https?:[^"]+)"[^>]*>/gi)) {
      if (!/@\d+\.\d+\.\d+\//.test(m[1])) bad.push(`${f}: versión no exacta en ${m[1]}`);
      if (!/\bintegrity="sha(256|384|512)-/.test(m[0])) bad.push(`${f}: sin integrity en ${m[1]}`);
    }
  }
  for (const f of JS) {
    for (const m of read(f).matchAll(/from\s+"(https?:[^"]+)"/g)) {
      if (!/@\d+\.\d+\.\d+\//.test(m[1])) bad.push(`${f}: versión no exacta en ${m[1]}`);
    }
  }
  assert.deepStrictEqual(bad, []);
});

test("cada host externo que usa el sitio está permitido en la CSP", () => {
  const p = csp();
  const allowed = (dir, url) => (p[dir] || []).some((s) => s === new URL(url).origin || (s.startsWith("https://*.") && new URL(url).host.endsWith(s.slice(9))));
  for (const f of HTML) {
    for (const m of read(f).matchAll(/<script\b[^>]*\bsrc="(https?:[^"]+)"/gi)) assert.ok(allowed("script-src", m[1]), `${f}: ${m[1]} no está en script-src`);
  }
  assert.ok(allowed("connect-src", "https://api.pwnedpasswords.com/range/ABCDE"), "auth.js consulta HaveIBeenPwned: falta en connect-src");
});
