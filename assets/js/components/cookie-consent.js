// Banner y configuración de cookies (sin dependencias).
//
// Guarda la elección en localStorage ("cs-cookie-consent") con fecha y versión
// de la Política de cookies (LEGAL.versionCookies). Vuelve a preguntar si la
// versión cambia o si pasaron CONSENT_MONTHS meses.
//
// Hoy el sitio solo usa almacenamiento esencial: las categorías opcionales
// están listas para cuando se sumen herramientas. Para cargar algo solo con
// consentimiento:
//
//   1. Declarativo (el script no corre hasta que se acepta la categoría):
//      <script type="text/plain" data-consent="analiticas" data-src="https://…"></script>
//      <script type="text/plain" data-consent="analiticas">/* código inline */</script>
//
//   2. Desde JS:
//      CookieConsent.onConsent("analiticas", () => { … });
//      CookieConsent.loadScript("analiticas", "https://…");
//
// Si alguien retira una categoría que ya había cargado scripts, la página se
// recarga para que dejen de correr (no se pueden "descargar").
//
// Cualquier elemento con [data-cookie-settings] abre la configuración
// (link "Configurar cookies" del footer y de /cookies).
import { LEGAL } from "../config/legal.js";

const STORAGE_KEY = "cs-cookie-consent";
const CONSENT_MONTHS = 12; // vigencia del consentimiento
const VERSION = LEGAL.versionCookies;

const CATEGORIES = [
  {
    id: "necesarias",
    title: "Estrictamente necesarias",
    desc: "Mantienen tu sesión, el carrito y tu elección de cookies, y permiten pagar con Mercado Pago de forma segura. No se pueden desactivar.",
    locked: true,
  },
  {
    id: "funcionales",
    title: "Funcionales",
    desc: "Recuerdan preferencias para mejorar tu experiencia. Hoy no usamos ninguna.",
  },
  {
    id: "analiticas",
    title: "Analíticas",
    desc: "Nos ayudan a entender cómo se usa el sitio para mejorarlo. Hoy no usamos ninguna.",
  },
  {
    id: "publicidad",
    title: "Publicidad",
    desc: "Permiten mostrarte anuncios relevantes en otros sitios. Hoy no usamos ninguna.",
  },
];
const OPTIONAL = CATEGORIES.filter((c) => !c.locked).map((c) => c.id);

// ---------- Estado ----------
function read() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || saved.version !== VERSION || !saved.date) return null;
    const expires = new Date(saved.date);
    expires.setMonth(expires.getMonth() + CONSENT_MONTHS);
    return expires > new Date() ? saved : null;
  } catch (e) {
    return null;
  }
}

function write(categories) {
  const record = { version: VERSION, date: new Date().toISOString(), categories: { necesarias: true, ...categories } };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch (e) {
    /* sin storage: la elección vale solo para esta visita */
  }
  return record;
}

let consent = read();
const granted = (id) => id === "necesarias" || !!(consent && consent.categories[id]);

// ---------- Carga condicionada ----------
const callbacks = {}; // categoría -> [fn]
const ran = new Set(); // categorías que ya ejecutaron algo en esta página

function run(id) {
  if (!granted(id)) return;
  (callbacks[id] || []).splice(0).forEach((fn) => {
    ran.add(id);
    try {
      fn(id);
    } catch (e) {
      console.error("[cookies]", e);
    }
  });
  document.querySelectorAll(`script[type="text/plain"][data-consent="${id}"]`).forEach((old) => {
    ran.add(id);
    const s = document.createElement("script");
    [...old.attributes].forEach((a) => {
      if (!["type", "data-consent", "data-src"].includes(a.name)) s.setAttribute(a.name, a.value);
    });
    if (old.dataset.src) s.src = old.dataset.src;
    else s.textContent = old.textContent;
    old.replaceWith(s);
  });
}

function onConsent(id, fn) {
  (callbacks[id] = callbacks[id] || []).push(fn);
  run(id);
}

function loadScript(id, src, attrs = {}) {
  onConsent(id, () => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    Object.entries(attrs).forEach(([k, v]) => s.setAttribute(k, v));
    document.head.appendChild(s);
  });
}

function save(categories) {
  const revoked = OPTIONAL.filter((id) => granted(id) && !categories[id]);
  consent = write(categories);
  hideBanner();
  document.dispatchEvent(new CustomEvent("cookieconsent:change", { detail: consent }));
  if (revoked.some((id) => ran.has(id))) return location.reload();
  OPTIONAL.forEach(run);
}

const acceptAll = () => save(Object.fromEntries(OPTIONAL.map((id) => [id, true])));
const rejectAll = () => save(Object.fromEntries(OPTIONAL.map((id) => [id, false])));

// ---------- UI ----------
let banner = null;
let dialog = null;
let lastFocus = null;

function buildBanner() {
  banner = document.createElement("section");
  banner.className = "cc-banner";
  banner.setAttribute("aria-label", "Aviso de cookies");
  banner.setAttribute("aria-describedby", "ccBannerText");
  banner.innerHTML = `
    <div class="cc-banner-inner">
      <div class="cc-banner-copy">
        <h2 class="cc-title">Usamos cookies</h2>
        <p id="ccBannerText">
          Usamos cookies y almacenamiento local necesarios para que el sitio funcione (sesión, carrito y pagos).
          Si sumamos cookies opcionales, solo las vamos a usar con tu consentimiento.
          <a href="/cookies">Política de cookies</a>
        </p>
      </div>
      <div class="cc-actions">
        <button type="button" class="cc-btn" data-cc="settings">Configurar</button>
        <button type="button" class="cc-btn cc-btn-primary" data-cc="reject">Rechazar no esenciales</button>
        <button type="button" class="cc-btn cc-btn-primary" data-cc="accept">Aceptar todas</button>
      </div>
    </div>`;
  banner.addEventListener("click", (e) => {
    const action = e.target.closest("[data-cc]")?.dataset.cc;
    if (action === "accept") acceptAll();
    if (action === "reject") rejectAll();
    if (action === "settings") openSettings();
  });
  // Primero en el orden de tabulación, aunque se vea abajo
  document.body.prepend(banner);

  // Deja lugar abajo para que el banner no tape botones (pagar, iniciar sesión)
  const pad = () => document.body.style.setProperty("--cc-banner-h", banner.offsetHeight + "px");
  if ("ResizeObserver" in window) new ResizeObserver(pad).observe(banner);
  pad();
  document.body.classList.add("has-cc-banner");
}

function hideBanner() {
  if (!banner) return;
  banner.remove();
  banner = null;
  document.body.classList.remove("has-cc-banner");
  document.body.style.removeProperty("--cc-banner-h");
}

function buildDialog() {
  dialog = document.createElement("dialog");
  dialog.className = "cc-dialog";
  dialog.setAttribute("aria-labelledby", "ccDialogTitle");
  dialog.setAttribute("aria-describedby", "ccDialogDesc");
  dialog.innerHTML = `
    <form method="dialog" class="cc-dialog-form">
      <header class="cc-dialog-head">
        <h2 id="ccDialogTitle" class="cc-title">Configurar cookies</h2>
        <button type="button" class="cc-close" data-cc="close" aria-label="Cerrar">×</button>
      </header>
      <p id="ccDialogDesc" class="cc-dialog-desc">
        Elegí qué categorías permitís. Podés cambiar tu elección cuando quieras desde
        “Configurar cookies”, en el pie de página. Más detalle en la <a href="/cookies">Política de cookies</a>.
      </p>
      <ul class="cc-cats">
        ${CATEGORIES.map(
          (c) => `
          <li class="cc-cat">
            <div class="cc-cat-text">
              <label class="cc-cat-title" for="cc-${c.id}">${c.title}</label>
              <p id="cc-${c.id}-desc">${c.desc}</p>
            </div>
            <input type="checkbox" role="switch" class="cc-switch" id="cc-${c.id}" name="${c.id}"
              aria-describedby="cc-${c.id}-desc" ${c.locked ? "checked disabled" : ""} />
          </li>`,
        ).join("")}
      </ul>
      <footer class="cc-dialog-actions">
        <button type="button" class="cc-btn cc-btn-primary" data-cc="reject">Rechazar no esenciales</button>
        <button type="button" class="cc-btn" data-cc="save">Guardar selección</button>
        <button type="button" class="cc-btn cc-btn-primary" data-cc="accept">Aceptar todas</button>
      </footer>
    </form>`;
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) return closeSettings(); // clic en el fondo
    const action = e.target.closest("[data-cc]")?.dataset.cc;
    if (!action) return;
    if (action === "close") return closeSettings();
    if (action === "accept") acceptAll();
    if (action === "reject") rejectAll();
    if (action === "save") save(Object.fromEntries(OPTIONAL.map((id) => [id, dialog.querySelector(`#cc-${id}`).checked])));
    closeSettings();
  });
  dialog.addEventListener("close", () => lastFocus && lastFocus.focus && lastFocus.focus());
  document.body.appendChild(dialog);
}

function openSettings() {
  lastFocus = document.activeElement;
  if (!dialog) buildDialog();
  OPTIONAL.forEach((id) => (dialog.querySelector(`#cc-${id}`).checked = granted(id)));
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  dialog.querySelector(".cc-switch:not([disabled])").focus();
}

function closeSettings() {
  if (!dialog) return;
  if (typeof dialog.close === "function" && dialog.open) dialog.close();
  else dialog.removeAttribute("open");
}

// ---------- Inicio ----------
document.addEventListener("click", (e) => {
  const opener = e.target.closest("[data-cookie-settings]");
  if (!opener) return;
  e.preventDefault();
  openSettings();
});

window.CookieConsent = {
  get: () => consent,
  has: granted,
  onConsent,
  loadScript,
  open: openSettings,
  categories: CATEGORIES.map((c) => c.id),
};

if (consent) OPTIONAL.forEach(run);
else {
  // Espera a que el skeleton de carga se vaya (loader.js) para no taparlo
  const ready = (window.PageLoader && window.PageLoader.ready) || Promise.resolve();
  ready.then(() => !consent && !banner && buildBanner());
}
