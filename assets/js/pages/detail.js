// Ficha de producto (detail.html?id=<uuid>): se carga desde la base y se
// actualiza en vivo (precio, stock, imágenes). Galería, cantidad, tabs y
// productos relacionados (solo 4 tarjetas).
import { sb, toCard, CATEGORIES, loading, PRODUCT_COLUMNS } from "../core/supabase.js";
import { fetchCards, onCatalogChange, applyChange, refreshCart } from "../core/catalog.js";

const { formatPrice, escapeHtml, cardHtml, register } = window.CS;
const $ = (s) => document.querySelector(s);

const id = new URLSearchParams(location.search).get("id");
const detail = $("#productDetail");
let product = null;

// ---------- Helpers globales usados por los onclick del HTML ----------
window.setMainImage = function (el, src) {
  $("#mainImage").src = src;
  document.querySelectorAll(".thumb").forEach((t) => t.classList.remove("is-active"));
  el.classList.add("is-active");
};

// La cantidad real vive en data-qty; el input muestra "99+" a partir de 100
window.changeQty = function (delta) {
  const input = $("#qtyInput");
  const current = parseInt(input.dataset.qty || input.value, 10) || 1;
  const max = product ? Math.max(1, product.stock) : 99;
  const next = Math.min(max, Math.max(1, current + delta));
  input.dataset.qty = next;
  input.value = next > 99 ? "99+" : next;
  // Al llegar al stock: se bloquea el "+" y se avisa cuántas unidades hay
  const atMax = !!product && next >= product.stock;
  $("#qtyPlus").disabled = atMax;
  const limit = $("#qtyLimit");
  limit.hidden = !atMax || !product || product.stock <= 0;
  if (atMax && product) limit.querySelector("span").textContent = `Límite alcanzado: hay ${product.stock} unidad${product.stock === 1 ? "" : "es"} disponible${product.stock === 1 ? "" : "s"} y ya tenés ${next} en la selección.`;
};

window.switchTab = function (btn, panelId) {
  document.querySelectorAll(".tabs .tab-btn").forEach((b) => b.classList.remove("is-active"));
  document.querySelectorAll(".tabs .tab-panel").forEach((p) => p.classList.remove("is-active"));
  btn.classList.add("is-active");
  document.getElementById(panelId).classList.add("is-active");
};

// Miniaturas de la galería (se renderizan después): data-main-src
document.addEventListener("click", (e) => {
  const thumb = e.target.closest("[data-main-src]");
  if (thumb) window.setMainImage(thumb, thumb.dataset.mainSrc);
});

// Pestañas y cantidad: declarados con data-* en detail.html (sin onclick inline)
document.querySelectorAll("[data-tab-panel]").forEach((b) => b.addEventListener("click", () => window.switchTab(b, b.dataset.tabPanel)));
document.querySelectorAll("[data-qty-delta]").forEach((b) => b.addEventListener("click", () => window.changeQty(Number(b.dataset.qtyDelta))));

// ---------- Render ----------
function render(p) {
  product = p;
  const card = toCard(p);
  register(card);
  detail.dataset.id = p.id;
  document.title = `${p.title} — ComputerSell`;

  const cat = CATEGORIES[p.category];
  $("#crumbCategory").textContent = cat ? cat.label : "Productos";
  $("#crumbCategory").href = `/productos.html?categoria=${p.category}`;
  $("#crumbTitle").textContent = p.title;

  // Galería
  const imgs = p.images && p.images.length ? p.images : [];
  const main = $("#mainImage");
  if (!imgs.includes(main.getAttribute("src"))) main.src = imgs[0] || "";
  main.alt = p.title;
  $("#galleryThumbs").innerHTML = imgs
    .map(
      (src, i) =>
        `<div class="thumb ${src === main.getAttribute("src") || (!main.getAttribute("src") && i === 0) ? "is-active" : ""}" data-main-src="${escapeHtml(src)}"><img src="${escapeHtml(src)}" alt="Imagen ${i + 1}" /></div>`,
    )
    .join("");
  const badge = $("#discountBadge");
  badge.hidden = !card.oldPrice;
  if (card.oldPrice) badge.querySelector("span").textContent = `${Math.round((1 - p.price / card.oldPrice) * 100)}% OFF`;

  // Info
  $("#pBrand").textContent = p.brand;
  $("#pSku").textContent = `· SKU ${p.sku}`;
  $("#pTitle").textContent = p.title;
  $("#pOld").hidden = !card.oldPrice;
  $("#pOld").textContent = card.oldPrice ? `$${formatPrice(card.oldPrice)}` : "";
  $("#pPrice").textContent = formatPrice(p.price);
  const cuotas = $("#pCuotas");
  // Cuotas sin interés ocultas: solo se paga por transferencia
  cuotas.hidden = true;
  if (p.installments) cuotas.textContent = `${p.installments} cuotas sin interés de $${formatPrice(Math.round(p.price / p.installments))}`;

  const DELIVERY = { "24-48hs": "Envío en 24/48 hs", "3-5": "Envío en 3 a 5 días hábiles", "7-10": "Envío en 7 a 10 días hábiles", "a-pedido": "A pedido (consultar)" };
  const out = p.stock <= 0;
  $("#stockDot").style.background = out ? "#ef4444" : p.stock <= p.stock_min ? "#f59e0b" : "";
  $("#stockText").textContent = out
    ? "Sin stock por el momento"
    : `${p.stock <= p.stock_min ? `¡Últimas ${p.stock} unidad${p.stock === 1 ? "" : "es"}!` : "Stock disponible"} · ${DELIVERY[p.delivery] || p.delivery}`;
  $("#addCartBtn").disabled = out;
  $("#buyNowBtn").disabled = out;
  $("#addCartBtn").querySelector("span").textContent = out ? "Sin stock" : "Agregar al carrito";
  changeQty(0);

  $("#shipLine span").innerHTML = p.free_shipping ? "<strong>Envío gratis</strong> para CABA y Provincia de Buenos Aires" : "<strong>Envío a domicilio</strong> a todo el país";
  const UNIT = { dias: ["día", "días"], meses: ["mes", "meses"], anios: ["año", "años"] };
  const warranty = p.warranty ? `${p.warranty} ${(UNIT[p.warranty_unit] || UNIT.meses)[p.warranty === 1 ? 0 : 1]} de garantía oficial` : "";
  $("#warrantyLine").innerHTML = warranty ? `<strong>${warranty}</strong> ComputerSell` : "Garantía oficial ComputerSell";

  // Descripción / especificaciones
  $("#pDescription").innerHTML = String(p.description || "")
    .split(/\n{2,}|\n/)
    .filter((t) => t.trim())
    .map((t) => `<p>${escapeHtml(t)}</p>`)
    .join("");
  $("#pHighlights").innerHTML = (p.highlights || []).map((h) => `<li><svg><use href="#ic-check" /></svg> ${escapeHtml(h)}</li>`).join("");
  const specs = (p.specs || []).map((s) => `<tr><td>${escapeHtml(s.k)}</td><td>${escapeHtml(s.v)}</td></tr>`);
  if (p.weight > 0) specs.push(`<tr><td>Peso</td><td>${p.weight} ${p.weight_unit || "kg"}</td></tr>`);
  if (p.dimensions) specs.push(`<tr><td>Dimensiones</td><td>${escapeHtml(p.dimensions)} ${p.dimensions_unit || "cm"}</td></tr>`);
  if (warranty) specs.push(`<tr><td>Garantía del vendedor</td><td>${warranty} ComputerSell</td></tr>`);
  $("#pSpecs").innerHTML = specs.join("") || `<tr><td colspan="2">Sin especificaciones cargadas.</td></tr>`;

  if (window.syncFavorites) window.syncFavorites();
}

function missing() {
  detail.hidden = true;
  document.querySelector(".tabs").hidden = true;
  $("#relatedSection").hidden = true;
  $("#productMissing").hidden = false;
  $("#crumbTitle").textContent = "Producto no encontrado";
}

let related = [];

function renderRelated() {
  if (!detail.hidden) $("#relatedSection").hidden = !related.length;
  $("#relatedGrid").innerHTML = related.map((r) => cardHtml(toCard(r))).join("");
  if (window.syncFavorites) window.syncFavorites($("#relatedGrid"));
}

async function loadRelated(p) {
  related = await fetchCards((q) => q.eq("category", p.category).neq("id", p.id).order("created_at", { ascending: false }).limit(4));
  renderRelated();
}

// Ficha completa (descripción, specs...): solo este producto
async function loadProduct() {
  const { data } = await sb.from("products").select(PRODUCT_COLUMNS).eq("id", id).eq("status", "publicado").maybeSingle();
  if (!data) return missing();
  render(data);
  return data;
}

// ---------- Carga ----------
loading(async () => {
  if (!id) return missing();
  const data = await loadProduct();
  if (!data) return;
  await loadRelated(data);
  refreshCart(); // precio/stock del carrito (solo esos productos)
  // En vivo: el aviso trae los datos de la tarjeta; para la ficha se vuelve a
  // leer solo este producto (descripción y specs no viajan en el aviso).
  onCatalogChange((change) => {
    if (change.resync) return loadProduct();
    if (change.id === id) return change.removed ? missing() : loadProduct();
    const next = applyChange(related, change);
    if (next) {
      related = next;
      renderRelated();
    }
  });
});
