// Inicio: "PCs Destacadas" (productos marcados como destacados) y el carrusel
// de hardware (componentes). Todo desde la base, en tiempo real.
import { createCatalog } from "../core/catalog.js";
import { toCard } from "../core/supabase.js";

const { cardHtml } = window.CS;
const featuredEl = document.getElementById("homeFeatured");
const hardwareEl = document.getElementById("carouselHardware");

const EMPTY = (t) => `<p style="grid-column:1/-1;color:var(--ink-soft);font-size:15px;margin:0">${t}</p>`;

function render(cat) {
  let featured = cat.featured();
  if (!featured.length) featured = cat.all().filter((p) => p.category === "computadoras");
  featured = featured.slice(0, 8);
  featuredEl.innerHTML = featured.length
    ? featured.map((p) => cardHtml(toCard(p))).join("")
    : EMPTY("Todavía no hay productos destacados. Cargalos desde el panel.");

  let hardware = cat.byCategory("componentes");
  if (!hardware.length) hardware = cat.all().filter((p) => p.category !== "computadoras");
  hardware = hardware.slice(0, 12);
  hardwareEl.innerHTML = hardware.length
    ? hardware.map((p) => cardHtml(toCard(p))).join("")
    : EMPTY("Pronto vas a ver acá componentes y periféricos.");
  if (hardware.length && typeof setupCarousel === "function") setupCarousel("carouselHardware");

  if (window.syncFavorites) window.syncFavorites();
}

const catalog = createCatalog();
catalog.onChange(render);
