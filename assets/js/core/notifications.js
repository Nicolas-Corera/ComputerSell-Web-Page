// Avisos del cliente en toda la tienda (lo arranca account.js con la sesión):
//  - Burbuja sobre el botón de cuenta del navbar con los avisos sin leer (en vivo).
//  - Compra pendiente: lo que está en el pago se guarda en la cuenta
//    (checkout_drafts, migración 0029). En la primera página de cada visita
//    se consulta: si el carrito del navegador está vacío (p. ej. borró los
//    datos del sitio) se recupera, y si se fue del pago sin pagar la base deja
//    el aviso "Tenés una compra pendiente" y se muestra una tarjeta para retomarla.
//  - Notificaciones push del navegador (Web Push, sw.js): se ofrecen una vez
//    con una tarjeta propia antes del permiso del navegador, y se activan o
//    desactivan en Mi perfil > Avisos. Los envía api/notify-mail.js.
import { sb, subscribe, toCard } from "./supabase.js";
import { CARD_COLUMNS } from "./catalog.js";

const ENV = window.CS_ENV || {};
const PAY_PAGE = /^\/pago(\.html)?$/;
const NO_PROMPT_PAGES = /^\/(pago|acceso)(\.html)?$/;

let user = null;

// ---------- Tarjeta flotante (compra pendiente / pedir notificaciones) ----------
// actions: [{label, href?, primary?, onClick?}] · se cierra con la X o al elegir
function floatingCard({ icon, title, text, actions, onClose }) {
  document.querySelectorAll(".csFloat").forEach((el) => el.remove());
  const { escapeHtml } = window.CS;
  const card = document.createElement("div");
  card.className = "csFloat";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", title);
  card.innerHTML = `
    <div class="csFloat-icon"><svg class="ic-md"><use href="#ic-${icon}" /></svg></div>
    <div class="csFloat-body">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(text)}</p>
      <div class="csFloat-actions">
        ${actions
          .map((a, i) =>
            a.href
              ? `<a class="csFloat-btn${a.primary ? " is-primary" : ""}" href="${escapeHtml(a.href)}" data-i="${i}">${escapeHtml(a.label)}</a>`
              : `<button type="button" class="csFloat-btn${a.primary ? " is-primary" : ""}" data-i="${i}">${escapeHtml(a.label)}</button>`,
          )
          .join("")}
      </div>
    </div>
    <button type="button" class="csFloat-close" aria-label="Cerrar"><svg><use href="#ic-close" /></svg></button>`;
  const close = () => {
    card.classList.remove("is-visible");
    setTimeout(() => card.remove(), 250);
  };
  card.querySelector(".csFloat-close").addEventListener("click", () => {
    close();
    if (onClose) onClose();
  });
  card.querySelectorAll("[data-i]").forEach((el) => {
    const a = actions[+el.dataset.i];
    el.addEventListener("click", () => {
      close();
      if (a.onClick) a.onClick();
    });
  });
  document.body.appendChild(card);
  requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add("is-visible")));
  return card;
}

// ---------- Burbuja de avisos sin leer ----------
let lastUnread = 0;
let badgeTimer = null;
let stopBadge = null;

function setBadge(n) {
  const badge = document.getElementById("accountBadge");
  const btn = document.getElementById("accountBtn");
  if (!badge) return;
  // Al llegar a 0 no se escribe "0": la burbuja se achica con el último número
  if (n > 0) badge.textContent = n > 99 ? "99+" : n;
  const grew = n > lastUnread && badge.classList.contains("is-visible");
  badge.classList.toggle("is-visible", n > 0);
  if (grew) {
    badge.classList.remove("is-bump");
    void badge.offsetWidth; // reinicia la animación
    badge.classList.add("is-bump");
  }
  if (btn) {
    if (n > 0) btn.dataset.unread = String(n);
    else delete btn.dataset.unread;
    btn.title = n > 0 ? `${n} aviso${n === 1 ? "" : "s"} sin leer` : "";
  }
  lastUnread = n;
}

export async function refreshBadge() {
  if (!user) return setBadge(0);
  const uid = user.id;
  const { count, error } = await sb
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", uid)
    .not("read_by", "cs", `{${uid}}`);
  if (!error && user && user.id === uid) setBadge(count || 0);
}

function watchBadge() {
  if (stopBadge) stopBadge();
  stopBadge = null;
  if (!user) return setBadge(0);
  refreshBadge();
  // Marcar como leídos llega como varios UPDATE juntos: se cuenta una vez
  stopBadge = subscribe(
    "notifications",
    () => {
      clearTimeout(badgeTimer);
      badgeTimer = setTimeout(refreshBadge, 250);
    },
    `user_id=eq.${user.id}`,
  );
}

// ---------- Compra pendiente ----------
// pago.js la guarda al entrar, en cada cambio del carrito y al salir de la pestaña
// (el pago exige sesión: la base la guarda para auth.uid())
export function saveCheckoutDraft(items) {
  const list = (items || []).map((it) => ({ id: it.id, qty: it.qty }));
  sb.rpc("save_checkout_draft", { p_items: list }).then(({ error }) => error && console.error("[compra pendiente]", error));
}

// Carrito vacío en el navegador + compra pendiente en la cuenta -> se recupera
async function restoreCart(items) {
  const store = window.CartStore;
  if (!store || store.totalQty() > 0) return false;
  const order = items.map((it) => it.id);
  const { data, error } = await sb.from("products").select(CARD_COLUMNS).in("id", order).eq("status", "publicado");
  if (error || !data || !data.length) return false;
  const qty = new Map(items.map((it) => [it.id, it.qty]));
  let added = false;
  data
    .map(toCard)
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    .forEach((p) => {
      const q = Math.min(qty.get(p.id) || 1, typeof p.stock === "number" ? p.stock : 99);
      if (q > 0 && store.add({ ...p, qty: q })) added = true;
    });
  return added;
}

function showPendingCard(items) {
  const n = items.reduce((s, it) => s + (it.qty || 1), 0);
  floatingCard({
    icon: "shopping_bag",
    title: "Tenés una compra pendiente",
    text: `Dejaste ${n} producto${n === 1 ? "" : "s"} sin pagar. Tu carrito sigue guardado para que termines la compra.`,
    actions: [
      { label: "Ver carrito", href: "/carrito.html" },
      { label: "Terminar compra", href: "/pago.html", primary: true },
    ],
  });
}

// Una vez por visita (pestaña nueva / navegador reabierto / datos borrados).
// Devuelve true si mostró la tarjeta de compra pendiente.
async function checkPendingCheckout() {
  const key = "cs_visit_" + user.id;
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
  } catch (e) {}
  const onPay = PAY_PAGE.test(location.pathname);
  const { data, error } = await sb.rpc("pending_checkout", { p_notify: !onPay });
  if (error || !data || !Array.isArray(data.items) || !data.items.length) return false;
  const restored = await restoreCart(data.items);
  // El pago ya se armó con el carrito vacío: se vuelve a cargar con lo recuperado
  if (restored && onPay) {
    location.reload();
    return true;
  }
  if (data.notified) {
    refreshBadge();
    showPendingCard(data.items);
    return true;
  }
  return false;
}

// Vació el carrito: la compra deja de estar pendiente (y su aviso también)
function watchCartEmpty() {
  const store = window.CartStore;
  if (!store) return;
  let prev = store.totalQty();
  store.onChange(() => {
    const now = store.totalQty();
    if (prev > 0 && now === 0 && user) sb.rpc("clear_checkout_draft").then(() => refreshBadge());
    prev = now;
  });
}

// ---------- Notificaciones push ----------
const PUSH_OK = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && !!ENV.VAPID_PUBLIC_KEY;
const ASK_KEY = "cs_push_ask"; // cuándo eligió "Ahora no"
const OFF_KEY = "cs_push_off"; // las desactivó en este navegador desde el perfil
const ASK_AGAIN_MS = 30 * 24 * 3600 * 1000;

const storage = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  },
  set(k, v) {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch (e) {}
  },
};

function keyBytes(b64url) {
  const s = b64url.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(s + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

function sameKey(sub) {
  const k = sub.options && sub.options.applicationServerKey;
  if (!k) return true;
  const a = new Uint8Array(k);
  const b = keyBytes(ENV.VAPID_PUBLIC_KEY);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

// Suscribe este navegador (con el permiso ya dado) y lo guarda en la cuenta
async function subscribePush() {
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // Suscripción hecha con otra clave VAPID: no sirve, se rehace
  if (sub && !sameKey(sub)) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(ENV.VAPID_PUBLIC_KEY) });
  const json = sub.toJSON();
  const { error } = await sb.rpc("save_push_subscription", {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
    p_user_agent: navigator.userAgent,
  });
  if (error) throw error;
}

export const push = {
  configured: !!ENV.VAPID_PUBLIC_KEY,
  supported: PUSH_OK,
  // "granted" | "denied" | "default" | "unsupported"
  permission: () => (PUSH_OK ? Notification.permission : "unsupported"),
  async enabled() {
    if (!PUSH_OK || Notification.permission !== "granted" || storage.get(OFF_KEY)) return false;
    return !!(await currentSubscription());
  },
  // Pide el permiso (tiene que venir de un clic). -> true si quedaron activadas
  async enable() {
    if (!PUSH_OK || !user) return false;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return false;
    storage.set(OFF_KEY, null);
    await subscribePush();
    return true;
  },
  async disable() {
    storage.set(OFF_KEY, "1");
    if (!PUSH_OK) return;
    const sub = await currentSubscription();
    if (!sub) return;
    await sb.rpc("delete_push_subscription", { p_endpoint: sub.endpoint });
    await sub.unsubscribe();
  },
};

// Con el permiso ya dado: este navegador queda suscripto a la cuenta con la
// que se entró (una vez por visita). Cubre volver a entrar después de cerrar sesión.
async function syncPush() {
  if (!PUSH_OK || Notification.permission !== "granted" || storage.get(OFF_KEY)) return;
  const key = "cs_push_sync_" + user.id;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch (e) {}
  subscribePush().catch((e) => console.error("[push]", e));
}

function askPush() {
  if (!PUSH_OK || Notification.permission !== "default" || storage.get(OFF_KEY)) return;
  if (NO_PROMPT_PAGES.test(location.pathname)) return;
  if (Date.now() - (+storage.get(ASK_KEY) || 0) < ASK_AGAIN_MS) return;
  setTimeout(() => {
    // Otro aviso en pantalla (cookies, compra pendiente): se ofrece en la próxima página
    if (!user || document.querySelector(".csFloat, .cc-banner")) return;
    const later = () => storage.set(ASK_KEY, String(Date.now()));
    floatingCard({
      icon: "notifications",
      title: "¿Querés recibir notificaciones?",
      text: "Te avisamos al instante cuando se confirme tu pago o cambie el estado de tu pedido, aunque no tengas la página abierta.",
      onClose: later,
      actions: [
        { label: "Ahora no", onClick: later },
        {
          label: "Activar",
          primary: true,
          onClick: async () => {
            try {
              const ok = await push.enable();
              if (ok) window.CS.toast("Listo: te vamos a avisar por notificación", "ok");
              else {
                later();
                if (Notification.permission === "denied") window.CS.toast("Las notificaciones quedaron bloqueadas. Podés activarlas desde la configuración del navegador.", "bad");
              }
            } catch (e) {
              console.error("[push]", e);
              window.CS.toast("No pudimos activar las notificaciones. Probá de nuevo.", "bad");
            }
          },
        },
      ],
    });
  }, 4000);
}

// ---------- Inicio ----------
let cartWatched = false;
export async function startNotifications(u) {
  const changed = (u && u.id) !== (user && user.id);
  user = u || null;
  if (!changed) return;
  lastUnread = 0;
  watchBadge();
  if (!user) return;
  if (!cartWatched) {
    cartWatched = true;
    watchCartEmpty();
  }
  syncPush();
  const shown = await checkPendingCheckout().catch((e) => {
    console.error("[compra pendiente]", e);
    return false;
  });
  if (!shown) askPush();
}
