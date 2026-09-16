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

  document.querySelectorAll(".item-spn2").forEach((item) => {
    item.addEventListener("click", () => {
      const texto = item.textContent.trim();

      if (texto === "Nosotros") {
        window.location.href = "nosotros.html";
      }

      if (texto === "Contacto") {
        window.location.href = "contacto.html";
      }
    });
  });
})();
