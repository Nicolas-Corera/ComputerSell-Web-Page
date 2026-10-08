// Inicio: "PCs Destacadas" (productos marcados como destacados) y hardware
// (componentes); cada sección pasa a carrusel cuando tiene suficientes tarjetas. Se piden solo las tarjetas que se muestran
// (8 + 12) y se actualizan en vivo (precio, stock).
import { fetchCards, onCatalogChange, applyChange, refreshCart } from "../core/catalog.js";
import { toCard, loading } from "../core/supabase.js";

const { cardHtml, emptyHtml } = window.CS;
const featuredEl = document.getElementById("homeFeatured");
const hardwareEl = document.getElementById("carouselHardware");

const newest = (q) => q.order("created_at", { ascending: false });
let featured = [];
let hardware = [];

async function load() {
  // Con respaldo: sin destacados se muestran PCs; sin componentes, cualquier otro hardware
  const [feat, hard] = await Promise.all([
    fetchCards((q) => newest(q.eq("featured", true)).limit(8)).then((r) => r.length ? r : fetchCards((q) => newest(q.eq("category", "computadoras")).limit(8))),
    fetchCards((q) => newest(q.eq("category", "componentes")).limit(12)).then((r) => r.length ? r : fetchCards((q) => newest(q.neq("category", "computadoras")).limit(12))),
  ]);
  featured = feat;
  hardware = hard;
  render();
}

function render() {
  featuredEl.innerHTML = featured.length
    ? featured.map((p) => cardHtml(toCard(p))).join("")
    : emptyHtml("Todavía no hay equipos destacados", "Estamos preparando nuestra selección de PCs armadas. Muy pronto vas a verlas acá.", { icon: "ic-info" });

  hardwareEl.innerHTML = hardware.length
    ? hardware.map((p) => cardHtml(toCard(p))).join("")
    : emptyHtml("Sin productos de hardware por ahora", "Componentes y periféricos van a aparecer acá apenas los publiquemos.", { icon: "ic-info" });
  // Grilla o carrusel según cuántas tarjetas hay (carousel.js)
  if (typeof setupCarousel === "function") {
    setupCarousel("homeFeatured");
    setupCarousel("carouselHardware");
  }

  if (window.syncFavorites) window.syncFavorites();
}

// Banner de campaña con vigencia (data-until): vencido, no se muestra
const promo = document.getElementById("promoBanner");
if (promo && promo.dataset.until && Date.now() >= Date.parse(promo.dataset.until)) promo.remove();

loading(load());
refreshCart(); // precio/stock del carrito (solo esos productos)

onCatalogChange((change) => {
  if (change.resync) return load();
  // Un producto nuevo destacado entra en la próxima visita; lo visible se actualiza ya
  const f = applyChange(featured, change);
  const h = applyChange(hardware, change);
  if (!f && !h) return;
  if (f) featured = f;
  if (h) hardware = h;
  // Si una sección quedó vacía por un despublicado, se vuelve a pedir (respaldo)
  if (change.removed && (!featured.length || !hardware.length)) return load();
  render();
});
