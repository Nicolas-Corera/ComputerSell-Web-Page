// Datos del panel: carga todo desde Supabase, lo normaliza a la forma que
// usan las vistas y lo mantiene al día con realtime. Exporta arreglos
// mutables (se vacían y rellenan en cada recarga) y un onChange(tabla).
import { sb, subscribe, getProfile, signOut, watchSession } from "/assets/js/core/supabase.js";

export const PRODUCTS = [];
export const ORDERS = [];
export const RESERVAS = [];
export const INVOICES = [];
export const RECEIPTS = [];
export const NOTIFS = [];
export const CUSTOMERS = [];
export let USER = { id: null, name: "", email: "", avatar: "" };

const listeners = [];
export function onChange(fn) {
  listeners.push(fn);
}
function emit(what) {
  listeners.forEach((fn) => fn(what));
}

// ---------- Guardia: solo administradores ----------
export async function requireAdmin() {
  const profile = await getProfile(true);
  if (!profile) {
    location.replace("login.html#login");
    return null;
  }
  if (profile.role !== "admin") {
    await signOut();
    location.replace("login.html#login");
    return null;
  }
  // Con la 2FA activada y sin el código en esta sesión la base no lo reconoce
  // como admin (migración 0027): el login muestra el paso del código
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    location.replace("login.html#login");
    return null;
  }
  watchSession(profile, "login.html#login");
  idleLogout();
  USER = {
    id: profile.id,
    name: `${profile.first_name} ${profile.last_name}`.trim() || profile.email,
    email: profile.email,
    avatar: profile.avatar_url || "",
    profile,
  };
  return profile;
}

// Cierre de sesión por inactividad: si el panel queda abierto y sin uso
// (computadora compartida, pestaña olvidada) se cierra la sesión. La actividad
// en cualquier pestaña del panel cuenta (localStorage avisa a las demás).
const IDLE_MS = 30 * 60 * 1000;
const IDLE_KEY = "cs_admin_last_activity";
function idleLogout() {
  let last = Date.now();
  const touch = () => {
    const now = Date.now();
    if (now - last < 15000) return; // no escribir en cada movimiento del mouse
    last = now;
    try {
      localStorage.setItem(IDLE_KEY, String(now));
    } catch (e) {}
  };
  ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"].forEach((ev) => window.addEventListener(ev, touch, { passive: true }));
  window.addEventListener("storage", (e) => {
    if (e.key === IDLE_KEY && e.newValue) last = Math.max(last, Number(e.newValue) || 0);
  });
  setInterval(async () => {
    if (Date.now() - last < IDLE_MS) return;
    await signOut();
    location.replace("login.html?inactividad=1#login");
  }, 30000);
}

// ---------- Normalización ----------
function replace(arr, items) {
  arr.length = 0;
  items.forEach((x) => arr.push(x));
}

export function normProduct(p) {
  return {
    uuid: p.id,
    id: p.id,
    name: p.title,
    title: p.title,
    price: p.price,
    cost: p.cost,
    cat: p.category,
    sub: p.subcategory,
    img: (p.images && p.images[0]) || "",
    images: p.images || [],
    stock: p.stock,
    stockMin: p.stock_min,
    sku: p.sku,
    status: p.status,
    featured: p.featured,
    brand: p.brand,
    createdAt: p.created_at,
    raw: p,
  };
}

function normCustomer(c, userId) {
  c = c || {};
  return { id: userId, name: c.name || "Cliente", email: c.email || "", phone: c.phone || "", dni: c.dni || "", address: c.address || "" };
}

export function normOrder(o) {
  const items = (o.order_items || []).map((it) => ({
    product: { id: it.product_id, name: it.title, img: it.image || "", sku: it.sku, cat: (PRODUCTS.find((p) => p.id === it.product_id) || {}).cat || "" },
    qty: it.qty,
    price: it.unit_price,
  }));
  return {
    uuid: o.id,
    id: "CS-" + o.number,
    number: o.number,
    date: new Date(o.created_at),
    updated: new Date(o.updated_at),
    customer: normCustomer(o.customer, o.user_id),
    userId: o.user_id,
    items,
    payment: o.payment_method,
    paymentInfo: o.payment || {}, // Mercado Pago: marca, últimos 4, ids y estado del pago
    shipping: o.shipping_cost,
    surcharge: o.surcharge,
    subtotal: o.subtotal,
    total: o.total,
    status: o.status,
    installments: o.installments,
    tracking: o.tracking || "",
    events: (o.order_events || []).slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    note: o.note,
  };
}

function normInvoice(i) {
  const order = ORDERS.find((o) => o.uuid === i.order_id);
  return { uuid: i.id, id: i.number, type: i.type, order, date: new Date(i.issued_at), customer: order ? order.customer : normCustomer(null), total: i.total, cae: i.cae };
}

function normReceipt(r) {
  const order = ORDERS.find((o) => o.uuid === r.order_id);
  return {
    uuid: r.id,
    id: "CP-" + r.id.slice(0, 6).toUpperCase(),
    order,
    customer: order ? order.customer : normCustomer(null),
    date: new Date(r.created_at),
    amount: r.amount,
    bank: r.bank,
    reference: r.reference,
    file: r.file_path,
    status: r.status,
  };
}

function normReserva(r) {
  const product = PRODUCTS.find((p) => p.id === r.product_id) || { name: "Producto", img: "", sku: "", stock: 0, price: 0 };
  return {
    uuid: r.id,
    id: "RS-" + r.number,
    date: new Date(r.created_at),
    expires: new Date(r.expires_at),
    customer: normCustomer(r.customer, r.user_id),
    product,
    qty: r.qty,
    deposit: r.deposit,
    status: r.status,
    note: r.note,
  };
}

function normNotif(n) {
  return { id: n.id, type: n.type, icon: n.icon, title: n.title, body: n.body, date: new Date(n.created_at), target: n.target || {}, readBy: n.read_by || [] };
}

// ---------- Carga ----------
export async function loadProducts() {
  // admin_products(): fila completa (incluye cost), solo para admins
  const { data } = await sb.rpc("admin_products").order("created_at", { ascending: false });
  replace(PRODUCTS, (data || []).map(normProduct));
}

export async function loadOrders() {
  const { data } = await sb.from("orders").select("*, order_items(*), order_events(*)").order("created_at", { ascending: false });
  replace(ORDERS, (data || []).map(normOrder));
  const seen = new Map();
  ORDERS.forEach((o) => !seen.has(o.userId) && seen.set(o.userId, o.customer));
  replace(CUSTOMERS, Array.from(seen.values()));
}

export async function loadInvoices() {
  const { data } = await sb.from("invoices").select("*").order("issued_at", { ascending: false });
  replace(INVOICES, (data || []).map(normInvoice));
}

export async function loadReceipts() {
  const { data } = await sb.from("payment_receipts").select("*").order("created_at", { ascending: false });
  replace(RECEIPTS, (data || []).map(normReceipt));
}

export async function loadReservas() {
  const { data } = await sb.from("reservations").select("*").order("created_at", { ascending: false });
  replace(RESERVAS, (data || []).map(normReserva));
}

export async function loadNotifs() {
  const { data } = await sb.from("notifications").select("*").eq("audience", "admin").order("created_at", { ascending: false }).limit(200);
  replace(NOTIFS, (data || []).map(normNotif));
}

export async function loadAll() {
  await loadProducts();
  await loadOrders();
  await Promise.all([loadInvoices(), loadReceipts(), loadReservas(), loadNotifs()]);
}

// ---------- Acciones (RPC) ----------
export async function setOrderStatus(order, status, note, tracking) {
  const { error } = await sb.rpc("set_order_status", { p_order: order.uuid, p_status: status, p_note: note || "", p_tracking: tracking == null ? null : tracking });
  if (error) throw error;
}

export async function reviewReceipt(receipt, approve) {
  const { error } = await sb.rpc("review_receipt", { p_receipt: receipt.uuid, p_approve: approve });
  if (error) throw error;
}

export async function markRead(ids) {
  if (!ids.length) return;
  ids.forEach((id) => {
    const n = NOTIFS.find((x) => x.id === id);
    if (n && !n.readBy.includes(USER.id)) n.readBy.push(USER.id);
  });
  await sb.rpc("mark_notifications_read", { p_ids: ids });
}

export async function receiptUrl(receipt) {
  const { data } = await sb.storage.from("receipts").createSignedUrl(receipt.file, 3600);
  return data ? data.signedUrl : "";
}

// ---------- Realtime ----------
// Cada cambio recarga la tabla afectada (y las que dependen de ella) y avisa.
let timers = {};
function debounced(key, fn) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(fn, 120);
}

export function startRealtime() {
  subscribe("products", () => debounced("products", async () => (await loadProducts(), emit("products"))));
  // Órdenes, ítems, eventos, notas y comprobantes se recargan juntos y en orden
  // (las notas/comprobantes se vinculan a la orden ya cargada) para evitar carreras.
  let reloading = null;
  const reloadOrders = () =>
    debounced("orders", async () => {
      reloading = (reloading || Promise.resolve()).then(async () => {
        await loadOrders();
        await Promise.all([loadInvoices(), loadReceipts()]);
        emit("orders");
      });
      await reloading;
    });
  ["orders", "order_items", "order_events", "invoices", "payment_receipts"].forEach((t) => subscribe(t, reloadOrders));
  subscribe("reservations", () => debounced("reservas", async () => (await loadReservas(), emit("reservas"))));
  subscribe("notifications", () => debounced("notifs", async () => (await loadNotifs(), emit("notifs"))));
}
