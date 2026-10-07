// Aplica el tema guardado antes del primer render para evitar el "flash".
// Va en un archivo (no inline en el HTML) por la Content Security Policy.
(function () {
  try {
    var t = localStorage.getItem("cs_admin_theme") || "dark";
    if (t === "system") {
      t = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    document.documentElement.dataset.theme = t;
  } catch (e) {}
})();
