// Carrusel horizontal de tarjetas con flechas que se ocultan en los extremos.
// Uso: setupCarousel("idDelContenedor") — las flechas se buscan en el .carouselWrap padre.
// Los botones de flecha llaman a scrollCarousel(id, ±1).

function scrollCarousel(id, dir) {
  if (window.__carouselNav && window.__carouselNav[id]) {
    window.__carouselNav[id](dir);
    return;
  }
  const el = document.getElementById(id);
  const card = el.querySelector(":scope > *");
  const gap = 20;
  const amount = card.getBoundingClientRect().width + gap;
  el.scrollBy({ left: dir * amount, behavior: "smooth" });
}

function setupCarousel(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const wrap = el.closest(".carouselWrap");
  const prevBtn = wrap ? wrap.querySelector(".carousel-arrow--prev") : null;
  const nextBtn = wrap ? wrap.querySelector(".carousel-arrow--next") : null;
  const gap = 20;
  const minCardWidth = 350;

  function computeVisibleColumns() {
    const containerWidth = el.getBoundingClientRect().width;
    // misma lógica que auto-fill minmax(350px, 1fr): cuántas columnas de 350+gap entran
    return Math.max(
      1,
      Math.floor((containerWidth + gap) / (minCardWidth + gap)),
    );
  }

  function applyCardWidths() {
    const cols = computeVisibleColumns();
    const containerWidth = el.getBoundingClientRect().width;
    const width = (containerWidth - gap * (cols - 1)) / cols;
    Array.from(el.children).forEach((card) => {
      card.style.width = width + "px";
    });
    return width;
  }

  function cardWidth() {
    return el.children[0].getBoundingClientRect().width + gap;
  }

  function updateArrows() {
    if (!prevBtn || !nextBtn) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    prevBtn.style.display = el.scrollLeft <= 2 ? "none" : "flex";
    nextBtn.style.display = el.scrollLeft >= maxScroll - 2 ? "none" : "flex";
  }

  applyCardWidths();
  el.scrollLeft = 0; // siempre arranca desde el inicio
  updateArrows();

  el.addEventListener("scroll", updateArrows);

  window.addEventListener("resize", () => {
    el.style.scrollBehavior = "auto";
    const cwBefore = cardWidth();
    const idx = Math.round(el.scrollLeft / cwBefore);
    applyCardWidths();
    const cwAfter = cardWidth();
    el.scrollLeft = idx * cwAfter;
    el.style.scrollBehavior = "smooth";
    updateArrows();
  });
}

document.querySelectorAll(".listCarousel[id]").forEach((el) => {
  setupCarousel(el.id);
});
