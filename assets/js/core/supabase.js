// Cliente de Supabase compartido por todo el sitio (tienda y panel).
// Lee la configuración pública de window.CS_ENV (assets/js/core/env.js,
// generado desde el .env con `npm run env`).
// Versión exacta: un "@2" flotante cargaría cualquier versión nueva sin revisarla
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";

const ENV = window.CS_ENV || {};
if (!ENV.SUPABASE_URL || !ENV.SUPABASE_ANON_KEY) {
  console.error("[supabase] Falta la configuración. Corré `npm run env` (o `npm run dev`).");
}

export const sb = createClient(ENV.SUPABASE_URL || "https://invalid.supabase.co", ENV.SUPABASE_ANON_KEY || "anon", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
  realtime: { params: { eventsPerSecond: 10 } },
});
window.sb = sb; // útil para depurar desde la consola

// ---------- Loader inicial ----------
// Registra una carga en el skeleton de la página (loader.js): el sitio no se
// muestra hasta que resuelva. En páginas sin loader devuelve la promesa tal cual.
export function loading(p) {
  return window.PageLoader ? window.PageLoader.wait(p) : Promise.resolve(typeof p === "function" ? p() : p);
}
// Deja el skeleton puesto (se está redirigiendo: no tiene sentido mostrar la página)
export function holdLoader() {
  if (window.PageLoader) window.PageLoader.hold();
}

// ---------- Sesión ----------
export async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

export async function getUser() {
  const s = await getSession();
  return s ? s.user : null;
}

let profileCache = null;
let profileFor = null;

// Perfil de la tabla public.profiles (cacheado por usuario)
export async function getProfile(force) {
  const user = await getUser();
  if (!user) {
    profileCache = null;
    profileFor = null;
    return null;
  }
  if (!force && profileCache && profileFor === user.id) return profileCache;
  const { data } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  // Con Google, si el perfil no tiene foto, se toma la de la cuenta
  const meta = user.user_metadata || {};
  if (data && !data.avatar_url && (meta.avatar_url || meta.picture)) {
    data.avatar_url = meta.avatar_url || meta.picture;
    sb.from("profiles").update({ avatar_url: data.avatar_url }).eq("id", user.id).then(() => {});
  }
  profileCache = data;
  profileFor = user.id;
  return data;
}

// Datos privados de quien vende: no están en archivos públicos. seller_private()
// devuelve solo lo que corresponde a la sesión: la cuenta para transferir si hay
// un pedido por transferencia pendiente, nombre y DNI/CUIT si hay una nota de
// venta, todo para el panel. { owner?, doc?, bank?: { holder, cbu, alias } }
// force: vuelve a pedirlos (cambian cuando se crea un pedido o se emite una nota).
let sellerPrivate = null;
export async function getSellerPrivate(force) {
  if (sellerPrivate && !force) return sellerPrivate;
  const { data, error } = await sb.rpc("seller_private");
  if (error || !data) return {};
  sellerPrivate = data;
  return data;
}

export function fullName(p) {
  if (!p) return "";
  return `${p.first_name || ""} ${p.last_name || ""}`.trim() || p.email || "";
}

export function initials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";
}

// Redirige al login si no hay sesión. Devuelve el usuario si la hay.
export async function requireAuth(loginUrl) {
  const user = await getUser();
  if (!user) {
    holdLoader();
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace((loginUrl || "/acceso.html") + "?next=" + next + "#login");
    return null;
  }
  watchSession(user, "/index.html");
  return user;
}

// Si la sesión se cierra o la cuenta se elimina mientras la página está
// abierta, se va a `redirect` (index para clientes, login para el panel).
let watching = false;
// URL de la tienda vista desde el panel (dash.<dominio> -> <dominio>; en /dash/ es el mismo origen).
// Aplica a los <a data-store="/ruta"> de la página.
export function storeUrl(path) {
  return location.origin.replace("//dash.", "//") + (path || "/");
}
export function applyStoreLinks() {
  document.querySelectorAll("a[data-store]").forEach((a) => (a.href = storeUrl(a.dataset.store)));
}

// A dónde va watchSession cuando la sesión se cierra (p. ej. el cierre por
// inactividad del panel lleva al login con el aviso)
let leaveRedirect = null;
export function setLeaveRedirect(url) {
  leaveRedirect = url;
}

export function watchSession(user, redirect) {
  if (watching) return;
  watching = true;
  let leaving = false;
  const leave = async () => {
    if (leaving) return;
    leaving = true;
    holdLoader();
    try {
      await sb.auth.signOut({ scope: "local" });
    } catch (e) {}
    location.replace(leaveRedirect || redirect);
  };
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || (event === "TOKEN_REFRESHED" && !session)) leave();
  });
  // Cuenta eliminada: el perfil se borra en cascada (evento DELETE con el id)
  subscribe("profiles", (p) => p.eventType === "DELETE" && leave(), `id=eq.${user.id}`);
  // Por si el token sigue vigente un rato: se verifica al volver a la pestaña
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;
    const { data, error } = await sb.from("profiles").select("id").eq("id", user.id).maybeSingle();
    if (!error && !data) leave();
  });
}

// scope: "global" (por defecto: "Cerrar sesión" del perfil, cierra todos los
// dispositivos) o "local" (solo este navegador: inactividad, cuenta sin acceso al panel)
export async function signOut(scope) {
  profileCache = null;
  sellerPrivate = null;
  // Este navegador deja de recibir las notificaciones push de la cuenta (lo
  // puede usar otra persona). Al volver a entrar se suscribe solo (notifications.js).
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration("/") : null;
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) {
      await sb.rpc("delete_push_subscription", { p_endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
  } catch (e) {}
  await sb.auth.signOut({ scope: scope === "local" ? "local" : "global" });
}

// Escucha cambios de sesión (login/logout en esta u otra pestaña)
export function onAuth(cb) {
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") profileCache = null;
    cb(session ? session.user : null, event);
  });
}

// ---------- Realtime ----------
// Suscribe a cambios de una tabla y llama cb(payload). Devuelve la función para cancelar.
// events: "*" o una lista (["INSERT", "UPDATE"]). Realtime no aplica RLS ni el
// filtro a los DELETE: quien no necesite borrados no los escucha (si no, recibe
// los de todos los usuarios).
let channelSeq = 0;
export function subscribe(table, cb, filter, events) {
  let ch = sb.channel(`${table}-${++channelSeq}-${Math.random().toString(36).slice(2, 7)}`);
  (Array.isArray(events) ? events : [events || "*"]).forEach((event) => {
    const opts = { event, schema: "public", table };
    if (filter) opts.filter = filter;
    ch = ch.on("postgres_changes", opts, (payload) => cb(payload));
  });
  ch.subscribe();
  return () => sb.removeChannel(ch);
}

// ---------- Storage ----------
export function publicUrl(bucket, path) {
  if (!path) return "";
  if (/^https?:\/\//.test(path)) return path;
  return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

// ---------- Productos ----------
export const CATEGORIES = {
  computadoras: { label: "Computadoras", subs: [] },
  notebooks: { label: "Notebooks", subs: [] },
  tablets: { label: "Tablets", subs: [] },
  celulares: { label: "Celulares", subs: [] },
  componentes: {
    label: "Componentes",
    subs: ["Placas de video", "Procesadores", "Memorias RAM", "Almacenamiento", "Motherboards", "Fuentes", "Gabinetes", "Refrigeración", "Otros"],
  },
  perifericos: {
    label: "Periféricos",
    subs: ["Teclados", "Mouse", "Auriculares", "Monitores", "Micrófonos", "Parlantes", "Webcams", "Mousepads", "Otros"],
  },
};

export const slugify = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");

export function productUrl(p) {
  return `/detail.html?id=${p.id}`;
}

// Forma que usan las tarjetas / carrito / favoritos
export function toCard(p) {
  return {
    id: p.id,
    name: p.title,
    price: p.price,
    oldPrice: p.on_sale && p.old_price > p.price ? p.old_price : 0,
    cuotas: "", // etiqueta de cuotas oculta: solo se paga por transferencia
    installments: p.installments || 0, // cuotas sin interés configuradas en el panel
    delivery: p.delivery || "24-48hs", // tiempo de entrega configurado en el panel
    image: p.images && p.images[0] ? p.images[0] : "",
    stock: p.stock,
    freeShipping: p.free_shipping, // envío gratis (solo CABA y Buenos Aires)
    weight: Number(p.weight) || 0, // peso para calcular el envío en el checkout
    weightUnit: p.weight_unit || "kg",
    category: p.category,
    subcategory: p.subcategory,
    brand: p.brand,
    qty: 1,
  };
}

// Columnas de products que puede leer la tienda (cost y created_by son solo
// del panel: migración 0017). Con permisos por columna, select("*") falla.
export const PRODUCT_COLUMNS =
  "id,sku,title,brand,category,subcategory,description,tags,price,old_price,on_sale,stock,stock_min,status," +
  "warranty,warranty_unit,featured,installments,free_shipping,delivery,weight,weight_unit,dimensions,dimensions_unit," +
  "condition,images,specs,highlights,created_at,updated_at";
