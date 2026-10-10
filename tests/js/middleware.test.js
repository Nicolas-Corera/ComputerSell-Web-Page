// middleware.ts: modo mantenimiento (ninguna URL de la tienda lo esquiva) y
// rutas con "../" o su versión codificada (traversal) -> 400.
// Uso: node --test tests/js/  (Node 24: importa el .ts directo)
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { pathToFileURL } = require("url");

const FILE = pathToFileURL(path.join(__dirname, "..", "..", "middleware.ts")).href;
let n = 0;
let maintenance = false;
let supabaseUp = true;
const realFetch = global.fetch;

// Import nuevo en cada test: el estado cacheado del módulo no pasa de uno a otro
async function load() {
  return (await import(FILE + "?t=" + ++n)).default;
}
beforeEach(() => {
  maintenance = false;
  supabaseUp = true;
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon";
  global.fetch = async (url) => {
    assert.match(String(url), /^https:\/\/test\.supabase\.co\/rest\/v1\/store_settings\?/);
    if (!supabaseUp) throw new Error("caído");
    return new Response(JSON.stringify([{ maintenance }]), { status: 200 });
  };
});
test.after(() => (global.fetch = realFetch));

const req = (url, method = "GET") => new Request(url, { method });
const STORE = "https://computersell.com.ar";
const DASH = "https://dash.computersell.com.ar";

test("sin mantenimiento la tienda funciona normal y /mantenimiento vuelve al inicio", async () => {
  const mw = await load();
  for (const p of ["/", "/productos", "/detail?id=3f1c2a4e-1111-4111-8111-111111111111", "/api/orders/transfer"]) {
    assert.strictEqual(await mw(req(STORE + p)), undefined, p);
  }
  const r = await mw(req(STORE + "/mantenimiento"));
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.get("location"), "/");
});

test("con mantenimiento TODA ruta de la tienda va a /mantenimiento", async () => {
  maintenance = true;
  const mw = await load();
  for (const p of [
    "/", "/index.html", "/productos", "/productos?categoria=notebooks", "/detail?id=x", "/carrito.html", "/pago",
    "/tienda/index.html", "/tienda/carrito.html", "/dash/index.html", "/dash", "/acceso.html?next=/perfil",
    "/assets/js/core/env.js", "/sitemap.xml", "/404.html", "/no-existe", "/MANTENIMIENTO",
  ]) {
    const r = await mw(req(STORE + p));
    assert.ok(r, p);
    assert.strictEqual(r.status, 302, p);
    assert.strictEqual(r.headers.get("location"), "/mantenimiento", p);
    assert.match(r.headers.get("cache-control"), /no-store/, p);
  }
  // La página en sí, sus estilos e imágenes, y el aviso interno de la base
  for (const p of ["/mantenimiento", "/assets/css/base.css", "/assets/images/isotipo-dark.png", "/assets/js/pages/mantenimiento.js", "/favicon.ico", "/robots.txt", "/api/notify-mail"]) {
    assert.strictEqual(await mw(req(STORE + p)), undefined, p);
  }
  // Variantes de la misma página -> siempre /mantenimiento
  const v = await mw(req(STORE + "/tienda/mantenimiento.html"));
  assert.strictEqual(v.headers.get("location"), "/mantenimiento");
});

test("con mantenimiento las APIs y los POST responden 503 (no se crean pedidos)", async () => {
  maintenance = true;
  const mw = await load();
  for (const [p, m] of [["/api/orders/transfer", "POST"], ["/api/orders/receipt", "POST"], ["/api/contact", "POST"], ["/api/og?id=x", "GET"], ["/productos", "POST"]]) {
    const r = await mw(req(STORE + p, m));
    assert.strictEqual(r.status, 503, p);
  }
});

test("el panel sigue funcionando en mantenimiento, pero no sirve páginas de la tienda", async () => {
  maintenance = true;
  const mw = await load();
  for (const p of ["/", "/index.html", "/login.html", "/js/dashboard.js", "/api/firma"]) {
    assert.strictEqual(await mw(req(DASH + p)), undefined, p);
  }
  const r = await mw(req(DASH + "/tienda/productos.html"));
  assert.strictEqual(r.status, 302);
});

test("si Supabase no responde se usa el último estado conocido", async () => {
  maintenance = true;
  const mw = await load();
  assert.strictEqual((await mw(req(STORE + "/"))).status, 302);
  supabaseUp = false;
  const orig = Date.now;
  Date.now = () => orig() + 60000; // vence el cache
  try {
    assert.strictEqual((await mw(req(STORE + "/productos"))).status, 302);
  } finally {
    Date.now = orig;
  }
});

test("rutas con ../ o su versión codificada -> 400 (en la ruta o en los parámetros)", async () => {
  const mw = await load();
  for (const p of [
    "/detail?id=../../.env",
    "/api/og?id=..%2f..%2fetc%2fpasswd",
    "/assets/%252e%252e/.env",
    "/productos?q=%2e%2e%5c%2e%2e%5cwindows",
    "/x%00.html",
    "/x?file=..\\..\\boot.ini",
    "/%c0%ae%c0%ae/etc/passwd",
  ]) {
    const r = await mw(req(STORE + p));
    assert.ok(r, p);
    assert.strictEqual(r.status, 400, p);
  }
  // "/tienda/%2e%2e/.env" ya llega resuelto como "/.env" (el parser de URLs no
  // deja subir de la raíz) y .env no se publica (scripts/build.js)
  assert.strictEqual(new URL(STORE + "/tienda/%2e%2e/%2e%2e/.env").pathname, "/.env");
  // Lo normal no se toca
  for (const p of ["/productos?q=ryzen+5.5", "/detail?id=3f1c2a4e-1111-4111-8111-111111111111", "/acceso.html?next=%2Fperfil.html"]) {
    assert.strictEqual(await mw(req(STORE + p)), undefined, p);
  }
});
