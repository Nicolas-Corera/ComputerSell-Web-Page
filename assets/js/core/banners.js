// Imágenes y banners de la tienda controlados desde el panel
// (Tienda -> Imágenes y banners, tabla public.store_banners).
//
// Cada lugar del HTML es un elemento [data-slot="<id>"] (ver
// config/banner-slots.js). Acá se elige la entrada vigente de cada slot, se
// cambia la imagen / link / versión celular y se programa el próximo cambio
// (cuando algo empieza o vence la página se actualiza sola, sin recargar).
// Sin entrada vigente queda la imagen original del HTML.
//
// Modo editor: la página se abre dentro del editor visual del panel con
// ?editor=1. Ahí no pide nada a la base: el panel le manda las entradas
// (incluidas las que todavía no guardó) y una fecha de prueba por postMessage,
// y ella avisa qué lugar se tocó. Solo se le hace caso al panel
// (dash.<dominio>) y solo cambia lo que se ve; no expone ni permite nada más.
import { sb, subscribe, publicUrl } from "./supabase.js";
import { SLOT_BY_ID } from "../config/banner-slots.js";
import { pickBanner, nextChange, safeLink } from "./banner-schedule.js";

const CACHE_KEY = "cs_banners_v1";
const PANEL_ORIGIN = location.origin.replace("//", "//dash.");
const EDITOR = new URLSearchParams(location.search).get("editor") === "1" && window.parent !== window;

const originals = new Map(); // elemento -> estado original (contenido y link)
let rows = [];
let fakeNow = null; // ms; solo en el editor ("ver la tienda el día X")
let timer = null;
let selected = "";
let panning = false; // el editor permite arrastrar la imagen del lugar elegido
let draftMedia = { image: "", mobile: "" }; // imágenes elegidas y todavía sin guardar (editor)

const now = () => (fakeNow === null ? Date.now() : fakeNow);
const slotEls = () => Array.from(document.querySelectorAll("[data-slot]"));
const linkOf = (el) => (el.tagName === "A" ? el : el.querySelector("a"));
const okUrl = (u) => /^(https:|blob:|data:image\/(png|jpeg|webp);base64,)/.test(u || "");
const clamp = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

function snapshot(el) {
  if (originals.has(el)) return;
  const a = linkOf(el);
  originals.set(el, {
    kids: Array.from(el.childNodes, (n) => n.cloneNode(true)),
    link: a ? { href: a.getAttribute("href"), target: a.getAttribute("target"), rel: a.getAttribute("rel") } : null,
  });
}

function setAttr(node, name, value) {
  if (value === null || value === undefined) node.removeAttribute(name);
  else node.setAttribute(name, value);
}

function restore(el) {
  const o = originals.get(el);
  if (!o) return;
  el.replaceChildren(...o.kids.map((n) => n.cloneNode(true)));
  const a = linkOf(el);
  if (a && o.link) for (const k of ["href", "target", "rel"]) setAttr(a, k, o.link[k]);
}

// Muestra `entry` en el lugar `el`; sin entrada, la imagen original
function show(el, entry) {
  snapshot(el);
  const key = entry ? [entry.id || "", entry.image_url || entry.image_path, entry.mobile_url || entry.mobile_path || "", entry.link || "", entry.alt || "", entry.legal || "", entry.fit, entry.zoom, entry.pos_x, entry.pos_y].join("|") : "";
  if ((el.dataset.slotEntry || "") !== key) {
    restore(el);
    if (entry) fill(el, entry);
    el.dataset.slotEntry = key;
  }
  // Un lugar con vencimiento propio (data-until) y sin carga vigente se oculta al vencer;
  // en el editor siempre se ve para poder tocarlo
  const expired = !entry && el.dataset.until && now() >= Date.parse(el.dataset.until);
  el.hidden = !EDITOR && !!expired;
}

// Encuadre: cómo se acomoda la imagen dentro de su lugar (ajuste, zoom y posición)
function frame(img, entry) {
  // El lugar tiene su proporción fija (la de la medida recomendada): la imagen se adapta a él,
  // el lugar nunca toma la forma de la imagen. En celular, la de la versión celular si la hay.
  const slot = SLOT_BY_ID[img.closest("[data-slot]").dataset.slot];
  if (slot && slot.ratio) {
    img.dataset.ar = "";
    img.style.setProperty("--ar", `${slot.size[0]} / ${slot.size[1]}`);
    if (slot.mobileSize && (entry.mobile_url || entry.mobile_path)) {
      img.dataset.arM = "";
      img.style.setProperty("--ar-m", `${slot.mobileSize[0]} / ${slot.mobileSize[1]}`);
    }
  }
  const fit = entry.fit === "contain" ? "contain" : "cover";
  const zoom = clamp(entry.zoom, 1, 3, 1);
  const x = clamp(entry.pos_x, 0, 100, 50);
  const y = clamp(entry.pos_y, 0, 100, 50);
  if (fit === "cover" && zoom === 1 && x === 50 && y === 50) return; // como siempre
  img.style.objectFit = fit;
  img.style.objectPosition = `${x}% ${y}%`;
  if (zoom !== 1) {
    img.style.transform = `scale(${zoom})`;
    img.style.transformOrigin = `${x}% ${y}%`;
  }
}

function fill(el, entry) {
  const img = el.querySelector("img");
  const url = entry.image_url || publicUrl("banners", entry.image_path);
  if (!img || !okUrl(url)) return;
  img.src = url;
  img.removeAttribute("srcset");
  // La medida original ya no aplica: la imagen nueva trae la suya
  img.removeAttribute("width");
  img.removeAttribute("height");
  img.alt = entry.alt || "";
  frame(img, entry);

  // Versión celular
  const m = entry.mobile_url || (entry.mobile_path ? publicUrl("banners", entry.mobile_path) : "");
  let pic = img.parentElement && img.parentElement.tagName === "PICTURE" ? img.parentElement : null;
  if (pic) pic.querySelectorAll("source").forEach((s) => s.remove());
  if (okUrl(m)) {
    if (!pic) {
      pic = document.createElement("picture");
      img.replaceWith(pic);
      pic.appendChild(img);
    }
    const s = document.createElement("source");
    s.media = "(max-width: 640px)";
    s.srcset = m;
    pic.prepend(s);
  }

  // Link
  const slot = SLOT_BY_ID[el.dataset.slot];
  const a = linkOf(el);
  if (a && !(slot && slot.link === false)) {
    const href = safeLink(entry.link);
    if (href) {
      a.setAttribute("href", href);
      if (/^https:/i.test(href)) {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener");
      } else {
        a.removeAttribute("target");
        a.removeAttribute("rel");
      }
    } else {
      a.removeAttribute("href");
      a.removeAttribute("target");
      a.removeAttribute("rel");
    }
  }

  // El texto que acompañaba a la imagen original (aviso legal de la campaña) ya no corresponde:
  // se muestra el de la carga, o nada si no tiene
  const legal = (entry.legal || "").trim();
  el.querySelectorAll("[data-slot-default]").forEach((n) => {
    n.textContent = legal;
    n.hidden = !legal;
  });
}

export function renderBanners() {
  clearTimeout(timer);
  const t = now();
  const resolved = rows.map((r) => (r.id === "draft" ? { ...r, image_url: draftMedia.image, mobile_url: draftMedia.mobile } : r));
  for (const el of slotEls()) show(el, pickBanner(resolved, el.dataset.slot, t));
  markSelected();
  if (fakeNow !== null) return; // en el editor no hay reloj real
  // Próximo cambio: una carga que empieza o vence, o el vencimiento propio de un lugar
  const extra = slotEls().map((el) => Date.parse(el.dataset.until || "")).filter((x) => x > t);
  const all = [nextChange(rows, t), ...extra].filter((x) => x !== null);
  if (!all.length) return;
  const wait = Math.max(1000, Math.min(...all) - Date.now() + 500);
  timer = setTimeout(renderBanners, Math.min(wait, 2 ** 31 - 1));
}

// ---------- Datos ----------
function readCache() {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

async function refresh() {
  const { data, error } = await sb.from("store_banners").select("*").eq("enabled", true);
  if (error) return console.error("[banners]", error);
  rows = data || [];
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(rows));
  } catch (e) {
    /* sin almacenamiento: no pasa nada */
  }
  renderBanners();
}

// ---------- Modo editor ----------
function markSelected() {
  slotEls().forEach((el) => {
    const on = !!selected && el.dataset.slot === selected;
    el.classList.toggle("is-selected", on);
    el.classList.toggle("is-pan", on && panning);
  });
}

function startEditor() {
  document.documentElement.classList.add("cs-editor");
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "/assets/css/components/banner-editor.css";
  document.head.appendChild(css);
  for (const el of slotEls()) {
    const s = SLOT_BY_ID[el.dataset.slot];
    el.dataset.slotLabel = s ? s.label : el.dataset.slot;
  }
  // En el editor un toque elige el lugar; nada navega ni se manda
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target.closest("a, button, [data-slot]");
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.target.closest("[data-slot]");
      if (el) window.parent.postMessage({ type: "cs-slot-click", slot: el.dataset.slot }, PANEL_ORIGIN);
    },
    true,
  );
  // Arrastrar la imagen del lugar elegido la reacomoda; la rueda la agranda
  const say = (m) => window.parent.postMessage(m, PANEL_ORIGIN);
  const target = (e) => {
    const el = e.target.closest("[data-slot]");
    return panning && el && el.dataset.slot === selected ? el : null;
  };
  let drag = null;
  document.addEventListener(
    "pointerdown",
    (e) => {
      const el = target(e);
      if (!el) return;
      const r = el.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, w: r.width || 1, h: r.height || 1 };
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    true,
  );
  document.addEventListener("pointermove", (e) => {
    if (!drag) return;
    say({ type: "cs-pan", dx: ((e.clientX - drag.x) / drag.w) * 100, dy: ((e.clientY - drag.y) / drag.h) * 100 });
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  const stop = () => (drag = null);
  document.addEventListener("pointerup", stop);
  document.addEventListener("pointercancel", stop);
  document.addEventListener(
    "wheel",
    (e) => {
      if (!target(e)) return;
      e.preventDefault();
      say({ type: "cs-zoom", delta: e.deltaY < 0 ? 0.1 : -0.1 });
    },
    { passive: false },
  );
  window.addEventListener("message", (e) => {
    if (e.origin !== PANEL_ORIGIN || e.source !== window.parent || !e.data) return;
    if (e.data.type === "cs-media") {
      draftMedia = { image: String(e.data.image || ""), mobile: String(e.data.mobile || "") };
      return renderBanners();
    }
    if (e.data.type !== "cs-rows") return;
    panning = !!e.data.pan;
    rows = Array.isArray(e.data.rows) ? e.data.rows : [];
    fakeNow = e.data.now ? new Date(e.data.now).getTime() : Date.now();
    if (Number.isNaN(fakeNow)) fakeNow = Date.now();
    selected = typeof e.data.selected === "string" ? e.data.selected : "";
    renderBanners();
  });
  window.parent.postMessage({ type: "cs-ready" }, PANEL_ORIGIN);
}

export function initBanners() {
  if (EDITOR) return startEditor();
  rows = readCache(); // lo último que se vio: sin parpadeo mientras llega lo nuevo
  renderBanners();
  refresh();
  let wait = null;
  subscribe("store_banners", () => {
    clearTimeout(wait);
    wait = setTimeout(refresh, 300);
  });
}
