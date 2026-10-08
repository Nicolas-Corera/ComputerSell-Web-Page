// Navbar sticky: en el inicio arranca transparente sobre el hero y se
// "pega" (fondo oscuro) al scrollear. En páginas sin hero queda pegada siempre.
(function () {
  const navbar = document.getElementById("navbar");
  if (!navbar) return;
  const hero = document.getElementById("hero");

  if (hero) {
    const io = new IntersectionObserver(
      ([entry]) => {
        navbar.classList.toggle("stuck", !entry.isIntersecting);
      },
      { threshold: 0, rootMargin: "-1px 0px 0px 0px" },
    );
    io.observe(hero);
  } else {
    navbar.classList.add("stuck");
  }

  // Nosotros y Contacto: mismo mecanismo que el resto de los ítems (data-href)
  const LINKS = { Nosotros: "/nosotros", Contacto: "/contacto" };
  navbar.querySelectorAll(".listItems > li").forEach((li) => {
    const text = li.textContent.trim();
    if (!li.dataset.href && LINKS[text]) li.dataset.href = LINKS[text];
  });

  // Accesibilidad: los ítems del navbar son <li>/<div> con click. Se los hace
  // alcanzables con Tab y activables con Enter o Espacio, y se anuncian como
  // enlace o botón con un nombre (los íconos no tienen texto visible en mobile).
  const NAMES = { favBtn: "Favoritos", accountBtn: "Mi cuenta", cartBtn: "Carrito", navToggle: "Abrir menú", productsMenuBtn: "Menú de productos" };
  const items = navbar.querySelectorAll(".logo, .listItems > li, .actionIcons > li");
  items.forEach((el) => {
    if (!el.hasAttribute("tabindex") || el.tabIndex < 0) el.tabIndex = 0;
    el.setAttribute("role", el.dataset.href ? "link" : "button");
    if (el.classList.contains("logo")) el.setAttribute("aria-label", "ComputerSell, ir al inicio");
    else if (NAMES[el.id]) el.setAttribute("aria-label", el.getAttribute("aria-label") || NAMES[el.id]);
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      el.click();
    });
  });
  // La lista del navbar se anuncia como navegación con sus ítems
  navbar.querySelectorAll(".listItems, .actionIcons").forEach((list) => list.setAttribute("role", "list"));
})();
