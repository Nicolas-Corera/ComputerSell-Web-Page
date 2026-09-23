// Regresión de los XSS almacenados del panel y del perfil: toma la línea de
// plantilla REAL del archivo fuente, la evalúa con un payload malicioso y el
// escapeHtml real de assets/js/core/utils.js, y verifica que el resultado no
// rompa el atributo ni inyecte etiquetas.
// Uso: node --test tests/js/
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..");

const window = {};
vm.runInNewContext(fs.readFileSync(path.join(ROOT, "assets/js/core/utils.js"), "utf8"), {
  window,
  document: { addEventListener() {} },
  localStorage: { getItem() {}, setItem() {} },
});
const { escapeHtml } = window.CS;

// Evalúa como template literal la única línea de `file` que coincide con `marker` (texto o RegExp)
function renderLine(file, marker, scope) {
  const match = (l) => (marker instanceof RegExp ? marker.test(l) : l.includes(marker));
  const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split(/\r?\n/).filter(match);
  assert.strictEqual(lines.length, 1, `se esperaba una sola línea con ${marker} en ${file}`);
  const names = Object.keys(scope);
  return new Function(...names, "return `" + lines[0].trim() + "`;")(...names.map((k) => scope[k]));
}

// El HTML generado no debe contener etiquetas ni atributos que vengan del
// payload: se miran solo las etiquetas reales (sin el contenido de los valores
// entre comillas, donde el payload escapado queda como texto).
function assertInert(html, label) {
  const tags = html.replace(/"[^"]*"/g, '""').match(/<[^>]*>/g) || [];
  tags.forEach((t) => {
    assert.ok(!/^<(img|script|iframe)\b/i.test(t), `${label}: se inyectó ${t} -> ${html}`);
    assert.ok(!/\son\w+\s*=/i.test(t), `${label}: se inyectó un handler en ${t} -> ${html}`);
  });
}

const ATTR = 'x"/></svg></span><img src=x onerror=document.title="xss"><span a="';

test("panel: notifications.type / icon escapados (notif-icon)", () => {
  const html = renderLine("dash/js/dashboard.js", 'class="notif-icon', { n: { type: ATTR, icon: ATTR }, escapeHtml });
  assertInert(html, "notif-icon");
});

test("panel: icono de la paleta de comandos escapado", () => {
  const html = renderLine("dash/js/dashboard.js", /#ic-\$\{(escapeHtml\()?it\.icon/, { it: { icon: ATTR }, escapeHtml });
  assertInert(html, "palette icon");
});
