// Carrusel horizontal de tarjetas que se desplaza de a una.
// Una lista .listDestacados[data-carousel] es grilla hasta que tiene suficientes
// tarjetas: desde data-carousel-min (5 por defecto) en escritorio y desde 2 en
// mobile, donde se desliza con el dedo y no hay flechas. Las flechas se buscan en
// el .carouselWrap padre, llaman a scrollCarousel(id, ±1) y se ocultan en los extremos.
// Después de cambiar las tarjetas: setupCarousel("idDelContenedor").

const CAROUSEL_GAP = 20;
const CAROUSEL_MIN_CARD = 350;
const CAROUSEL_MOBILE_MIN = 2;
const carouselMobile = window.matchMedia("(max-width: 767.98px)");

function scrollCarousel(id, dir) {
  const el = document.getElementById(id);
  const card = el && el.querySelector(":scope > .itemDestacado");
  if (!card) return;
  el.scrollBy({ left: dir * (card.getBoundingClientRect().width + CAROUSEL_GAP), behavior: "smooth" });
}

function setupCarousel(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!el._carousel) el._carousel = createCarousel(el);
  el._carousel.refresh();
}

function createCarousel(el) {
  const wrap = el.closest(".carouselWrap");
  const prevBtn = wrap ? wrap.querySelector(".carousel-arrow--prev") : null;
  const nextBtn = wrap ? wrap.querySelector(".carousel-arrow--next") : null;
  let active = false;

  const cards = () => Array.from(el.querySelectorAll(":scope > .itemDestacado"));

  function cardWidth() {
    const w = el.clientWidth;
    // Tarjetas enteras, misma lógica que auto-fill minmax(350px, 1fr) de la grilla
    // (en mobile queda 1 sola, o 2 si el ancho da)
    const cols = Math.max(1, Math.floor((w + CAROUSEL_GAP) / (CAROUSEL_MIN_CARD + CAROUSEL_GAP)));
    return (w - CAROUSEL_GAP * (cols - 1)) / cols;
  }

  function updateArrows() {
    if (!prevBtn || !nextBtn) return;
    const max = el.scrollWidth - el.clientWidth;
    prevBtn.classList.toggle("is-hidden", el.scrollLeft <= 2);
    nextBtn.classList.toggle("is-hidden", el.scrollLeft >= max - 2);
  }

  function refresh() {
    const list = cards();
    // Se conserva la tarjeta que se estaba viendo (resize, precios en vivo)
    const step = active && list[0] ? list[0].getBoundingClientRect().width + CAROUSEL_GAP : 0;
    const idx = step ? Math.round(el.scrollLeft / step) : 0;

    const min = carouselMobile.matches ? CAROUSEL_MOBILE_MIN : +el.dataset.carouselMin || 5;
    active = list.length >= min;
    el.classList.toggle("listCarousel", active);
    if (wrap) wrap.classList.toggle("is-carousel", active);
    const w = active ? cardWidth() : 0;
    list.forEach((card) => (card.style.width = active ? `${w}px` : ""));

    el.style.scrollBehavior = "auto";
    el.scrollLeft = active ? idx * (w + CAROUSEL_GAP) : 0;
    el.style.scrollBehavior = "";
    updateArrows();
  }

  el.addEventListener("scroll", updateArrows, { passive: true });
  window.addEventListener("resize", refresh);
  return { refresh };
}

document.querySelectorAll(".listDestacados[data-carousel][id]").forEach((el) => {
  setupCarousel(el.id);
});
