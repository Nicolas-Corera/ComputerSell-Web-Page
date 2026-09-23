// Regresión del open redirect de ?next tras el login: evalúa la función real
// safeNext de assets/js/pages/auth.js con los casos del reporte.
// Uso: node --test tests/js/
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "..", "assets/js/pages/auth.js"), "utf8");
const m = src.match(/function safeNext\(value\) \{[\s\S]*?\n\}/);
const location = { origin: "https://computersell.example" };
const safeNext = m && new Function("location", `${m[0]}; return safeNext;`)(location);

test("[LOW] ?next rechaza destinos de otro dominio", () => {
  assert.ok(safeNext, "no se encontró safeNext en auth.js");
  for (const next of ["//evil.example/x", "/\\evil.example", "/\\/evil.example", "/\t/evil.example", "https://evil.example", "javascript:alert(1)", "evil.example", ""]) {
    assert.strictEqual(safeNext(next), null, `aceptó ${JSON.stringify(next)}`);
  }
});

test("?next sigue aceptando rutas del mismo sitio", () => {
  assert.strictEqual(safeNext("/pago.html"), "/pago.html");
  assert.strictEqual(safeNext("/compra-detalle.html?id=abc#nota"), "/compra-detalle.html?id=abc#nota");
  assert.strictEqual(safeNext(null), null);
});
