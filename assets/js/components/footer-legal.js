// Footer: datos de contacto y año, desde assets/js/config/legal.js. El HTML del footer (con los links legales y el
// Botón de arrepentimiento) está en cada página: esto solo completa los datos.
import { fillLegal } from "../core/legal.js";

const footer = document.querySelector(".site-footer");
if (footer) {
  fillLegal(footer);
  const year = document.getElementById("footerYear");
  if (year) year.textContent = new Date().getFullYear();
}
