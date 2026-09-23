// Inyecta los datos de LEGAL (assets/js/config/legal.js) en el HTML.
//
//   <span data-legal="nombreFantasia"></span>           -> texto
//   <a data-legal="emailContacto" data-legal-link="email"> -> texto + href (email | tel | whatsapp | url)
//   <a data-legal-href="sitioWeb">…</a>                 -> solo el href (el texto queda)
//   <div data-legal-if="whatsapp">…</div>               -> se oculta si el dato es null o vacío
//   <p data-legal-unless="whatsapp">…</p>               -> al revés: solo se ve si el dato falta
//
// Las fechas AAAA-MM-DD se muestran largas ("23 de septiembre de 2026").
// Los datos pendientes quedan resaltados (.legal-pending) y se listan en consola.
import { LEGAL, isPendiente } from "../config/legal.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HREF = {
  email: (v) => "mailto:" + v,
  tel: (v) => "tel:" + v.replace(/[^\d+]/g, ""),
  whatsapp: (v) => "https://wa.me/" + v.replace(/\D/g, ""),
  url: (v) => v,
};

const empty = (v) => v == null || v === "";

export function formatDate(iso) {
  if (!ISO_DATE.test(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
}

const reported = new Set();
let pendingKeys;

function markPending(el, key) {
  el.classList.add("legal-pending");
  el.title = `Dato pendiente: completar "${key}" en assets/js/config/legal.js`;
  if (!reported.has(key)) pendingKeys.add(key);
  reported.add(key);
}

export function fillLegal(root = document) {
  pendingKeys = new Set();
  root.querySelectorAll("[data-legal-if]").forEach((el) => {
    el.hidden = empty(LEGAL[el.dataset.legalIf]);
  });
  root.querySelectorAll("[data-legal-unless]").forEach((el) => {
    el.hidden = !empty(LEGAL[el.dataset.legalUnless]);
  });

  root.querySelectorAll("[data-legal]").forEach((el) => {
    const key = el.dataset.legal;
    const value = LEGAL[key];
    if (!(key in LEGAL)) return console.warn(`[legal] data-legal="${key}" no existe en LEGAL`);
    if (empty(value)) return;
    el.textContent = ISO_DATE.test(value) ? formatDate(value) : value;
    if (el.tagName === "TIME" && ISO_DATE.test(value)) el.dateTime = value;
    if (isPendiente(value)) return markPending(el, key);
    const type = el.dataset.legalLink;
    if (type && HREF[type]) el.href = HREF[type](value);
  });

  root.querySelectorAll("[data-legal-href]").forEach((el) => {
    const key = el.dataset.legalHref;
    const value = LEGAL[key];
    if (isPendiente(value)) markPending(el, key);
    else if (!empty(value)) el.href = value;
  });

  if (pendingKeys.size) console.warn("[legal] Datos pendientes en assets/js/config/legal.js:", [...pendingKeys].join(", "));
}
