// Menú de productos — compartido por todas las páginas.
// Se abre desde el ítem "Productos" del navbar (#productsMenuBtn) como un
// drawer que entra desde la izquierda. Cada categoría lleva a productos.html
// con ese filtro aplicado (?categoria=...). Componentes y Periféricos despliegan
// su lista de subcategorías (?categoria=...&tipo=...).
(function () {
  const PRODUCTS_URL = "/productos.html";

  // Categorías: deben coincidir con los data-filter-label de productos.html
  const CATEGORIES = [
    { slug: "computadoras", label: "Computadoras", hint: "PCs armadas para gaming, diseño y oficina" },
    { slug: "notebooks", label: "Notebooks", hint: "Portátiles para trabajo y juego" },
    { slug: "componentes", label: "Componentes", hint: "Placas de video, memorias, discos" },
    { slug: "perifericos", label: "Periféricos", hint: "Teclados, mouse y más" },
  ];

  // Subcategorías: deben coincidir con los data-filter-label de los subgrupos
  // de productos.html (el slug es el label normalizado, igual que data-type)
  const SUBCATEGORIES = {
    componentes: [
      { slug: "placas-de-video", label: "Placas de video" },
      { slug: "procesadores", label: "Procesadores" },
      { slug: "memorias-ram", label: "Memorias RAM" },
      { slug: "almacenamiento", label: "Almacenamiento" },
      { slug: "motherboards", label: "Motherboards" },
      { slug: "fuentes", label: "Fuentes" },
      { slug: "gabinetes", label: "Gabinetes" },
      { slug: "refrigeracion", label: "Refrigeración" },
      { slug: "otros", label: "Otros" },
    ],
    perifericos: [
      { slug: "teclados", label: "Teclados" },
      { slug: "mouse", label: "Mouse" },
      { slug: "auriculares", label: "Auriculares" },
      { slug: "monitores", label: "Monitores" },
      { slug: "microfonos", label: "Micrófonos" },
      { slug: "webcams", label: "Webcams" },
      { slug: "parlantes", label: "Parlantes" },
      { slug: "mousepads", label: "Mousepads" },
      { slug: "otros", label: "Otros" },
    ],
  };

  const ICON_CLOSE =
    '<svg viewBox="0 -960 960 960"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>';
  const ICON_ARROW =
    '<svg class="menuItem-arrow" viewBox="0 -960 960 960"><path d="M647-440H160v-80h487L423-744l57-56 320 320-320 320-57-56 224-224Z"/></svg>';
  const ICON_EXPAND =
    '<svg class="menuItem-arrow" viewBox="0 -960 960 960"><path d="M480-344 240-584l56-56 184 184 184-184 56 56-240 240Z"/></svg>';
  const ICONS = {
    computadoras:
      '<svg viewBox="0 -960 960 960"><path d="M320-120v-80h80v-80H160q-33 0-56.5-23.5T80-360v-400q0-33 23.5-56.5T160-840h640q33 0 56.5 23.5T880-760v400q0 33-23.5 56.5T800-280H560v80h80v80H320ZM160-360h640v-400H160v400Zm0 0v-400 400Z"/></svg>',
    notebooks:
      '<svg viewBox="0 -960 960 960"><path d="M80-160v-80h80v-440q0-33 23.5-56.5T240-760h600v80H240v440h640v80H80Zm520-240v-320h200v320H600Z"/></svg>',
    componentes:
      '<svg viewBox="0 -960 960 960"><path d="M360-360v-240h240v240H360Zm80-80h80v-80h-80v80Zm-80 320v-80h-80q-33 0-56.5-23.5T200-280v-80h-80v-80h80v-80h-80v-80h80v-80q0-33 23.5-56.5T280-760h80v-80h80v80h80v-80h80v80h80q33 0 56.5 23.5T760-680v80h80v80h-80v80h80v80h-80v80q0 33-23.5 56.5T680-200h-80v80h-80v-80h-80v80h-80Zm320-160v-400H280v400h400Z"/></svg>',
    perifericos:
      '<svg viewBox="0 -960 960 960"><path d="M440-80q-116 0-198-82t-82-198v-240q0-116 82-198t198-82h80q116 0 198 82t82 198v240q0 116-82 198t-198 82h-80Zm0-80h80q83 0 141.5-58.5T720-360v-240q0-83-58.5-141.5T520-800h-80q-83 0-141.5 58.5T240-600v240q0 83 58.5 141.5T440-160Zm0-400h80v-160h-80v160Zm40 120Z"/></svg>',
  };

  const btn = document.getElementById("productsMenuBtn");
  const navToggle = document.getElementById("navToggle");
  if (!btn && !navToggle) return;

  // Links del navbar que en móvil/tablet (< 992px) viven dentro del drawer
  const NAV_LINKS = [
    { label: "Inicio", href: "/" },
    { label: "Nosotros", href: "/nosotros.html" },
    { label: "Contacto", href: "/contacto.html" },
  ];

  // ---------- Drawer ----------
  const overlay = document.createElement("div");
  overlay.className = "menuOverlay";

  const drawer = document.createElement("aside");
  drawer.className = "menuDrawer";
  drawer.setAttribute("aria-label", "Menú de productos");
  drawer.innerHTML = `
    <div class="menuDrawer-head">
      <h2>Productos</h2>
      <button type="button" class="menuDrawer-close" aria-label="Cerrar menú">${ICON_CLOSE}</button>
    </div>
    <ul class="menuDrawer-list">
      <li class="menuDrawer-label">Categorías</li>
      ${CATEGORIES.map((c) => {
        const subs = SUBCATEGORIES[c.slug];
        const hasSubs = Array.isArray(subs) && subs.length > 0;
        return `
        <li>
          <button
            type="button"
            class="menuItem${hasSubs ? " menuItem--toggle" : ""}"
            data-slug="${c.slug}"
            ${hasSubs ? 'aria-expanded="false"' : ""}
          >
            <span class="menuItem-icon">${ICONS[c.slug] || ""}</span>
            <span class="menuItem-body">
              <strong>${c.label}</strong>
              <small>${c.hint}</small>
            </span>
            ${hasSubs ? ICON_EXPAND : ICON_ARROW}
          </button>
          ${
            hasSubs
              ? `
          <ul class="menuSub" hidden>
            <li>
              <button type="button" class="menuSub-item menuSub-item--all" data-slug="${c.slug}">
                Ver todos los ${c.label.toLowerCase()}
              </button>
            </li>
            ${subs
              .map(
                (sc) => `
            <li>
              <button type="button" class="menuSub-item" data-slug="${c.slug}" data-type="${sc.slug}">
                ${sc.label}
              </button>
            </li>`,
              )
              .join("")}
          </ul>`
              : ""
          }
        </li>`;
      }).join("")}
    </ul>
    <ul class="menuDrawer-list menuDrawer-nav">
      <li class="menuDrawer-label">Navegación</li>
      ${NAV_LINKS.map(
        (l) => `<li><a class="menuNav-link" href="${l.href}">${l.label}</a></li>`,
      ).join("")}
    </ul>
    <div class="menuDrawer-foot">
      <button type="button" class="menuDrawer-all" id="menuAllProducts">Ver todos los productos</button>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  // Arranca colapsado sin animar: se desactiva la transición hasta después del
  // primer render, así no "entra y sale" al cargar la página. El timeout cubre
  // pestañas en segundo plano (donde requestAnimationFrame no corre).
  drawer.style.transition = "none";
  drawer.style.visibility = "hidden";
  function unlockDrawer() {
    drawer.style.transition = "";
    drawer.style.visibility = "";
  }
  requestAnimationFrame(() => requestAnimationFrame(unlockDrawer));
  setTimeout(unlockDrawer, 500);

  function openMenu() {
    unlockDrawer();
    // Un solo drawer abierto a la vez
    document.body.classList.remove("cart-open");
    document.body.classList.add("menu-open");
  }

  function closeMenu() {
    document.body.classList.remove("menu-open");
  }

  if (btn) btn.addEventListener("click", openMenu);
  if (navToggle) navToggle.addEventListener("click", openMenu);
  drawer.querySelector(".menuDrawer-close").addEventListener("click", closeMenu);
  overlay.addEventListener("click", closeMenu);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });

  // Categoría -> productos con ese filtro
  drawer.querySelectorAll(".menuItem:not(.menuItem--toggle)").forEach((item) => {
    item.addEventListener("click", () => {
      window.location.href = `${PRODUCTS_URL}?categoria=${item.dataset.slug}`;
    });
  });

  // Categoría con subcategorías -> despliega/colapsa su lista (solo una abierta a la vez)
  drawer.querySelectorAll(".menuItem--toggle").forEach((item) => {
    item.addEventListener("click", () => {
      const sub = item.nextElementSibling;
      const willOpen = sub.hidden;
      drawer.querySelectorAll(".menuItem--toggle").forEach((other) => {
        other.classList.remove("is-open");
        other.setAttribute("aria-expanded", "false");
        other.nextElementSibling.hidden = true;
      });
      if (willOpen) {
        item.classList.add("is-open");
        item.setAttribute("aria-expanded", "true");
        sub.hidden = false;
      }
    });
  });

  // Subcategoría -> productos con categoría + tipo ("Ver todos" solo categoría)
  drawer.querySelectorAll(".menuSub-item").forEach((item) => {
    item.addEventListener("click", () => {
      const { slug, type } = item.dataset;
      const query = type ? `?categoria=${slug}&tipo=${type}` : `?categoria=${slug}`;
      window.location.href = `${PRODUCTS_URL}${query}`;
    });
  });

  drawer.querySelector("#menuAllProducts").addEventListener("click", () => {
    window.location.href = PRODUCTS_URL;
  });
})();
