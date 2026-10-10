// Ficha de producto (detail.html?id=<uuid>): se carga desde la base y se
// actualiza en vivo (precio, stock, imágenes). Galería, cantidad, tabs y
// productos relacionados (solo 4 tarjetas).
import { sb, toCard, CATEGORIES, loading, PRODUCT_COLUMNS } from "../core/supabase.js";
import { fetchCards, onCatalogChange, applyChange, refreshCart } from "../core/catalog.js";

const { formatPrice, escapeHtml, cardHtml, register } = window.CS;
const $ = (s) => document.querySelector(s);

const id = new URLSearchParams(location.search).get("id");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const detail = $("#productDetail");
let product = null;

// ---------- Galería: carrusel ----------
// La imagen grande es un carrusel: flechas, puntos, miniaturas, deslizar con
// el dedo (scroll-snap) y flechas del teclado. Al llegar a una punta, la
// flecha da la vuelta.
const track = $("#galleryTrack");
let galleryImgs = [];
let slide = 0;

function syncGallery() {
  document.querySelectorAll("#galleryThumbs .thumb").forEach((t, i) => t.classList.toggle("is-active", i === slide));
  document.querySelectorAll("#galleryDots button").forEach((d, i) => d.setAttribute("aria-current", i === slide ? "true" : "false"));
}

function goTo(i, smooth = true) {
  const n = galleryImgs.length;
  if (!n) return;
  slide = ((i % n) + n) % n;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  track.scrollTo({ left: slide * track.clientWidth, behavior: smooth && !reduce ? "smooth" : "auto" });
  syncGallery();
}

// Al deslizar con el dedo o el trackpad: la imagen visible pasa a ser la actual
let scrollTimer = null;
track.addEventListener("scroll", () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    if (i !== slide && i >= 0 && i < galleryImgs.length) {
      slide = i;
      syncGallery();
    }
  }, 80);
});
// Si cambia el ancho (rotar el celular), se queda en la misma imagen
window.addEventListener("resize", () => goTo(slide, false));
// Anterior / siguiente; al dar la vuelta (de la última a la primera) salta sin animar
const prev = () => goTo(slide - 1, slide > 0);
const next = () => goTo(slide + 1, slide < galleryImgs.length - 1);
$("#galleryPrev").addEventListener("click", prev);
$("#galleryNext").addEventListener("click", next);
$("#galleryDots").addEventListener("click", (e) => {
  const dot = e.target.closest("[data-slide]");
  if (dot) goTo(Number(dot.dataset.slide));
});
$("#galleryMain").addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") (e.preventDefault(), prev());
  if (e.key === "ArrowRight") (e.preventDefault(), next());
});

function renderGallery(imgs, title) {
  const current = galleryImgs[slide];
  galleryImgs = imgs;
  // En vivo (cambio de imágenes desde el panel): se queda en la que estaba viendo
  slide = Math.max(0, imgs.indexOf(current));
  const many = imgs.length > 1;
  track.innerHTML = imgs
    .map(
      (src, i) =>
        `<div class="gallery-slide" role="group" aria-roledescription="imagen" aria-label="${i + 1} de ${imgs.length}"><img src="${escapeHtml(src)}" alt="${escapeHtml(title)}${many ? ` (imagen ${i + 1})` : ""}" ${i ? 'loading="lazy"' : ""} draggable="false" /></div>`,
    )
    .join("");
  $("#galleryPrev").hidden = $("#galleryNext").hidden = $("#galleryDots").hidden = !many;
  $("#galleryDots").innerHTML = many
    ? imgs.map((_, i) => `<button type="button" data-slide="${i}" aria-label="Ver imagen ${i + 1} de ${imgs.length}"></button>`).join("")
    : "";
  // Miniaturas como botones: se pueden elegir con el teclado
  $("#galleryThumbs").innerHTML = many
    ? imgs
        .map(
          (src, i) =>
            `<button type="button" class="thumb" data-slide="${i}" aria-label="Ver imagen ${i + 1} de ${imgs.length}"><img src="${escapeHtml(src)}" alt="" /></button>`,
        )
        .join("")
    : "";
  goTo(slide, false);
}

// La cantidad real vive en data-qty; el input muestra "99+" a partir de 100
window.changeQty = function (delta) {
  const input = $("#qtyInput");
  const current = parseInt(input.dataset.qty || input.value, 10) || 1;
  // Tope: el stock y como mucho 10 por pedido (lo exige también el backend)
  const MAX_PER_ORDER = 10;
  const max = product ? Math.max(1, Math.min(MAX_PER_ORDER, product.stock)) : MAX_PER_ORDER;
  const next = Math.min(max, Math.max(1, current + delta));
  input.dataset.qty = next;
  input.value = next;
  const atMax = !!product && next >= max;
  $("#qtyPlus").disabled = atMax;
  const limit = $("#qtyLimit");
  limit.hidden = !atMax || !product || product.stock <= 0;
  if (atMax && product)
    limit.querySelector("span").textContent =
      product.stock <= MAX_PER_ORDER
        ? `Límite alcanzado: hay ${product.stock} unidad${product.stock === 1 ? "" : "es"} disponible${product.stock === 1 ? "" : "s"} y ya tenés ${next} en la selección.`
        : `Podés comprar hasta ${MAX_PER_ORDER} unidades por pedido. Si necesitás más, escribinos por WhatsApp.`;
};

window.switchTab = function (btn, panelId) {
  document.querySelectorAll(".tabs .tab-btn").forEach((b) => b.classList.remove("is-active"));
  document.querySelectorAll(".tabs .tab-panel").forEach((p) => p.classList.remove("is-active"));
  btn.classList.add("is-active");
  document.getElementById(panelId).classList.add("is-active");
};

// Miniaturas de la galería (se renderizan después): data-slide
$("#galleryThumbs").addEventListener("click", (e) => {
  const thumb = e.target.closest("[data-slide]");
  if (thumb) goTo(Number(thumb.dataset.slide));
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
  renderGallery(p.images && p.images.length ? p.images : [], p.title);
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
  const low = p.stock === 1 ? "¡Última unidad!" : `¡Últimas ${p.stock} unidades!`;
  $("#stockText").textContent = out
    ? "Sin stock por el momento"
    : `${p.stock <= p.stock_min ? low : "Stock disponible"} · ${DELIVERY[p.delivery] || p.delivery}`;
  $("#addCartBtn").disabled = out;
  $("#buyNowBtn").disabled = out;
  $("#addCartBtn").querySelector("span").textContent = out ? "Sin stock" : "Agregar al carrito";
  changeQty(0);

  $("#shipLine span").innerHTML = p.free_shipping
    ? "<strong>Envío gratis</strong> solo para CABA y Provincia de Buenos Aires"
    : "<strong>Envío a domicilio</strong> a todo el país";
  // Garantía del vendedor: la que se cargó en el panel (días, meses o años)
  const UNIT = { dias: ["día", "días"], meses: ["mes", "meses"], anios: ["año", "años"] };
  const warranty = p.warranty
    ? `${p.warranty} ${(UNIT[p.warranty_unit] || UNIT.meses)[p.warranty === 1 ? 0 : 1]} de garantía`
    : "Garantía a consultar";
  $("#warrantyLine").innerHTML = `<strong>${escapeHtml(warranty)}</strong> del vendedor (ComputerSell)`;

  // Descripción / especificaciones
  $("#pDescription").innerHTML = String(p.description || "")
    .split(/\n{2,}|\n/)
    .filter((t) => t.trim())
    .map((t) => `<p>${escapeHtml(t)}</p>`)
    .join("");
  $("#pHighlights").innerHTML = (p.highlights || []).map((h) => `<li><svg><use href="#ic-check" /></svg> ${escapeHtml(h)}</li>`).join("");
  const specs = (p.specs || []).map((s) => `<tr><td>${escapeHtml(s.k)}</td><td>${escapeHtml(s.v)}</td></tr>`);
  if (p.weight > 0) specs.push(`<tr><td>Peso</td><td>${escapeHtml(p.weight)} ${escapeHtml(p.weight_unit || "kg")}</td></tr>`);
  if (p.dimensions) specs.push(`<tr><td>Dimensiones</td><td>${escapeHtml(p.dimensions)} ${escapeHtml(p.dimensions_unit || "cm")}</td></tr>`);
  specs.push(`<tr><td>Garantía del vendedor</td><td>${escapeHtml(warranty)} (ComputerSell)</td></tr>`);
  $("#pSpecs").innerHTML = specs.join("") || `<tr><td colspan="2">Sin especificaciones cargadas.</td></tr>`;

  if (window.syncFavorites) window.syncFavorites();
}

function missing() {
  // Soft 404: que los buscadores no indexen la ficha vacía
  document.title = "Producto no encontrado — ComputerSell";
  let robots = document.querySelector('meta[name="robots"]');
  if (!robots) {
    robots = document.createElement("meta");
    robots.name = "robots";
    document.head.appendChild(robots);
  }
  robots.content = "noindex";
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
  // Un id mal formado ni se consulta (la base respondería 400)
  if (!id || !UUID_RE.test(id)) return missing();
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
