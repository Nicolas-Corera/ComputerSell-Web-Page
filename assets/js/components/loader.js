// Loader inicial con contador (GSAP).
// Actualmente desactivado: el markup .loader-wrap está comentado en las páginas.
// Si no existe el loader, no hace nada (evita errores en consola).
(function () {
  const loaderNumber = document.getElementById("loaderNumber");
  const loaderWrap = document.querySelector(".loader-wrap");
  const site = document.getElementById("site");
  if (!loaderWrap || !loaderNumber || typeof gsap === "undefined") {
    document.body.classList.remove("is-loading");
    if (site) site.classList.add("is-visible");
    return;
  }

  const counter = { value: 0 };

  function startCounting() {
    gsap.to(counter, {
      value: 100,
      duration: 4.0,
      ease: "power3.inOut",
      onUpdate: () => {
        loaderNumber.textContent = Math.round(counter.value);
      },
      onComplete: () => {
        gsap.to(loaderWrap, {
          opacity: 0,
          duration: 0.4,
          ease: "power1.out",
          onComplete: () => {
            loaderWrap.style.display = "none";
            site.classList.add("is-visible");
            document.body.classList.remove("is-loading");
          },
        });
      },
    });
  }

  gsap.timeline({ onComplete: startCounting }).to(".loader-number", {
    opacity: 1,
    y: 0,
    duration: 0.45,
    ease: "power2.out",
  });
})();
