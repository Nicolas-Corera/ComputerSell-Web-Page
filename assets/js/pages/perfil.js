// Perfil del cliente: datos de la cuenta (tabla profiles), foto (bucket
// avatars, o la de Google), y las pestañas Mis compras / Mis facturas /
// Avisos, todas en tiempo real.
import { sb, requireAuth, getProfile, signOut, subscribe, fullName, loading } from "../core/supabase.js";
import { push } from "../core/notifications.js";

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
  entregado: ["Entregado", "badge-ok"],
  cancelado: ["Cancelado", "badge-cancel"],
};
// Ícono de cada aviso (nombres que guarda la base -> sprite de la tienda)
const NOTIF_ICON = {
  shopping_bag: "shopping_bag",
  shopping_cart: "shopping_bag",
  local_shipping: "shipping_truck",
  inventory_2: "shopping_bag",
  receipt_long: "receipt_long",
  payments: "check",
  check_circle: "task_alt",
  error: "error",
  cancel: "cancel",
  info: "info",
};
const fmtDateTime = (d) => new Date(d).toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
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
      telefono: CS.formatPhone(p.phone),
      calle: a.calle,
      numero: a.numero,
      piso: a.piso,
      cp: a.cp,
      ciudad: a.ciudad,
      provincia: a.provincia,
      pais: "Argentina",
    };
    FIELDS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      // Provincias viejas en texto libre ("Capital Federal", "bs as"...): si no
      // es una opción del selector queda sin elegir
      if (el.tagName === "SELECT" && values[id] && !Array.from(el.options).some((o) => o.value === values[id])) el.value = "";
      else el.value = values[id] || "";
    });
    avatarName.textContent = fullName(p) || "Nombre Apellido";
    avatarEmail.textContent = p.email;
    setAvatar(p.avatar_url);
  }

  // El navbar (account.js) muestra la foto y el nombre: se actualiza sin recargar
  const announce = (p) => window.dispatchEvent(new CustomEvent("cs:profile", { detail: p }));

  function setAvatar(url) {
    avatarPhoto.innerHTML = url
      ? `<img src="${escapeHtml(url)}" alt="Foto de perfil" referrerpolicy="no-referrer" />`
      : '<svg class="ic-lg"><use href="#ic-person" /></svg>';
    $("#avatarRemoveBtn").hidden = !url;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) return form.reportValidity();
    const v = (id) => (document.getElementById(id).value || "").trim();
    const address = {
      ...(profile.address || {}),
      calle: v("calle"),
      numero: v("numero"),
      piso: v("piso"),
      cp: v("cp"),
      ciudad: v("ciudad"),
      provincia: v("provincia"),
      pais: "Argentina",
    };
    const { data, error } = await sb
      .from("profiles")
      .update({ first_name: v("nombre"), last_name: v("apellido"), phone: v("telefono"), address })
      .eq("id", user.id)
      .select()
      .single();
    if (error) {
      console.error("[perfil]", error);
      return toast("No se pudo guardar el perfil. Revisá los datos y probá de nuevo.", "bad");
    }
    profile = data;
    fillForm(profile);
    announce(profile);
    saveToast.classList.add("show");
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => saveToast.classList.remove("show"), 2200);
  });

  $("#cancelBtn").addEventListener("click", (e) => {
    e.preventDefault();
    fillForm(profile);
  });

  // ---------- Foto de perfil (bucket avatars) ----------
  // El bucket es público: al cambiar o quitar la foto se borran los archivos
  // anteriores (si no, seguirían accesibles por su URL).
  const avatarInput = $("#avatarInput");
  const AVATAR_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  async function removeOldAvatars(keep) {
    const { data } = await sb.storage.from("avatars").list(user.id, { limit: 100 });
    const old = (data || []).map((f) => `${user.id}/${f.name}`).filter((path) => path !== keep);
    if (old.length) await sb.storage.from("avatars").remove(old);
  }
  $("#avatarEditBtn").addEventListener("click", () => avatarInput.click());
  avatarInput.addEventListener("change", async () => {
    const file = avatarInput.files && avatarInput.files[0];
    avatarInput.value = ""; // elegir el mismo archivo otra vez vuelve a disparar change
    if (!file) return;
    if (!AVATAR_TYPES[file.type]) return toast("La foto tiene que ser PNG, JPG o WEBP", "bad");
    if (file.size > 2 * 1024 * 1024) return toast("La imagen no puede superar 2 MB", "bad");
    const path = `${user.id}/avatar-${Date.now()}.${AVATAR_TYPES[file.type]}`;
    const { error } = await sb.storage.from("avatars").upload(path, file, { contentType: file.type });
    if (error) return toast("No se pudo subir la foto. Probá con otra imagen (PNG, JPG o WEBP, hasta 2 MB).", "bad");
    const url = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    const upd = await sb.from("profiles").update({ avatar_url: url }).eq("id", user.id);
    if (upd.error) {
      await sb.storage.from("avatars").remove([path]);
      return toast("No se pudo guardar la foto", "bad");
    }
    removeOldAvatars(path).catch(() => {});
    profile.avatar_url = url;
    setAvatar(url);
    announce(profile);
    toast("Foto de perfil actualizada", "ok");
  });
  $("#avatarRemoveBtn").addEventListener("click", async () => {
    const { error } = await sb.from("profiles").update({ avatar_url: null }).eq("id", user.id);
    if (error) return toast("No se pudo quitar la foto", "bad");
    await removeOldAvatars(null).catch(() => {});
    profile.avatar_url = null;
    setAvatar(null);
    announce(profile);
    toast("Quitamos tu foto de perfil", "ok");
  });

  // Cambiar contraseña: por enlace al correo (no con la sesión abierta), así
  // quien tenga acceso a una sesión ajena no puede cambiarla sin la casilla
  $("#passwordBtn").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    if (b.disabled) return;
    b.disabled = true; // antes de cualquier await: un doble click no manda dos correos
    const email = (await getProfile()).email;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/acceso#nueva" });
    b.disabled = false;
    if (error) {
      const wait = /for security purposes|after \d+ seconds|rate limit/i.test(error.message || "");
      return window.CS.toast(wait ? "Ya te mandamos un enlace hace instantes. Esperá un minuto." : "No pudimos enviar el correo. Probá de nuevo.", "bad");
    }
    window.CS.toast(`Te enviamos un enlace a ${email} para cambiar la contraseña.`);
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
      if (btn.dataset.tab === "avisos") markWhenVisible();
    });
  });
  // #compras / #facturas / #avisos abre esa pestaña (también desde la burbuja
  // del navbar estando ya en el perfil: ahí solo cambia el hash)
  const openHashTab = () => {
    const hashTab = location.hash.replace("#", "");
    if (!["compras", "facturas", "avisos"].includes(hashTab)) return;
    document.querySelector(`.tab-btn[data-tab="${hashTab}"]`).click();
    // Las pestañas están abajo del formulario: se lleva la vista hasta ellas
    requestAnimationFrame(() => document.querySelector(".tabs-wrap").scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  openHashTab();
  window.addEventListener("hashchange", openHashTab);

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
            <span class="list-card-amount">$${formatPrice(o.total)}</span>
            <a class="icon-btn" href="/compra-detalle.html?id=${o.id}" aria-label="Ver detalle del pedido CS-${o.number}"><svg><use href="#ic-arrow_forward" /></svg></a>
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
            <span class="list-card-amount">$${formatPrice(i.total)}</span>
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
          <div class="list-card-icon"><svg class="ic-md" aria-hidden="true"><use href="#ic-${NOTIF_ICON[n.icon] || "info"}" /></svg></div>
          <div class="list-card-body">
            <div class="title-row"><strong>${escapeHtml(n.title)}</strong></div>
            <div class="meta">${[n.body ? escapeHtml(n.body) : "", fmtDateTime(n.created_at)].filter(Boolean).join(" · ")}</div>
          </div>
          ${notifLink(n)}
        </div>`,
      )
      .join("");
    if (document.querySelector(".tab-btn[data-tab=avisos]").classList.contains("is-active")) markWhenVisible();
  }
  // Flecha del aviso: al pedido, o a una página de la tienda (compra pendiente -> /pago.html)
  function notifLink(n) {
    const t = n.target || {};
    if (t.order) return `<div class="list-card-right"><a class="icon-btn" href="/compra-detalle.html?id=${encodeURIComponent(t.order)}" aria-label="Ver pedido"><svg><use href="#ic-arrow_forward" /></svg></a></div>`;
    if (/^\/[a-z-]+\.html$/.test(String(t.url || ""))) return `<div class="list-card-right"><a class="icon-btn" href="${t.url}" aria-label="Retomar la compra"><svg><use href="#ic-arrow_forward" /></svg></a></div>`;
    return "";
  }
  // Se marcan como leídos cuando la lista está en pantalla (no al abrir el
  // perfil con la pestaña fuera de la vista). Todos los no leídos, no solo
  // los 50 que se listan: si no, la burbuja nunca baja de N - 50.
  async function markNotifsRead() {
    const { data } = await sb.from("notifications").select("id").eq("user_id", user.id).not("read_by", "cs", `{${user.id}}`).limit(1000);
    const ids = (data || []).map((n) => n.id);
    if (!ids.length) return;
    await sb.rpc("mark_notifications_read", { p_ids: ids });
  }
  let readObserver = null;
  function markWhenVisible() {
    const list = $("#panel-avisos");
    if (!("IntersectionObserver" in window)) return markNotifsRead();
    if (readObserver) readObserver.disconnect();
    readObserver = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting)) {
        readObserver.disconnect();
        readObserver = null;
        markNotifsRead();
      }
    }, { threshold: 0.2 });
    readObserver.observe(list);
  }

  // ---------- Notificaciones push (este navegador) ----------
  const pushBox = $("#pushPref");
  const pushBtn = $("#pushPrefBtn");
  const pushHint = $("#pushPrefHint");
  async function renderPush() {
    if (!push.configured) return; // sin clave VAPID en el sitio no se ofrecen
    pushBox.hidden = false;
    const perm = push.permission();
    const on = await push.enabled();
    pushBtn.hidden = perm === "unsupported" || perm === "denied";
    pushBtn.textContent = on ? "Desactivar" : "Activar";
    pushBtn.className = on ? "btn btn-third" : "btn btn-secondary";
    pushHint.textContent =
      perm === "unsupported"
        ? "Este navegador no admite notificaciones. Los avisos te siguen llegando por correo y los ves acá."
        : perm === "denied"
          ? "Están bloqueadas para este sitio. Para recibirlas, permití las notificaciones desde la configuración del navegador (ícono del candado junto a la dirección)."
          : on
            ? "Activadas: te avisamos al instante cuando se confirme tu pago o cambie el estado de tus pedidos."
            : "Te avisamos al instante cuando se confirme tu pago o cambie el estado de tus pedidos, aunque no tengas la página abierta. Los avisos también te llegan por correo.";
  }
  pushBtn.addEventListener("click", async () => {
    pushBtn.disabled = true;
    try {
      if (await push.enabled()) {
        await push.disable();
        toast("Desactivaste las notificaciones en este dispositivo");
      } else if (await push.enable()) {
        toast("Listo: te vamos a avisar por notificación", "ok");
      }
    } catch (e) {
      console.error("[push]", e);
      toast("No pudimos cambiar las notificaciones. Probá de nuevo.", "bad");
    }
    pushBtn.disabled = false;
    renderPush();
  });
  renderPush();

  // ---------- Inicio + realtime ----------
  fillForm(profile);
  await Promise.all([renderOrders(), renderInvoices(), renderNotifs()]);
  // Si cancelan un pedido desde el panel, su nota de venta desaparece de Mis facturas.
  // Sin DELETE: realtime los manda sin filtrar (de todos los usuarios).
  subscribe("orders", () => Promise.all([renderOrders(), renderInvoices()]), `user_id=eq.${user.id}`, ["INSERT", "UPDATE"]);
  subscribe("invoices", renderInvoices, null, ["INSERT", "UPDATE"]);
  subscribe("notifications", renderNotifs, `user_id=eq.${user.id}`, ["INSERT", "UPDATE"]);
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
