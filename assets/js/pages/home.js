// Inicio: "PCs Destacadas" (productos marcados como destacados) y el carrusel
// de hardware (componentes). Todo desde la base, en tiempo real.
import { createCatalog } from "../core/catalog.js";
import { toCard } from "../core/supabase.js";

const { cardHtml, emptyHtml } = window.CS;
const featuredEl = document.getElementById("homeFeatured");
const hardwareEl = document.getElementById("carouselHardware");

function render(cat) {
  let featured = cat.featured();
  if (!featured.length) featured = cat.all().filter((p) => p.category === "computadoras");
  featured = featured.slice(0, 8);
  featuredEl.innerHTML = featured.length
    ? featured.map((p) => cardHtml(toCard(p))).join("")
    : emptyHtml("Todavía no hay equipos destacados", "Estamos preparando nuestra selección de PCs armadas. Muy pronto vas a verlas acá.", { icon: "ic-info" });

  let hardware = cat.byCategory("componentes");
  if (!hardware.length) hardware = cat.all().filter((p) => p.category !== "computadoras");
  hardware = hardware.slice(0, 12);
  hardwareEl.innerHTML = hardware.length
    ? hardware.map((p) => cardHtml(toCard(p))).join("")
    : emptyHtml("Sin productos de hardware por ahora", "Componentes y periféricos van a aparecer acá apenas los publiquemos.", { icon: "ic-info" });
  hardwareEl.closest(".carouselWrap").classList.toggle("is-empty", !hardware.length);
  if (hardware.length && typeof setupCarousel === "function") setupCarousel("carouselHardware");

  if (window.syncFavorites) window.syncFavorites();
}

const catalog = createCatalog();
catalog.onChange(render);
