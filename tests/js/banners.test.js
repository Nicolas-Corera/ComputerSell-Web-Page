// Imágenes y banners programables del panel: qué entrada se ve en cada fecha,
// links seguros, que cada lugar del HTML esté en el registro, y que el
// inicio solo se pueda embeber (iframe) desde el panel con ?editor=1.
// Uso: node --test tests/js/
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);

const T = (s) => new Date(s).getTime();
const row = (o) => ({ id: o.id || "x", slot: "home-promo", enabled: true, starts_at: null, ends_at: null, created_at: "2026-01-01T00:00:00Z", ...o });

test("pickBanner: gana la vigente que empezó más tarde; sin ninguna, null (queda la original)", async () => {
  const { pickBanner } = await load("assets/js/core/banner-schedule.js");
  const base = row({ id: "base" });
  const madre = row({ id: "madre", starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-10-19T00:00:00Z" });
  const rows = [base, madre];
  assert.strictEqual(pickBanner(rows, "home-promo", T("2026-09-30T12:00:00Z")).id, "base");
  assert.strictEqual(pickBanner(rows, "home-promo", T("2026-10-10T12:00:00Z")).id, "madre", "la campaña pisa a la de siempre");
  assert.strictEqual(pickBanner(rows, "home-promo", T("2026-10-19T00:00:00Z")).id, "base", "al llegar el fin vuelve la de siempre");
  assert.strictEqual(pickBanner([madre], "home-promo", T("2026-10-19T00:00:01Z")), null);
  assert.strictEqual(pickBanner(rows, "home-hero", T("2026-10-10T12:00:00Z")), null, "otro lugar no se mezcla");
});

test("pickBanner: apagadas y futuras no se muestran; igualdad de inicio gana la cargada última", async () => {
  const { pickBanner, statusOf } = await load("assets/js/core/banner-schedule.js");
  const now = T("2026-05-01T00:00:00Z");
  assert.strictEqual(pickBanner([row({ enabled: false })], "home-promo", now), null);
  assert.strictEqual(pickBanner([row({ starts_at: "2026-06-01T00:00:00Z" })], "home-promo", now), null);
  const a = row({ id: "a", created_at: "2026-01-01T00:00:00Z" });
  const b = row({ id: "b", created_at: "2026-02-01T00:00:00Z" });
  assert.strictEqual(pickBanner([a, b], "home-promo", now).id, "b");
  assert.strictEqual(statusOf(row({ enabled: false }), now), "off");
  assert.strictEqual(statusOf(row({ starts_at: "2026-06-01T00:00:00Z" }), now), "scheduled");
  assert.strictEqual(statusOf(row({ ends_at: "2026-04-01T00:00:00Z" }), now), "expired");
  assert.strictEqual(statusOf(row({}), now), "live");
});

test("nextChange: el próximo inicio o vencimiento futuro, ignorando apagadas", async () => {
  const { nextChange } = await load("assets/js/core/banner-schedule.js");
  const now = T("2026-05-01T00:00:00Z");
  const rows = [
    row({ starts_at: "2026-04-01T00:00:00Z", ends_at: "2026-05-10T00:00:00Z" }),
    row({ starts_at: "2026-05-05T00:00:00Z" }),
    row({ starts_at: "2026-05-02T00:00:00Z", enabled: false }),
  ];
  assert.strictEqual(nextChange(rows, now), T("2026-05-05T00:00:00Z"));
  assert.strictEqual(nextChange([row({})], now), null);
});

test("safeLink: solo rutas del sitio o https", async () => {
  const { safeLink } = await load("assets/js/core/banner-schedule.js");
  for (const ok of ["/", "/productos?disponibilidad=oferta", "https://intercomsite.com.ar", "/envios#faq"]) assert.strictEqual(safeLink(ok), ok);
  const js = "java" + "script:alert(1)";
  for (const bad of [js, "data:text/html,x", "//otro-sitio.com", "/\\otro.com", "http://inseguro.com", "ftp://x", "producto", " ", "", null, undefined]) {
    assert.strictEqual(safeLink(bad), "", `no debería aceptar ${bad}`);
  }
});

test("cada [data-slot] del inicio está en el registro y cada slot del registro está en el HTML", async () => {
  const { SLOTS } = await load("assets/js/config/banner-slots.js");
  const html = read("tienda/index.html");
  const inHtml = [...html.matchAll(/data-slot="([a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual([...inHtml].sort(), SLOTS.map((s) => s.id).sort());
  for (const id of inHtml) assert.ok(html.includes(`id="slot-${id}"`), `${id}: falta id="slot-${id}"`);
  assert.strictEqual(new Set(inHtml).size, inHtml.length, "slots repetidos");
  for (const s of SLOTS) assert.match(s.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  // La miniatura "original" del panel tiene que ser la imagen que trae el HTML en ese lugar
  for (const s of SLOTS) {
    const block = html.slice(html.indexOf(`data-slot="${s.id}"`)).split("</picture>")[0].split("<section")[0];
    assert.ok(block.includes(`src="${s.original}"`), `${s.id}: original ${s.original} no coincide con el HTML`);
  }
});

test("el inicio solo se puede embeber con ?editor=1 y solo desde el panel; el resto sigue sin iframes", () => {
  const cfg = JSON.parse(read("vercel.json"));
  const h = (rule) => Object.fromEntries(rule.headers.map((x) => [x.key.toLowerCase(), x.value]));
  const general = cfg.headers.find((r) => r.source === "/(.+)");
  const homeNormal = cfg.headers.find((r) => r.source === "/" && r.missing);
  const homeEditor = cfg.headers.find((r) => r.source === "/" && r.has);
  assert.ok(general && homeNormal && homeEditor, "faltan las reglas del inicio");
  assert.deepStrictEqual(homeEditor.has, [{ type: "query", key: "editor", value: "1" }]);
  assert.deepStrictEqual(homeNormal.missing, homeEditor.has, "las dos reglas del inicio tienen que ser complementarias");
  assert.deepStrictEqual(h(homeNormal), h(general), "el inicio normal lleva los mismos headers que el resto");
  assert.strictEqual(h(general)["x-frame-options"], "DENY");
  // El editor: sin X-Frame-Options y con frame-ancestors solo del panel
  const e = h(homeEditor);
  assert.ok(!e["x-frame-options"]);
  const fa = e["content-security-policy"].match(/frame-ancestors ([^;]+)/)[1].split(/\s+/);
  for (const o of fa) assert.match(o, /^https?:\/\/dash\./, `frame-ancestors solo del panel, no ${o}`);
  // Todo lo demás es igual a la regla general
  const strip = (r) => ({ ...r, "x-frame-options": undefined, "content-security-policy": r["content-security-policy"].replace(/frame-ancestors [^;]+/, "") });
  assert.deepStrictEqual(strip(e), strip(h(general)));
});

test("el panel puede embeber la tienda (frame-src) y la CSP no abre nada más", () => {
  const cfg = JSON.parse(read("vercel.json"));
  const csp = cfg.headers.find((r) => r.source === "/(.+)").headers.find((x) => x.key === "Content-Security-Policy").value;
  const fs_ = csp.match(/frame-src ([^;]+)/)[1].split(/\s+/);
  assert.ok(fs_.includes("https://computersell.com.ar"));
  assert.ok(!fs_.includes("*") && !fs_.includes("https:"));
});

test("el modo editor de la tienda solo le hace caso al panel", () => {
  const src = read("assets/js/core/banners.js");
  assert.match(src, /PANEL_ORIGIN = location\.origin\.replace\("\/\/", "\/\/dash\."\)/);
  assert.match(src, /e\.origin !== PANEL_ORIGIN \|\| e\.source !== window\.parent/);
  assert.ok(!/postMessage\([^)]*"\*"\)/.test(src), "nada de postMessage con '*'");
  const ed = read("dash/js/banners-editor.js");
  assert.match(ed, /e\.origin !== storeOrigin \|\| e\.source !== frame\.contentWindow/);
  assert.ok(!/postMessage\([\s\S]*?"\*"\s*\)/.test(ed), "nada de postMessage con '*'");
});
