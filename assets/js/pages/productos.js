// Página de productos: filtros, búsqueda, orden, paginación y contador.
// Filtrado, orden y paginación los resuelve la base (RPC search_products con
// índices): se descarga solo la página visible (12 tarjetas). Los contadores
// de cada filtro salen de catalog_facets (cacheados). Ver core/catalog.js.
import { searchProducts, fetchFacets, onCatalogChange, applyChange, refreshCart } from "../core/catalog.js";
import { toCard, slugify, loading } from "../core/supabase.js";

const { formatPrice, escapeHtml, cardHtml, emptyHtml, toast } = window.CS;

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

const PAGE_SIZE = 12;
const SEARCH_DELAY = 300; // ms sin tipear antes de consultar

// "Categoría" -> "categoria"
const normalize = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const SUBGROUPS = ["componentes", "perifericos"];
const AVAILABILITY = { "en stock": "stock", "con envio gratis": "shipping", "en oferta": "sale" };
// Valor de cada opción de disponibilidad en la URL (?disponibilidad=oferta)
const AVAILABILITY_PARAM = { "en stock": "stock", "con envio gratis": "envio-gratis", "en oferta": "oferta" };
const DEFAULT_SORT = "relevancia";

let rows = []; // productos de la página visible
let total = 0; // resultados con los filtros actuales
let facets = null; // contadores de catalog_facets
let page = 1;
let requestSeq = 0; // descarta respuestas viejas si el usuario sigue filtrando
const priceRange = { min: null, max: null };
// Marcas pedidas en la URL: se marcan cuando llegan los contadores (los checkboxes de marca son dinámicos)
let pendingBrands = new Set();

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
  const checked = new Set(checkboxes().filter((i) => i.checked && normalize(i.dataset.filterGroup) === "marca").map((i) => normalize(i.dataset.filterLabel)));
  pendingBrands.forEach((b) => checked.add(b));
  pendingBrands = new Set();
  const brands = ((facets && facets.brands) || []).slice().sort((a, b) => a.name.localeCompare(b.name, "es"));
  brandOptions.innerHTML = brands
    .map(
      (b) => `
      <label class="checkOption">
        <input type="checkbox" data-filter-group="Marca" data-filter-label="${escapeHtml(b.name)}" ${checked.has(normalize(b.name)) ? "checked" : ""} />
        <span class="checkbox"><svg><use href="#ic-check" /></svg></span>
        <span>${escapeHtml(b.name)}</span>
        <span class="count"></span>
      </label>`,
    )
    .join("");
  brandOptions.querySelectorAll("input").forEach((input) => input.addEventListener("change", update));
}

// ---------- Contadores por opción ----------
function optionCount(input) {
  if (!facets) return "";
  const group = normalize(input.dataset.filterGroup);
  const label = normalize(input.dataset.filterLabel);
  if (group === "categoria") return (facets.categories || {})[label] || 0;
  if (SUBGROUPS.includes(group)) return (facets.subcategories || {})[`${group}/${slugify(input.dataset.filterLabel)}`] || 0;
  if (group === "marca") return ((facets.brands || []).find((b) => b.key === label) || {}).count || 0;
  if (group === "disponibilidad") return facets[AVAILABILITY[label]] || 0;
  return "";
}

function renderCounts() {
  checkboxes().forEach((input) => {
    const countEl = input.closest(".checkOption")?.querySelector(".count");
    if (countEl) countEl.textContent = optionCount(input);
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
  // Marcas de la URL que todavía no tienen checkbox
  pendingBrands.forEach((b) => !state.marca.includes(b) && state.marca.push(b));
  return state;
}

const searchWords = () => normalize(searchInput ? searchInput.value : "").split(/\s+/).filter(Boolean);

function queryParams() {
  const state = readChecked();
  return {
    words: searchWords(),
    categories: state.categoria,
    componentes: state.componentes,
    perifericos: state.perifericos,
    brands: state.marca,
    inStock: state.disponibilidad.includes("en stock"),
    freeShipping: state.disponibilidad.includes("con envio gratis"),
    onSale: state.disponibilidad.includes("en oferta"),
    min: priceRange.min,
    max: priceRange.max,
    sort: sortSelect ? sortSelect.value : DEFAULT_SORT,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };
}

// Pide la página actual a la base y la muestra
async function applyFilters() {
  const seq = ++requestSeq;
  grid.setAttribute("aria-busy", "true");
  let res;
  try {
    res = await searchProducts(queryParams());
  } catch (e) {
    console.error(e);
    if (seq === requestSeq) {
      grid.removeAttribute("aria-busy");
      toast("No se pudieron cargar los productos. Probá de nuevo.", "bad");
    }
    return;
  }
  if (seq !== requestSeq) return; // llegó una búsqueda más nueva

  const pages = Math.max(1, Math.ceil(res.total / PAGE_SIZE));
  // Página fuera de rango (cambió el catálogo o vino de un link viejo): a la última
  if (page > pages) {
    page = pages;
    writeUrl();
    return applyFilters();
  }
  rows = res.items;
  total = res.total;
  renderGrid();
}

function renderGrid() {
  grid.removeAttribute("aria-busy");
  grid.innerHTML = rows.map((p) => cardHtml(toCard(p))).join("");
  if (window.syncFavorites) window.syncFavorites(grid);

  if (resultsCount) {
    resultsCount.innerHTML = `<strong>${total}</strong> ${total === 1 ? "producto encontrado" : "productos encontrados"}`;
  }
  // Sin resultados: catálogo vacío (mensaje simple) o filtros sin coincidencias (con "limpiar")
  const catalogEmpty = facets ? facets.total === 0 : total === 0 && !hasFilters();
  emptyState.hidden = total > 0 || catalogEmpty;
  grid.hidden = total === 0 && !catalogEmpty;
  if (catalogEmpty) {
    grid.innerHTML = emptyHtml("Todavía no hay productos publicados", "Estamos cargando el catálogo. Volvé a pasar en un rato o escribinos para consultar disponibilidad.", { href: "/contacto.html", label: "Contactanos", icon: "ic-info" });
  }
  renderPagination(Math.max(1, Math.ceil(total / PAGE_SIZE)));
}

function hasFilters() {
  const p = queryParams();
  return !!(p.words.length || p.categories.length || p.brands.length || p.inStock || p.freeShipping || p.onSale || p.min !== null || p.max !== null);
}

// 1 … 4 5 [6] 7 8 … 20 >
function renderPagination(pages) {
  pagination.hidden = pages <= 1;
  if (pages <= 1) return (pagination.innerHTML = "");
  const shown = new Set([1, pages]);
  for (let i = page - 2; i <= page + 2; i++) if (i >= 1 && i <= pages) shown.add(i);
  const list = Array.from(shown).sort((a, b) => a - b);
  let html = "";
  if (page > 1) html += `<button type="button" data-page="${page - 1}" aria-label="Anterior"><svg class="ic-sm" style="transform:scaleX(-1)"><use href="#ic-arrow_forward" /></svg></button>`;
  list.forEach((n, i) => {
    if (i > 0 && n - list[i - 1] > 1) html += `<span class="pagination-gap">…</span>`;
    html += `<button type="button" class="${n === page ? "active" : ""}" data-page="${n}" ${n === page ? 'aria-current="page"' : ""}>${n}</button>`;
  });
  if (page < pages) html += `<button type="button" data-page="${page + 1}" aria-label="Siguiente"><svg class="ic-sm"><use href="#ic-arrow_forward" /></svg></button>`;
  pagination.innerHTML = html;
}
pagination.addEventListener("click", (e) => {
  const b = e.target.closest("[data-page]");
  if (!b) return;
  page = +b.dataset.page;
  applyFilters();
  writeUrl();
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
  writeUrl();
}

// ---------- Filtros <-> URL ----------
// Los filtros viajan en la URL (sin recargar) para poder compartir o volver a
// la búsqueda: ?categoria=componentes&componentes=fuentes,gabinetes&marca=asus
// &disponibilidad=oferta&min=10000&max=50000&q=rtx&orden=menor-precio&pagina=2
// Sin filtros la URL queda limpia (/productos.html).
function writeUrl() {
  const state = readChecked();
  const params = new URLSearchParams();
  const setList = (key, values) => values.length && params.set(key, values.join(","));
  const query = searchInput ? searchInput.value.trim() : "";
  if (query) params.set("q", query);
  setList("categoria", state.categoria);
  SUBGROUPS.forEach((group) => setList(group, state[group]));
  setList("marca", state.marca);
  setList("disponibilidad", state.disponibilidad.map((label) => AVAILABILITY_PARAM[label]));
  if (priceRange.min !== null) params.set("min", priceRange.min);
  if (priceRange.max !== null) params.set("max", priceRange.max);
  if (sortSelect && sortSelect.value !== DEFAULT_SORT) params.set("orden", sortSelect.value);
  if (page > 1) params.set("pagina", page);

  const qs = params.toString().replace(/%2C/g, ",");
  const url = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
  if (url !== window.location.pathname + window.location.search + window.location.hash) {
    history.replaceState(history.state, "", url);
  }
}

function readUrl() {
  const params = new URLSearchParams(window.location.search);
  const list = (key) =>
    (params.get(key) || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  const categorias = list("categoria").map(normalize);
  const tipos = Object.fromEntries(SUBGROUPS.map((group) => [group, list(group).map(slugify)]));
  // Links viejos del menú: ?categoria=componentes&tipo=fuentes
  const legacyTipos = list("tipo").map(slugify);
  categorias.filter((c) => SUBGROUPS.includes(c)).forEach((c) => tipos[c].push(...legacyTipos));
  const disponibilidad = list("disponibilidad");

  checkboxes().forEach((input) => {
    const group = normalize(input.dataset.filterGroup);
    const label = input.dataset.filterLabel;
    if (group === "categoria") input.checked = categorias.includes(normalize(label));
    else if (SUBGROUPS.includes(group)) input.checked = tipos[group].includes(slugify(label));
    else if (group === "disponibilidad") input.checked = disponibilidad.includes(AVAILABILITY_PARAM[normalize(label)]);
  });
  pendingBrands = new Set(list("marca").map(normalize));

  const num = (key) => {
    const raw = params.get(key);
    const n = raw === null || raw === "" ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  priceRange.min = num("min");
  priceRange.max = num("max");
  if (priceMin) priceMin.value = priceRange.min ?? "";
  if (priceMax) priceMax.value = priceRange.max ?? "";

  if (searchInput) searchInput.value = params.get("q") || "";
  const orden = params.get("orden");
  if (sortSelect && orden && Array.from(sortSelect.options).some((o) => o.value === orden)) sortSelect.value = orden;
  page = Math.max(1, Math.floor(num("pagina") || 1));
}

// ---------- Precio ----------
function readPriceInputs() {
  const min = priceMin && priceMin.value !== "" ? Number(priceMin.value) : null;
  const max = priceMax && priceMax.value !== "" ? Number(priceMax.value) : null;
  priceRange.min = min !== null && !Number.isNaN(min) ? Math.round(min) : null;
  priceRange.max = max !== null && !Number.isNaN(max) ? Math.round(max) : null;
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
  pendingBrands = new Set();
  clearPrice();
  if (searchInput) searchInput.value = "";
  if (sortSelect) sortSelect.value = DEFAULT_SORT;
  update();
}
clearAllBtn.addEventListener("click", clearAll);
emptyClearBtn && emptyClearBtn.addEventListener("click", clearAll);

// ---------- Eventos ----------
checkboxes().forEach((input) => input.addEventListener("change", update));
// Búsqueda: se consulta cuando el usuario deja de tipear (no en cada tecla)
let searchTimer = null;
let lastWords = "";
searchInput &&
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const words = searchWords().join(" ");
      // Si solo cambiaron espacios o mayúsculas no hace falta consultar
      if (words !== lastWords) {
        lastWords = words;
        page = 1;
        applyFilters();
      }
      writeUrl();
    }, SEARCH_DELAY);
  });
sortSelect &&
  sortSelect.addEventListener("change", () => {
    page = 1;
    applyFilters();
    writeUrl();
  });

// Filtros preseleccionados desde la URL (menú, links del sitio o una búsqueda compartida)
readUrl();
lastWords = searchWords().join(" ");
syncSubGroups();
renderTags();

// ---------- Datos ----------
async function loadFacets() {
  facets = await fetchFacets();
  renderBrands();
  renderCounts();
  renderTags();
  // Catálogo vacío: mensaje de "todavía no hay productos" en vez de "sin coincidencias"
  if (facets && facets.total === 0) renderGrid();
}

// Primera carga: contadores y la primera página en paralelo
loading(Promise.all([loadFacets(), applyFilters()]).then(() => writeUrl()));
refreshCart(); // precio/stock del carrito (solo esos productos)

// En vivo: precio/stock de las tarjetas en pantalla sin volver a consultar.
// Si se despublica una que se está viendo, o se vuelve de otra pestaña, se
// pide de nuevo la página.
onCatalogChange((change) => {
  if (change.resync) {
    loadFacets();
    applyFilters();
    return;
  }
  const next = applyChange(rows, change);
  if (!next) return;
  if (change.removed) return applyFilters();
  rows = next;
  renderGrid();
});
