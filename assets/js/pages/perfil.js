// Perfil del cliente: datos de la cuenta (tabla profiles), foto (bucket
// avatars, o la de Google), y las pestañas Mis compras / Mis facturas /
// Avisos, todas en tiempo real.
import { sb, requireAuth, getProfile, signOut, subscribe, fullName, loading } from "../core/supabase.js";

const { formatPrice, escapeHtml, toast } = window.CS;
const $ = (s) => document.querySelector(s);

const FIELDS = ["nombre", "apellido", "email", "telefono", "calle", "numero", "piso", "cp", "ciudad", "provincia", "pais"];
const form = $("#profileForm");
const avatarPhoto = $("#avatarPhoto");
const avatarName = $("#avatarName");
const avatarEmail = $("#avatarEmail");
const saveToast = $("#saveToast");

const ORDER_STATUS = {
  pendiente: ["Pendiente de pago", "badge-pending"],
  pagado: ["Pagado", "badge-ok"],
  preparando: ["En preparación", "badge-pending"],
  enviado: ["Despachado", "badge-ok"],
  cancelado: ["Cancelado", "badge-cancel"],
};
const PAYMENT = { credito: "Tarjeta de crédito", debito: "Tarjeta de débito", transferencia: "Transferencia", mercadopago: "Mercado Pago" };

const fmtDate = (d) => new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });

loading(async () => {
  const user = await requireAuth();
  if (!user) return;
  let profile = await getProfile(true);

  // ---------- Datos de la cuenta ----------
  function fillForm(p) {
    const a = p.address || {};
    const values = {
      nombre: p.first_name,
      apellido: p.last_name,
      email: p.email,
      telefono: p.phone,
      calle: a.calle,
      numero: a.numero,
      piso: a.piso,
      cp: a.cp,
      ciudad: a.ciudad,
      provincia: a.provincia,
      pais: a.pais || "Argentina",
    };
    FIELDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = values[id] || "";
    });
    avatarName.textContent = fullName(p) || "Nombre Apellido";
    avatarEmail.textContent = p.email;
    setAvatar(p.avatar_url);
  }

  function setAvatar(url) {
    avatarPhoto.innerHTML = url
      ? `<img src="${escapeHtml(url)}" alt="Foto de perfil" referrerpolicy="no-referrer" />`
      : '<svg class="ic-lg"><use href="#ic-person" /></svg>';
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = (id) => (document.getElementById(id).value || "").trim();
    const address = {
      ...(profile.address || {}),
      calle: v("calle"),
      numero: v("numero"),
      piso: v("piso"),
      cp: v("cp"),
      ciudad: v("ciudad"),
      provincia: v("provincia"),
      pais: v("pais"),
    };
    const { data, error } = await sb
      .from("profiles")
      .update({ first_name: v("nombre"), last_name: v("apellido"), phone: v("telefono"), address })
      .eq("id", user.id)
      .select()
      .single();
    if (error) return toast("No se pudo guardar el perfil", "bad");
    profile = data;
    fillForm(profile);
    saveToast.classList.add("show");
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => saveToast.classList.remove("show"), 2200);
  });

  $("#cancelBtn").addEventListener("click", (e) => {
    e.preventDefault();
    fillForm(profile);
  });

  // ---------- Foto de perfil (bucket avatars) ----------
  const avatarInput = $("#avatarInput");
  $("#avatarEditBtn").addEventListener("click", () => avatarInput.click());
  avatarInput.addEventListener("change", async () => {
    const file = avatarInput.files && avatarInput.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast("La imagen no puede superar 2 MB", "bad");
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${user.id}/avatar-${Date.now()}.${ext}`;
    const { error } = await sb.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
    if (error) return toast("No se pudo subir la foto", "bad");
    const url = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    await sb.from("profiles").update({ avatar_url: url }).eq("id", user.id);
    profile.avatar_url = url;
    setAvatar(url);
    toast("Foto de perfil actualizada", "ok");
    avatarInput.value = "";
  });
  $("#avatarRemoveBtn").addEventListener("click", async () => {
    await sb.from("profiles").update({ avatar_url: null }).eq("id", user.id);
    profile.avatar_url = null;
    setAvatar(null);
    avatarInput.value = "";
  });

  $("#logoutBtn").addEventListener("click", async () => {
    await signOut();
    location.href = "/index.html";
  });

  // ---------- Tabs ----------
  const tabButtons = document.querySelectorAll(".tab-btn[data-tab]");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabButtons.forEach((b) => b.classList.remove("is-active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("is-active"));
      btn.classList.add("is-active");
      document.getElementById(`panel-${btn.dataset.tab}`).classList.add("is-active");
      if (btn.dataset.tab === "avisos") markNotifsRead();
    });
  });
  const hashTab = location.hash.replace("#", "");
  if (["compras", "facturas", "avisos"].includes(hashTab)) document.querySelector(`.tab-btn[data-tab="${hashTab}"]`).click();

  // ---------- Mis compras ----------
  async function renderOrders() {
    const { data } = await sb
      .from("orders")
      .select("id, number, status, total, created_at, order_items(title, qty)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    const list = data || [];
    $("#ordersEmpty").hidden = list.length > 0;
    $("#ordersList").innerHTML = list
      .map((o) => {
        const items = o.order_items || [];
        const n = items.reduce((s, it) => s + it.qty, 0);
        const [label, cls] = ORDER_STATUS[o.status] || [o.status, ""];
        return `
        <div class="list-card">
          <div class="list-card-icon"><svg class="ic-md"><use href="#ic-shopping_bag" /></svg></div>
          <div class="list-card-body">
            <div class="title-row"><strong>Pedido CS-${o.number}</strong><span class="badge ${cls}">${label}</span></div>
            <div class="meta">${fmtDate(o.created_at)} · ${n} producto${n === 1 ? "" : "s"} · ${escapeHtml(items.map((i) => i.title).join(", "))}</div>
          </div>
          <div class="list-card-right">
            <span class="list-card-amount">${formatPrice(o.total)}</span>
            <a class="icon-btn" href="/compra-detalle.html?id=${o.id}" aria-label="Ver detalle del pedido"><svg><use href="#ic-arrow_forward" /></svg></a>
          </div>
        </div>`;
      })
      .join("");
  }

  // ---------- Mis facturas ----------
  async function renderInvoices() {
    const { data } = await sb
      .from("invoices")
      .select("id, number, type, total, issued_at, orders!inner(id, number, user_id, status)")
      .eq("orders.user_id", user.id)
      .order("issued_at", { ascending: false });
    // Solo pedidos vigentes: un pedido cancelado no tiene comprobante
    const list = (data || []).filter((i) => i.orders.status !== "cancelado");
    $("#invoicesEmpty").hidden = list.length > 0;
    $("#invoicesList").innerHTML = list
      .map(
        (i) => `
        <div class="list-card">
          <div class="list-card-icon"><svg class="ic-md"><use href="#ic-document" /></svg></div>
          <div class="list-card-body">
            <div class="title-row"><strong>Nota de venta ${escapeHtml(i.number)}</strong><span class="badge badge-ok">Pagada</span></div>
            <div class="meta">Emitida el ${fmtDate(i.issued_at)} · Pedido CS-${i.orders.number} · No es comprobante fiscal</div>
          </div>
          <div class="list-card-right">
            <span class="list-card-amount">${formatPrice(i.total)}</span>
            <a class="icon-btn" href="/compra-detalle.html?id=${i.orders.id}&factura=${i.id}" aria-label="Ver nota de venta"><svg><use href="#ic-download" /></svg></a>
          </div>
        </div>`,
      )
      .join("");
  }

  // ---------- Avisos ----------
  let notifs = [];
  async function renderNotifs() {
    const { data } = await sb.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50);
    notifs = data || [];
    const unread = notifs.filter((n) => !(n.read_by || []).includes(user.id)).length;
    const badge = $("#avisosBadge");
    badge.textContent = unread || "";
    badge.classList.toggle("is-visible", unread > 0);
    $("#notifsEmpty").hidden = notifs.length > 0;
    $("#notifsList").innerHTML = notifs
      .map(
        (n) => `
        <div class="list-card" style="${(n.read_by || []).includes(user.id) ? "" : "border-color: var(--blue)"}">
          <div class="list-card-icon"><svg class="ic-md"><use href="#ic-${n.icon === "shopping_cart" || n.icon === "local_shipping" ? "shopping_bag" : n.icon === "error" ? "close" : "info"}" /></svg></div>
          <div class="list-card-body">
            <div class="title-row"><strong>${escapeHtml(n.title)}</strong></div>
            <div class="meta">${escapeHtml(n.body)} · ${fmtDate(n.created_at)}</div>
          </div>
          ${n.target && n.target.order ? `<div class="list-card-right"><a class="icon-btn" href="/compra-detalle.html?id=${n.target.order}" aria-label="Ver pedido"><svg><use href="#ic-arrow_forward" /></svg></a></div>` : ""}
        </div>`,
      )
      .join("");
    if (document.querySelector(".tab-btn[data-tab=avisos]").classList.contains("is-active")) markNotifsRead();
  }
  async function markNotifsRead() {
    const ids = notifs.filter((n) => !(n.read_by || []).includes(user.id)).map((n) => n.id);
    if (!ids.length) return;
    await sb.rpc("mark_notifications_read", { p_ids: ids });
  }

  // ---------- Inicio + realtime ----------
  fillForm(profile);
  renderOrders();
  await Promise.all([renderOrders(), renderInvoices(), renderNotifs()]);
  // Si cancelan un pedido desde el panel, su nota de venta desaparece de Mis facturas
  subscribe("orders", () => Promise.all([renderOrders(), renderInvoices()]), `user_id=eq.${user.id}`);
  subscribe("invoices", renderInvoices);
  subscribe("notifications", renderNotifs, `user_id=eq.${user.id}`);
  subscribe(
    "profiles",
    (p) => {
      if (p.new) {
        profile = p.new;
        if (document.activeElement && form.contains(document.activeElement)) return;
        fillForm(profile);
      }
    },
    `id=eq.${user.id}`,
  );
  document.getElementById("footerYear").textContent = new Date().getFullYear();
});
