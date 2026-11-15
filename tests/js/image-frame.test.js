// Encuadre de las imágenes del producto (migración 0044): formato, estilo que
// se aplica en la tarjeta y que la tienda pida la columna pública.
// Uso: node --test tests/js/
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);

test("normalizeFrame: acota los valores y descarta el encuadre de siempre", async () => {
  const { normalizeFrame } = await load("assets/js/core/image-frame.js");
  assert.strictEqual(normalizeFrame(null), null);
  assert.strictEqual(normalizeFrame({ fit: "contain", zoom: 1, x: 50, y: 50 }), null);
  assert.deepStrictEqual(normalizeFrame({ fit: "cover", zoom: 9, x: -5, y: 500 }), { fit: "cover", zoom: 3, x: 0, y: 100 });
  assert.deepStrictEqual(normalizeFrame({ fit: "otro", zoom: "x", x: "y", y: null }), null);
});

test("frameStyle: solo números y palabras fijas (nada que se pueda colar en el style)", async () => {
  const { frameStyle } = await load("assets/js/core/image-frame.js");
  assert.strictEqual(frameStyle(null), "");
  const s = frameStyle({ fit: "cover", zoom: 1.5, x: 20, y: 80 });
  assert.strictEqual(s, "object-fit:cover;object-position:20% 80%;transform:scale(1.5);transform-origin:20% 80%;");
  const evil = frameStyle({ fit: "cover;background:url(x)", zoom: "1;x", x: "20;y", y: 80 });
  assert.match(evil, /^[a-z\-:;0-9.% ()]*$/);
  assert.ok(!evil.includes("url"));
});

test("framesToSave: null si ninguna imagen tiene encuadre propio", async () => {
  const { framesToSave } = await load("assets/js/core/image-frame.js");
  assert.strictEqual(framesToSave([null, null]), null);
  assert.deepStrictEqual(framesToSave([null, { fit: "cover", zoom: 2, x: 10, y: 10 }]), [null, { fit: "cover", zoom: 2, x: 10, y: 10 }]);
});

test("la tienda pide image_frames y la base la expone solo como columna pública", () => {
  assert.match(read("assets/js/core/catalog.js"), /weight_unit,images,image_frames"/);
  assert.match(read("assets/js/core/supabase.js"), /images,image_frames,specs/);
  const sql = read("supabase/migrations/0044_productos_encuadre_imagenes.sql");
  assert.match(sql, /grant select \(image_frames\) on public\.products to anon, authenticated/);
  assert.match(sql, /valid_image_frames/);
});

test("la tarjeta escapa el estilo del encuadre", () => {
  assert.match(read("assets/js/core/utils.js"), /style="\$\{escapeHtml\(p\.imageStyle\)\}"/);
});

test("el catálogo paginado y el broadcast traen precio con transferencia y encuadre (0045)", () => {
  const sql = read("supabase/migrations/0045_catalogo_transferencia_encuadre.sql");
  assert.match(sql, /p\.price, p\.transfer_price, p\.old_price/);
  assert.match(sql, /jsonb_build_array\(p\.image_frames->0\) end as image_frames/);
  assert.match(sql, /'transfer_price', r\.transfer_price/);
  assert.match(sql, /'image_frames', case when r\.image_frames/);
  assert.ok(!/\bcost\b|created_by/.test(sql.replace(/--.*$/gm, "")), "no expone columnas privadas");
});

test("el detalle aplica el encuadre de cada imagen de la galería, escapado", () => {
  const src = read("assets/js/pages/detail.js");
  assert.match(src, /import \{ frameStyle \} from "\.\.\/core\/image-frame\.js"/);
  assert.match(src, /style="\$\{escapeHtml\(st\)\}"/);
  assert.match(src, /renderGallery\([^;]*p\.image_frames\)/);
});
