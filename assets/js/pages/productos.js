// Página de productos: filtros, búsqueda, orden, paginación y contador.
// Los productos vienen de la base (catálogo en tiempo real); los filtros
// se aplican en memoria sobre esa lista.
import { createCatalog } from "../core/catalog.js";
import { toCard, slugify, loading } from "../core/supabase.js";

const { formatPrice, escapeHtml, cardHtml, emptyHtml } = window.CS;

const aside = document.getElementById("filtersAside");
const backdrop = document.getElementById("filtersBackdrop");
const openBtn = document.getElementById("filtersToggle");
const closeBtn = document.getElementById("filtersClose");
const activeFilters = document.getElementById("activeFilters");
const clearAllBtn = document.getElementById("clearAllFilters");
const filterCount = document.getElementById("filterCount");
const grid = document.getElementById("productsGrid");
const emptyState = document.getElementById("productsEmpty");
const emptyClearBtn = document.getElementById("productsEmptyClear");
const resultsCount = document.getElementById("resultsCount");
const searchInput = document.getElementById("searchProducts");
const sortSelect = document.getElementById("sortProducts");
const priceMin = document.getElementById("priceMin");
const priceMax = document.getElementById("priceMax");
const applyPriceBtn = document.getElementById("applyPrice");
const brandOptions = document.getElementById("brandOptions");
const pagination = document.getElementById("pagination");

const PAGE_SIZE = 24;

// "Categoría" -> "categoria"
const normalize = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const SUBGROUPS = ["componentes", "perifericos"];
const AVAILABILITY = { "en stock": "stock", "con envio gratis": "shipping", "en oferta": "sale" };

let items = []; // productos precalculados para filtrar
let page = 1;
const priceRange = { min: null, max: null };

function prepare(rows) {
  items = rows.map((p, index) => ({
    p,
    card: toCard(p),
    index,
    name: normalize(p.title + " " + p.brand + " " + (p.tags || []).join(" ") + " " + p.sku),
    price: p.price,
    category: p.category,
    type: slugify(p.subcategory),
    brand: normalize(p.brand),
    stock: p.stock > 0,
    shipping: !!p.free_shipping,
    sale: !!(p.on_sale && p.old_price > p.price),
    created: new Date(p.created_at).getTime(),
  }));
}

const checkboxes = () => Array.from(aside.querySelectorAll('input[type="checkbox"][data-filter-group]'));
const subGroups = Array.from(aside.querySelectorAll(".filterGroup[data-parent]"));

// ---------- Acordeón y panel mobile ----------
aside.querySelectorAll(".filterGroup-head").forEach((head) => {
  head.addEventListener("click", () => head.closest(".filterGroup").classList.toggle("is-collapsed"));
});
const openAside = () => {
  aside.classList.add("is-open");
  backdrop.classList.add("is-open");
};
const closeAside = () => {
  aside.classList.remove("is-open");
  backdrop.classList.remove("is-open");
};
openBtn && openBtn.addEventListener("click", openAside);
closeBtn && closeBtn.addEventListener("click", closeAside);
backdrop && backdrop.addEventListener("click", closeAside);

// ---------- Marcas (dinámicas según el catálogo) ----------
function renderBrands() {
  const checked = new Set(checkboxes().filter((i) => i.checked && normalize(i.dataset.filterGroup) === "marca").map((i) => i.dataset.filterLabel));
  const brands = Array.from(new Set(items.map((i) => i.p.brand).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"));
  brandOptions.innerHTML = brands
    .map(
      (b) => `
      <label class="checkOption">
        <input type="checkbox" data-filter-group="Marca" data-filter-label="${escapeHtml(b)}" ${checked.has(b) ? "checked" : ""} />
        <span class="checkbox"><svg><use href="#ic-check" /></svg></span>
        <span>${escapeHtml(b)}</span>
        <span class="count"></span>
      </label>`,
    )
    .join("");
  brandOptions.querySelectorAll("input").forEach((input) => input.addEventListener("change", update));
}

// ---------- Contadores por opción ----------
function matchesOption(item, input) {
  const group = normalize(input.dataset.filterGroup);
  const label = normalize(input.dataset.filterLabel);
  if (group === "categoria") return item.category === label;
  if (SUBGROUPS.includes(group)) return item.category === group && item.type === slugify(label);
  if (group === "marca") return item.brand === label;
  if (group === "disponibilidad") return !!item[AVAILABILITY[label]];
  return false;
}

function renderCounts() {
  checkboxes().forEach((input) => {
    const countEl = input.closest(".checkOption")?.querySelector(".count");
    if (countEl) countEl.textContent = items.filter((c) => matchesOption(c, input)).length;
  });
}

// ---------- Filtrado ----------
function readChecked() {
  const state = { categoria: [], componentes: [], perifericos: [], marca: [], disponibilidad: [] };
  checkboxes().forEach((input) => {
    if (!input.checked) return;
    const group = normalize(input.dataset.filterGroup);
    if (!state[group]) return;
    const label = input.dataset.filterLabel;
    state[group].push(SUBGROUPS.includes(group) ? slugify(label) : normalize(label));
  });
  return state;
}

function passes(item, state, query) {
  if (state.categoria.length && !state.categoria.includes(item.category)) return false;
  const types = state[item.category];
  if (types && types.length && !types.includes(item.type)) return false;
  if (state.marca.length && !state.marca.includes(item.brand)) return false;
  if (state.disponibilidad.some((label) => !item[AVAILABILITY[label]])) return false;
  if (priceRange.min !== null && item.price < priceRange.min) return false;
  if (priceRange.max !== null && item.price > priceRange.max) return false;
  if (query && !item.name.includes(query)) return false;
  return true;
}

function sortItems(list) {
  const mode = sortSelect ? sortSelect.value : "relevancia";
  const sorted = list.slice();
  if (mode === "menor-precio") sorted.sort((a, b) => a.price - b.price);
  else if (mode === "mayor-precio") sorted.sort((a, b) => b.price - a.price);
  else if (mode === "novedades") sorted.sort((a, b) => b.created - a.created);
  else sorted.sort((a, b) => Number(b.stock) - Number(a.stock) || a.index - b.index);
  return sorted;
}

function applyFilters() {
  const state = readChecked();
  const query = normalize(searchInput ? searchInput.value : "");
  const visible = sortItems(items.filter((item) => passes(item, state, query)));

  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  if (page > pages) page = pages;
  const slice = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  grid.innerHTML = slice.map((it) => cardHtml(it.card)).join("");
  if (window.syncFavorites) window.syncFavorites(grid);

  if (resultsCount) {
    const n = visible.length;
    resultsCount.innerHTML = `<strong>${n}</strong> ${n === 1 ? "producto encontrado" : "productos encontrados"}`;
  }
  // Sin resultados: catálogo vacío (mensaje simple) o filtros sin coincidencias (con "limpiar")
  const catalogEmpty = items.length === 0;
  emptyState.hidden = visible.length > 0 || catalogEmpty;
  grid.hidden = visible.length === 0 && !catalogEmpty;
  if (catalogEmpty) {
    grid.innerHTML = emptyHtml("Todavía no hay productos publicados", "Estamos cargando el catálogo. Volvé a pasar en un rato o escribinos para consultar disponibilidad.", { href: "/contacto.html", label: "Contactanos", icon: "ic-info" });
  }
  renderPagination(pages);
}

function renderPagination(pages) {
  pagination.hidden = pages <= 1;
  if (pages <= 1) return (pagination.innerHTML = "");
  let html = "";
  for (let i = 1; i <= pages; i++) html += `<button type="button" class="${i === page ? "active" : ""}" data-page="${i}">${i}</button>`;
  if (page < pages) html += `<button type="button" data-page="${page + 1}" aria-label="Siguiente"><svg class="ic-sm"><use href="#ic-arrow_forward" /></svg></button>`;
  pagination.innerHTML = html;
}
pagination.addEventListener("click", (e) => {
  const b = e.target.closest("[data-page]");
  if (!b) return;
  page = +b.dataset.page;
  applyFilters();
  grid.scrollIntoView({ behavior: "smooth", block: "start" });
});

// ---------- Tags de filtros activos ----------
function makeTag(text, onRemove) {
  const tag = document.createElement("span");
  tag.className = "filterTag";
  const label = document.createElement("span");
  label.textContent = text;
  tag.appendChild(label);
  const removeBtn = document.createElement("button");
  removeBtn.className = "filterTag-remove";
  removeBtn.type = "button";
  removeBtn.setAttribute("aria-label", `Quitar filtro ${text}`);
  removeBtn.innerHTML = `<svg class="ic-sm"><use href="#ic-close"/></svg>`;
  removeBtn.addEventListener("click", onRemove);
  tag.appendChild(removeBtn);
  activeFilters.insertBefore(tag, clearAllBtn);
}

function renderTags() {
  activeFilters.querySelectorAll(".filterTag").forEach((tag) => tag.remove());
  let count = 0;
  checkboxes()
    .filter((input) => input.checked)
    .forEach((input) => {
      count++;
      makeTag(`${input.dataset.filterGroup}: ${input.dataset.filterLabel}`, () => {
        input.checked = false;
        update();
      });
    });
  if (priceRange.min !== null || priceRange.max !== null) {
    count++;
    const min = priceRange.min !== null ? `$${formatPrice(priceRange.min)}` : "";
    const max = priceRange.max !== null ? `$${formatPrice(priceRange.max)}` : "";
    const text = min && max ? `Precio: ${min} – ${max}` : min ? `Precio: desde ${min}` : `Precio: hasta ${max}`;
    makeTag(text, () => {
      clearPrice();
      update();
    });
  }
  activeFilters.hidden = count === 0;
  if (filterCount) {
    filterCount.hidden = count === 0;
    filterCount.textContent = count;
  }
}

// Subgrupo visible solo con su categoría marcada
function syncSubGroups() {
  subGroups.forEach((group) => {
    const parent = normalize(group.dataset.parent);
    const enabled = checkboxes().some(
      (input) => input.checked && normalize(input.dataset.filterGroup) === "categoria" && normalize(input.dataset.filterLabel) === parent,
    );
    group.hidden = !enabled;
    if (!enabled) group.querySelectorAll("input:checked").forEach((input) => (input.checked = false));
  });
}

function update() {
  page = 1;
  syncSubGroups();
  renderTags();
  applyFilters();
}

// ---------- Precio ----------
function readPriceInputs() {
  const min = priceMin && priceMin.value !== "" ? Number(priceMin.value) : null;
  const max = priceMax && priceMax.value !== "" ? Number(priceMax.value) : null;
  priceRange.min = min !== null && !Number.isNaN(min) ? min : null;
  priceRange.max = max !== null && !Number.isNaN(max) ? max : null;
}
function clearPrice() {
  priceRange.min = null;
  priceRange.max = null;
  if (priceMin) priceMin.value = "";
  if (priceMax) priceMax.value = "";
}
applyPriceBtn &&
  applyPriceBtn.addEventListener("click", () => {
    readPriceInputs();
    update();
  });
[priceMin, priceMax].forEach((input) => {
  input &&
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        readPriceInputs();
        update();
      }
    });
});

// ---------- Limpiar todo ----------
function clearAll() {
  checkboxes().forEach((input) => (input.checked = false));
  clearPrice();
  if (searchInput) searchInput.value = "";
  update();
}
clearAllBtn.addEventListener("click", clearAll);
emptyClearBtn && emptyClearBtn.addEventListener("click", clearAll);

// ---------- Eventos ----------
checkboxes().forEach((input) => input.addEventListener("change", update));
searchInput &&
  searchInput.addEventListener("input", () => {
    page = 1;
    applyFilters();
  });
sortSelect && sortSelect.addEventListener("change", applyFilters);

// Filtros preseleccionados desde la URL (menú de productos):
// ?categoria=componentes&tipo=fuentes
const params = new URLSearchParams(window.location.search);
const categoria = normalize(params.get("categoria"));
const tipo = slugify(params.get("tipo"));
if (categoria) {
  checkboxes().forEach((input) => {
    const group = normalize(input.dataset.filterGroup);
    const label = input.dataset.filterLabel;
    if (group === "categoria" && normalize(label) === categoria) input.checked = true;
    if (tipo && group === categoria && slugify(label) === tipo) input.checked = true;
  });
}
if (params.get("q") && searchInput) searchInput.value = params.get("q");

// ---------- Datos ----------
const catalog = createCatalog();
catalog.onChange((cat) => {
  prepare(cat.all());
  renderBrands();
  renderCounts();
  syncSubGroups();
  renderTags();
  applyFilters();
});
loading(catalog.ready);
