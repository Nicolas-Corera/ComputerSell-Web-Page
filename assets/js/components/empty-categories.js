// Oculta las categorías y subcategorías sin productos publicados en el menú,
// el navbar y el footer de todas las páginas (y en los filtros del listado),
// para no ofrecer secciones vacías. Los contadores salen de catalog_facets
// (cacheados por catalog.js). Se hace con una regla CSS, así también cubre lo
// que el menú dibuja después.
import { fetchFacets } from "../core/catalog.js";

const CATEGORIES = ["computadoras", "notebooks", "tablets", "celulares", "componentes", "perifericos"];
// Slugs de subcategorías (mismos que menu.js y productos.html)
const SUBCATEGORIES = {
  componentes: ["placas-de-video", "procesadores", "memorias-ram", "almacenamiento", "motherboards", "fuentes", "gabinetes", "refrigeracion", "otros"],
  perifericos: ["teclados", "mouse", "auriculares", "monitores", "microfonos", "parlantes", "webcams", "mousepads", "otros"],
};

fetchFacets().then((facets) => {
  if (!facets || !facets.total) return; // catálogo vacío o sin datos: no se oculta nada
  const cats = facets.categories || {};
  const subs = facets.subcategories || {};
  const hide = [];
  CATEGORIES.filter((slug) => !cats[slug]).forEach((slug) => {
    hide.push(
      `li:has(> a[href*="categoria=${slug}"])`,
      `li:has(> [data-href*="categoria=${slug}"])`,
      `li:has(> .menuItem[data-slug="${slug}"])`,
    );
  });
  Object.entries(SUBCATEGORIES).forEach(([group, list]) => {
    if (!cats[group]) return; // la categoría entera ya está oculta
    list
      .filter((slug) => !subs[`${group}/${slug}`])
      .forEach((slug) => hide.push(`li:has(> .menuSub-item[data-slug="${group}"][data-type="${slug}"])`, `li:has(> a[href*="${group}=${slug}"])`));
  });
  if (!hide.length) return;
  const style = document.createElement("style");
  style.id = "csEmptyCategories";
  style.textContent = `${hide.join(",\n")} { display: none !important; }`;
  document.head.appendChild(style);
});
