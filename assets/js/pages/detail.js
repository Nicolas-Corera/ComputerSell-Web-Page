// Página de detalle: galería, selector de cantidad, tabs y chips de variantes.

function setMainImage(el, src) {
  document.getElementById("mainImage").src = src;
  document
    .querySelectorAll(".thumb")
    .forEach((t) => t.classList.remove("is-active"));
  el.classList.add("is-active");
}

// La cantidad real vive en data-qty; el input muestra "99+" a partir de 100
function changeQty(delta) {
  const input = document.getElementById("qtyInput");
  const current = parseInt(input.dataset.qty || input.value, 10) || 1;
  const next = Math.max(1, current + delta);
  input.dataset.qty = next;
  input.value = next > 99 ? "99+" : next;
}

function switchTab(btn, panelId) {
  document
    .querySelectorAll(".tab-btn")
    .forEach((b) => b.classList.remove("is-active"));
  document
    .querySelectorAll(".tab-panel")
    .forEach((p) => p.classList.remove("is-active"));
  btn.classList.add("is-active");
  document.getElementById(panelId).classList.add("is-active");
}

document.querySelectorAll(".chip-row").forEach((row) => {
  row.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      row
        .querySelectorAll(".chip")
        .forEach((c) => c.classList.remove("is-selected"));
      chip.classList.add("is-selected");
    });
  });
});
