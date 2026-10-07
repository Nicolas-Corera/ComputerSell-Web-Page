// Panel de administración (dash/index.html). Vive en el subdominio dash.<dominio>;
// los enlaces internos son relativos (login.html, ./) para que también funcione en /dash/.
// Solo para cuentas con rol admin. Los datos (productos, órdenes, facturas,
// comprobantes, reservas, notificaciones) vienen de Supabase y se mantienen
// al día con realtime (ver dashboard/data.js). Preferencias de UI (tema,
// colapso del menú, etc.) se guardan en localStorage con prefijo "cs_admin_".
import { sb, signOut, CATEGORIES, applyStoreLinks, storeUrl } from "/assets/js/core/supabase.js";
import { saleNoteHtml, printSaleNote, loadSignature } from "/assets/js/core/sale-note.js";
import {
  PRODUCTS, ORDERS, RESERVAS, INVOICES, RECEIPTS, NOTIFS, CUSTOMERS, USER,
  requireAdmin, loadAll, onChange, startRealtime, setOrderStatus, reviewReceipt, markRead, receiptUrl, loadProducts,
} from "./data.js";

(async function () {
  if (!(await requireAdmin())) return;
  applyStoreLinks();
  await loadAll();
  const { formatPrice, parsePrice, escapeHtml } = window.CS;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const TODAY = new Date();
  const DAY = 86400000;

  // ---------- Storage ----------
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem("cs_admin_" + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem("cs_admin_" + key, JSON.stringify(value));
      } catch (e) {
        /* sin storage: vive en memoria */
      }
    },
    remove(key) {
      try {
        localStorage.removeItem("cs_admin_" + key);
      } catch (e) {}
    },
  };

  // ---------- Utilidades ----------
  const MONTHS = [
    "ene", "feb", "mar", "abr", "may", "jun",
    "jul", "ago", "sep", "oct", "nov", "dic",
  ];
  const MONTHS_LONG = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];

  const pad = (n) => String(n).padStart(2, "0");

  function fmtDate(d) {
    d = new Date(d);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  function fmtDateShort(d) {
    d = new Date(d);
    return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  }

  function fmtDateTime(d) {
    d = new Date(d);
    return `${fmtDate(d)} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fmtRelative(d) {
    const diff = TODAY - new Date(d);
    const min = Math.round(diff / 60000);
    if (min < 1) return "ahora";
    if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `hace ${h} h`;
    const days = Math.round(h / 24);
    if (days === 1) return "ayer";
    if (days < 7) return `hace ${days} días`;
    return fmtDate(d);
  }

  function fmtCompact(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(".", ",") + " M";
    if (n >= 1e3) return Math.round(n / 1e3) + " k";
    return String(n);
  }

  function initials(name) {
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase();
  }

  const normalize = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();

  // ---------- Toast ----------
  const toastWrap = $("#toasts");
  function toast(text, type) {
    const el = document.createElement("div");
    el.className = "toast" + (type ? " is-" + type : "");
    const icon = type === "bad" ? "error" : type === "ok" ? "check_circle" : "info";
    el.innerHTML = `<svg><use href="#ic-${icon}" /></svg><span>${escapeHtml(text)}</span>`;
    toastWrap.appendChild(el);
    setTimeout(() => {
      el.classList.add("is-out");
      setTimeout(() => el.remove(), 260);
    }, 3200);
  }

  // ---------- Modal ----------
  const modalBackdrop = $("#modalBackdrop");
  const modal = $("#modal");

  function openModal(html, opts) {
    opts = opts || {};
    modal.className = "modal" + (opts.wide ? " is-wide" : "");
    modal.innerHTML = html;
    modalBackdrop.classList.add("is-open");
    document.body.style.overflow = "hidden";
    $$("[data-close]", modal).forEach((b) => b.addEventListener("click", closeModal));
  }

  function closeModal() {
    modalBackdrop.classList.remove("is-open");
    document.body.style.overflow = "";
  }

  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) closeModal();
  });

  function confirmModal({ title, text, okText, danger }) {
    return new Promise((resolve) => {
      openModal(`
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(text)}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" data-close>Cancelar</button>
          <button class="btn ${danger ? "btn-danger" : "btn-secondary"}" type="button" id="modalOk">${escapeHtml(okText || "Confirmar")}</button>
        </div>`);
      $("#modalOk").addEventListener("click", () => {
        closeModal();
        resolve(true);
      });
      $$("[data-close]", modal).forEach((b) =>
        b.addEventListener("click", () => resolve(false)),
      );
    });
  }

  // =====================================================================
  //  CONSTANTES DE DOMINIO
  // =====================================================================

  // Etiquetas (los recargos están en assets/js/config/payment-rates.js)
  const PAYMENTS = {
    credito: { label: "Tarjeta de crédito" },
    debito: { label: "Tarjeta de débito" },
    transferencia: { label: "Transferencia" },
    mercadopago: { label: "Mercado Pago" },
  };

  const ORDER_STATUS = {
    pendiente: { label: "Pendiente de pago", cls: "is-warn" },
    pagado: { label: "Pagado", cls: "is-info" },
    preparando: { label: "En preparación", cls: "is-info" },
    enviado: { label: "Despachado", cls: "is-ok" },
    cancelado: { label: "Cancelado", cls: "is-bad" },
  };

  const RESERVA_STATUS = {
    activa: { label: "Activa", cls: "is-info" },
    "por-vencer": { label: "Por vencer", cls: "is-warn" },
    retirada: { label: "Retirada", cls: "is-ok" },
    vencida: { label: "Vencida", cls: "is-muted" },
    cancelada: { label: "Cancelada", cls: "is-bad" },
  };

  // Notificaciones leídas por este admin (columna read_by)
  const isRead = (n) => n.readBy.includes(USER.id);


  // =====================================================================
  //  NAVEGACIÓN / SIDEBAR
  // =====================================================================

  const admin = $("#admin");
  const sidebar = $("#sidebar");
  const sidebarBackdrop = $("#sidebarBackdrop");
  const views = $$(".view");
  const navButtons = $$("[data-view]", sidebar);
  const topTitle = $("#topTitle");
  const topSub = $("#topSub");

  const VIEW_META = {
    notificaciones: ["Notificaciones", "Todo lo que pasó en la tienda"],
    dashboard: ["Dashboard", "Resumen general de la tienda"],
    analiticas: ["Analíticas", "Rendimiento de ventas y comportamiento de compra"],
    ordenes: ["Órdenes", "Ventas y reservas"],
    productos: ["Productos", "Catálogo publicado y stock"],
    facturas: ["Facturas", "Comprobantes emitidos y recibidos"],
    cargas: ["Cargas", "Publicá un producto nuevo en el catálogo"],
    perfil: ["Mi perfil", USER.email],
  };

  const rendered = {};

  function showView(name, opts) {
    opts = opts || {};
    if (!VIEW_META[name]) name = "dashboard";
    views.forEach((v) => v.classList.toggle("is-active", v.dataset.view === name));
    navButtons.forEach((b) => b.classList.toggle("is-active", b.dataset.view === name));
    topTitle.textContent = VIEW_META[name][0];
    topSub.textContent = VIEW_META[name][1];
    if (!rendered[name]) {
      rendered[name] = true;
      RENDERERS[name] && RENDERERS[name]();
    }
    if (opts.tab) {
      const nav = $(`.view[data-view="${name}"] .tab-nav`);
      if (nav) activateTab(nav, opts.tab);
    }
    closeSidebarMobile();
    if (!opts.silent) history.replaceState(null, "", "#" + name);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  navButtons.forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
  $$("[data-goto]").forEach((b) =>
    b.addEventListener("click", () => showView(b.dataset.goto, { tab: b.dataset.tab })),
  );
  $("#topNotifBtn").addEventListener("click", () => showView("notificaciones"));

  // Colapso (desktop) — persiste
  function setCollapsed(v) {
    admin.classList.toggle("is-collapsed", v);
    store.set("collapsed", v);
    $("#sbCollapse").title = v ? "Expandir menú" : "Colapsar menú";
  }
  $("#sbCollapse").addEventListener("click", () => setCollapsed(!admin.classList.contains("is-collapsed")));

  // Drawer mobile
  function openSidebarMobile() {
    sidebar.classList.add("is-open");
    sidebarBackdrop.classList.add("is-open");
  }
  function closeSidebarMobile() {
    sidebar.classList.remove("is-open");
    sidebarBackdrop.classList.remove("is-open");
  }
  $("#menuBtn").addEventListener("click", openSidebarMobile);
  sidebarBackdrop.addEventListener("click", closeSidebarMobile);

  // Tabs genéricos
  function activateTab(nav, tab) {
    const container = nav.parentElement;
    $$(".tab-btn", nav).forEach((b) => b.classList.toggle("is-active", b.dataset.tab === tab));
    $$(":scope > .tab-panel", container).forEach((p) =>
      p.classList.toggle("is-active", p.dataset.tab === tab),
    );
  }
  $$(".tab-nav").forEach((nav) => {
    nav.addEventListener("click", (e) => {
      const btn = e.target.closest(".tab-btn");
      if (btn) activateTab(nav, btn.dataset.tab);
    });
  });

  // Botones "data-toast" (acciones simuladas)
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-toast]");
    if (el) {
      e.preventDefault();
      toast(el.dataset.toast);
    }
  });

  // =====================================================================
  //  GRÁFICOS SVG
  // =====================================================================

  function makeTip(container) {
    let tip = $(".chart-tip", container);
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "chart-tip";
      container.appendChild(tip);
    }
    return tip;
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return m * p;
  }

  // Barras (agrupadas si hay varias series)
  function barChart(el, cfg) {
    const W = 800, H = 260, padL = 52, padR = 10, padT = 14, padB = 30;
    const labels = cfg.labels;
    const series = cfg.series;
    const max = niceMax(Math.max(...series.flatMap((s) => s.values)) || 1);
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const groupW = innerW / labels.length;
    const gap = 2;
    const barW = Math.min(28, (groupW * 0.7 - gap * (series.length - 1)) / series.length);
    const fmt = cfg.format || ((v) => formatPrice(v));
    const ticks = 4;

    let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="aspect-ratio:${W}/${H}">`;
    for (let t = 0; t <= ticks; t++) {
      const y = padT + innerH - (innerH * t) / ticks;
      const v = (max * t) / ticks;
      svg += `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" />`;
      svg += `<text class="axis-text" x="${padL - 8}" y="${y + 4}" text-anchor="end">${cfg.axisFormat ? cfg.axisFormat(v) : fmtCompact(v)}</text>`;
    }
    labels.forEach((lab, i) => {
      const gx = padL + i * groupW;
      const totalBars = series.length * barW + gap * (series.length - 1);
      const start = gx + (groupW - totalBars) / 2;
      series.forEach((s, k) => {
        const v = s.values[i];
        const h = (v / max) * innerH;
        const x = start + k * (barW + gap);
        const y = padT + innerH - h;
        const r = Math.min(4, h / 2);
        // rect con esquinas superiores redondeadas
        const path = h <= 0
          ? ""
          : `M${x},${y + r} a${r},${r} 0 0 1 ${r},-${r} h${barW - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - r} h-${barW} z`;
        svg += `<path class="bar" d="${path}" fill="${s.color}" data-i="${i}" data-k="${k}" />`;
      });
      const showLabel = labels.length <= 14 || i % Math.ceil(labels.length / 12) === 0;
      if (showLabel) {
        svg += `<text class="axis-text" x="${gx + groupW / 2}" y="${H - 8}" text-anchor="middle">${escapeHtml(lab)}</text>`;
      }
    });
    svg += "</svg>";
    el.innerHTML = svg;
    const tip = makeTip(el);
    const svgEl = $("svg", el);

    function place(evt, html) {
      const rect = el.getBoundingClientRect();
      tip.innerHTML = html;
      tip.style.left = evt.clientX - rect.left + "px";
      tip.style.top = evt.clientY - rect.top + "px";
      tip.classList.add("is-visible");
    }
    svgEl.addEventListener("mousemove", (e) => {
      const bar = e.target.closest(".bar");
      if (!bar) return tip.classList.remove("is-visible");
      const i = +bar.dataset.i, k = +bar.dataset.k;
      const rows = series
        .map((s, idx) => `<div style="${idx === k ? "font-weight:700" : "opacity:.75"}">${escapeHtml(s.name)}: ${fmt(s.values[i])}</div>`)
        .join("");
      place(e, `<strong>${escapeHtml(cfg.tipLabels ? cfg.tipLabels[i] : labels[i])}</strong>${rows}`);
    });
    svgEl.addEventListener("mouseleave", () => tip.classList.remove("is-visible"));
  }

  // Líneas / área con crosshair
  function lineChart(el, cfg) {
    const W = 800, H = 260, padL = 52, padR = 12, padT = 14, padB = 30;
    const labels = cfg.labels;
    const series = cfg.series;
    const max = niceMax(Math.max(...series.flatMap((s) => s.values)) || 1);
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const n = labels.length;
    const xAt = (i) => padL + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
    const yAt = (v) => padT + innerH - (v / max) * innerH;
    const fmt = cfg.format || ((v) => formatPrice(v));
    const ticks = 4;

    let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="aspect-ratio:${W}/${H}">`;
    for (let t = 0; t <= ticks; t++) {
      const y = padT + innerH - (innerH * t) / ticks;
      svg += `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" />`;
      svg += `<text class="axis-text" x="${padL - 8}" y="${y + 4}" text-anchor="end">${fmtCompact((max * t) / ticks)}</text>`;
    }
    series.forEach((s, k) => {
      const pts = s.values.map((v, i) => `${xAt(i)},${yAt(v)}`);
      if (k === 0 && cfg.area !== false) {
        svg += `<path class="area-path" fill="${s.color}" d="M${xAt(0)},${padT + innerH} L${pts.join(" L")} L${xAt(n - 1)},${padT + innerH} Z" />`;
      }
      svg += `<path class="line-path" stroke="${s.color}" d="M${pts.join(" L")}" />`;
    });
    const step = Math.max(1, Math.ceil(n / 10));
    labels.forEach((lab, i) => {
      if (i % step === 0 || i === n - 1) {
        svg += `<text class="axis-text" x="${xAt(i)}" y="${H - 8}" text-anchor="middle">${escapeHtml(lab)}</text>`;
      }
    });
    svg += `<line class="crosshair" id="ch" x1="0" x2="0" y1="${padT}" y2="${padT + innerH}" />`;
    series.forEach((s, k) => {
      svg += `<circle class="marker" data-k="${k}" r="5" stroke="${s.color}" cx="0" cy="0" />`;
    });
    const bandW = innerW / Math.max(1, n - 1);
    labels.forEach((_, i) => {
      svg += `<rect class="hover-band" data-i="${i}" x="${xAt(i) - bandW / 2}" y="${padT}" width="${bandW}" height="${innerH}" />`;
    });
    svg += "</svg>";
    el.innerHTML = svg;
    const tip = makeTip(el);
    const svgEl = $("svg", el);
    const ch = $(".crosshair", svgEl);
    const markers = $$(".marker", svgEl);

    svgEl.addEventListener("mousemove", (e) => {
      const band = e.target.closest(".hover-band");
      if (!band) return;
      const i = +band.dataset.i;
      const x = xAt(i);
      ch.setAttribute("x1", x);
      ch.setAttribute("x2", x);
      ch.style.opacity = 1;
      markers.forEach((m, k) => {
        m.setAttribute("cx", x);
        m.setAttribute("cy", yAt(series[k].values[i]));
        m.style.opacity = 1;
      });
      const rect = el.getBoundingClientRect();
      const svgRect = svgEl.getBoundingClientRect();
      const px = svgRect.left - rect.left + (x / W) * svgRect.width;
      const py = svgRect.top - rect.top + (yAt(Math.max(...series.map((s) => s.values[i]))) / H) * svgRect.height;
      tip.innerHTML =
        `<strong>${escapeHtml(cfg.tipLabels ? cfg.tipLabels[i] : labels[i])}</strong>` +
        series.map((s) => `<div>${escapeHtml(s.name)}: ${fmt(s.values[i])}</div>`).join("");
      tip.style.left = px + "px";
      tip.style.top = py + "px";
      tip.classList.add("is-visible");
    });
    svgEl.addEventListener("mouseleave", () => {
      tip.classList.remove("is-visible");
      ch.style.opacity = 0;
      markers.forEach((m) => (m.style.opacity = 0));
    });
  }

  function sparkline(values, color) {
    const W = 120, H = 34;
    const max = Math.max(...values) || 1;
    const min = Math.min(...values);
    const n = values.length;
    const pts = values.map((v, i) => {
      const x = (W * i) / (n - 1);
      const y = H - 3 - ((v - min) / (max - min || 1)) * (H - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `<svg class="kpi-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <path d="M0,${H} L${pts.join(" L")} L${W},${H} Z" fill="${color}" opacity=".12" />
      <path d="M${pts.join(" L")}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    </svg>`;
  }

  function hbars(el, rows, opts) {
    opts = opts || {};
    const max = Math.max(...rows.map((r) => r.value)) || 1;
    const total = rows.reduce((s, r) => s + r.value, 0) || 1;
    el.innerHTML = rows
      .map(
        (r) => `
        <div class="hbar">
          <span class="hbar-label" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</span>
          <div class="hbar-track"><div class="hbar-fill" data-w="${((r.value / max) * 100).toFixed(1)}" style="background:${r.color}"></div></div>
          <span class="hbar-value">${opts.format ? opts.format(r.value) : formatPrice(r.value)}<small>${Math.round((r.value / total) * 100)}%</small></span>
        </div>`,
      )
      .join("");
    requestAnimationFrame(() =>
      $$(".hbar-fill", el).forEach((f) => (f.style.width = f.dataset.w + "%")),
    );
  }

  // =====================================================================
  //  HELPERS DE DATOS
  // =====================================================================

  const isPaid = (o) => o.status !== "pendiente" && o.status !== "cancelado";

  function ordersBetween(from, to) {
    return ORDERS.filter((o) => o.date >= from && o.date < to);
  }

  function dailyRevenue(days) {
    const labels = [], values = [], tips = [];
    for (let i = days - 1; i >= 0; i--) {
      const start = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - i);
      const end = new Date(start.getTime() + DAY);
      const sum = ordersBetween(start, end).filter(isPaid).reduce((s, o) => s + o.total, 0);
      labels.push(days <= 7 ? ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][start.getDay()] : fmtDateShort(start));
      tips.push(fmtDate(start));
      values.push(sum);
    }
    return { labels, values, tips };
  }

  function badge(map, key) {
    const s = map[key] || { label: key, cls: "is-muted" };
    return `<span class="badge ${s.cls}">${escapeHtml(s.label)}</span>`;
  }

  function avatarHtml(name, size) {
    return `<span class="avatar">${escapeHtml(initials(name))}</span>`;
  }

  // =====================================================================
  //  NOTIFICACIONES
  // =====================================================================

  const notifList = $("#notifList");
  let notifFilter = "todas";

  function unreadCount() {
    return NOTIFS.filter((n) => !isRead(n)).length;
  }

  function updateNotifBadges() {
    const c = unreadCount();
    $("#sbNotifBadge").textContent = c ? String(c) : "";
    $("#topNotifDot").textContent = c ? " " : "";
    $$("#notifChips [data-count]").forEach((el) => {
      const t = el.dataset.count;
      const n = NOTIFS.filter((x) => (t === "todas" || x.type === t) && !isRead(x)).length;
      el.textContent = n ? n : "";
      el.hidden = !n;
    });
  }

  function renderNotifs() {
    const items = NOTIFS.filter((n) => notifFilter === "todas" || n.type === notifFilter);
    if (!items.length) {
      notifList.innerHTML = `<div class="emptyState"><svg><use href="#ic-notifications" /></svg><h2>Sin notificaciones</h2><p>No hay novedades en esta categoría.</p></div>`;
      return;
    }
    const TYPE_LABEL = { venta: "Venta", reserva: "Reserva", pago: "Pago", stock: "Stock", sistema: "Sistema" };
    notifList.innerHTML = items
      .map(
        (n) => `
        <article class="notif ${isRead(n) ? "" : "is-unread"}" data-id="${n.id}">
          <span class="notif-icon is-${escapeHtml(n.type)}"><svg><use href="#ic-${escapeHtml(n.icon)}" /></svg></span>
          <div class="notif-body">
            <strong>${escapeHtml(n.title)}</strong>
            <p>${escapeHtml(n.body)}</p>
            <small>${fmtRelative(n.date)} · ${TYPE_LABEL[n.type]}</small>
          </div>
        </article>`,
      )
      .join("");
    updateNotifBadges();
  }

  function openNotification(n) {
    markRead([n.id]);
    const el = $(`.notif[data-id="${n.id}"]`, notifList);
    el && el.classList.remove("is-unread");
    updateNotifBadges();
    if (n.target && n.target.view) {
      showView(n.target.view, { tab: n.target.tab });
      if (n.target.order) openOrderDrawer(ORDERS.find((o) => o.uuid === n.target.order));
      if (n.target.reserva) openReservaDrawer(RESERVAS.find((r) => r.uuid === n.target.reserva));
      if (n.target.product && RENDERERS._editProduct) RENDERERS._editProduct(n.target.product);
    }
  }

  notifList.addEventListener("click", (e) => {
    const el = e.target.closest(".notif");
    if (el) openNotification(NOTIFS.find((x) => x.id === el.dataset.id));
  });

  $("#notifChips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    $$("#notifChips .chip").forEach((c) => c.classList.toggle("is-selected", c === chip));
    notifFilter = chip.dataset.type;
    renderNotifs();
  });

  $("#notifReadAll").addEventListener("click", () => {
    markRead(NOTIFS.filter((n) => !isRead(n)).map((n) => n.id));
    renderNotifs();
    toast("Todas las notificaciones quedaron como leídas", "ok");
  });

  // =====================================================================
  //  DASHBOARD
  // =====================================================================

  function renderDashboard() {
    const monthStart = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
    const prevStart = new Date(TODAY.getFullYear(), TODAY.getMonth() - 1, 1);
    const prevSame = new Date(TODAY.getFullYear(), TODAY.getMonth() - 1, TODAY.getDate() + 1);

    const cur = ordersBetween(monthStart, new Date(TODAY.getTime() + DAY)).filter(isPaid);
    const prev = ordersBetween(prevStart, prevSame).filter(isPaid);
    const curRev = cur.reduce((s, o) => s + o.total, 0);
    const prevRev = prev.reduce((s, o) => s + o.total, 0);
    const ticket = cur.length ? Math.round(curRev / cur.length) : 0;
    const prevTicket = prev.length ? Math.round(prevRev / prev.length) : 0;
    const activeRes = RESERVAS.filter((r) => r.status === "activa" || r.status === "por-vencer").length;
    const pending = ORDERS.filter((o) => o.status === "pendiente").length;

    // Variación vs. el mes anterior; sin datos previos no hay porcentaje que mostrar
    const delta = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
    const spark = dailyRevenue(14).values;
    const sparkOrders = (() => {
      const arr = [];
      for (let i = 13; i >= 0; i--) {
        const s = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - i);
        arr.push(ordersBetween(s, new Date(s.getTime() + DAY)).length);
      }
      return arr;
    })();

    // d: variación % (null = sin mes anterior) · sub: texto alternativo · sparkVals: mini gráfico
    const kpi = (icon, label, value, d, sparkVals, money, sub) => {
      let line;
      if (typeof d === "number") {
        line = `<span class="kpi-delta ${d >= 0 ? "is-up" : "is-down"}"><svg><use href="#ic-${d >= 0 ? "trending_up" : "trending_down"}" /></svg><strong>${d >= 0 ? "+" : ""}${Math.abs(d) > 999 ? ">999" : d}%</strong> vs. mes anterior</span>`;
      } else {
        line = `<span class="kpi-delta">${sub || "Sin datos del mes anterior"}</span>`;
      }
      return `
      <div class="kpi">
        <div class="kpi-head"><span>${label}</span><svg><use href="#ic-${icon}" /></svg></div>
        <div class="kpi-value ${money ? "is-money" : ""}">${value}</div>
        ${line}
        ${Array.isArray(sparkVals) && sparkVals.some((v) => v > 0) ? sparkline(sparkVals, "#3b82f6") : ""}
      </div>`;
    };

    $("#kpis").innerHTML =
      kpi("payments", "Ingresos del mes", formatPrice(curRev), delta(curRev, prevRev), spark, true) +
      kpi("orders", "Órdenes del mes", cur.length, delta(cur.length, prev.length), sparkOrders) +
      kpi("point_of_sale", "Ticket promedio", formatPrice(ticket), delta(ticket, prevTicket), null, true) +
      kpi("event", "Reservas activas", activeRes, null, null, false, `${pending} órdenes pendientes de pago`);

    // Ingresos con rango
    const revEl = $("#revenueChart");
    function drawRevenue(days) {
      const d = dailyRevenue(days);
      lineChart(revEl, {
        labels: d.labels,
        tipLabels: d.tips,
        series: [{ name: "Ingresos", color: "#3b82f6", values: d.values }],
        format: (v) => "$" + formatPrice(v),
      });
    }
    drawRevenue(7);
    $("#revenueRange").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      $$("#revenueRange button").forEach((x) => x.classList.toggle("is-active", x === b));
      drawRevenue(+b.dataset.days);
    };

    // Más vendidos (mes)
    const sold = {};
    cur.forEach((o) =>
      o.items.forEach((it) => {
        sold[it.product.id] = sold[it.product.id] || { p: it.product, qty: 0, rev: 0 };
        sold[it.product.id].qty += it.qty;
        sold[it.product.id].rev += it.qty * it.price;
      }),
    );
    const top = Object.values(sold).sort((a, b) => b.rev - a.rev).slice(0, 5);
    $("#topProducts").innerHTML = (top.length ? top : [])
      .map(
        (t, i) => `
        <div class="list-item">
          <span class="rank ${i === 0 ? "is-top" : ""}">${i + 1}</span>
          <span class="thumb">${t.p.img ? `<img src="${t.p.img}" alt="" />` : '<svg><use href="#ic-image" /></svg>'}</span>
          <div class="body"><strong>${escapeHtml(t.p.name)}</strong><small>${t.qty} vendido${t.qty === 1 ? "" : "s"}</small></div>
          <span class="val is-money">${formatPrice(t.rev)}</span>
        </div>`,
      )
      .join("") || `<p style="color:var(--ink-soft);font-size:13.5px;margin:0">Todavía no hay ventas este mes.</p>`;

    // Órdenes recientes
    $("#recentOrders").innerHTML =
      `<thead><tr><th>Orden</th><th>Cliente</th><th>Fecha</th><th>Estado</th><th class="num">Total</th></tr></thead><tbody>` +
      (ORDERS.length ? ORDERS.slice(0, 6) : [])
        .map(
          (o) => `
          <tr class="is-clickable" data-order="${o.id}">
            <td class="mono">${o.id}</td>
            <td>${escapeHtml(o.customer.name)}</td>
            <td class="muted">${fmtRelative(o.date)}</td>
            <td>${badge(ORDER_STATUS, o.status)}</td>
            <td class="num is-money">${formatPrice(o.total)}</td>
          </tr>`,
        )
        .join("") +
      (ORDERS.length ? "" : `<tr><td colspan="5" class="table-empty">Todavía no hay órdenes.</td></tr>`) +
      "</tbody>";

    // Próximas reservas
    const upcoming = RESERVAS.filter((r) => r.status === "activa" || r.status === "por-vencer")
      .sort((a, b) => a.expires - b.expires)
      .slice(0, 4);
    $("#upcomingReservas").innerHTML = upcoming.length
      ? upcoming
          .map(
            (r) => `
          <div class="list-item is-clickable" data-reserva="${r.id}" style="cursor:pointer">
            <span class="thumb">${r.product.img ? `<img src="${r.product.img}" alt="" />` : ""}</span>
            <div class="body"><strong>${escapeHtml(r.customer.name)}</strong><small>${escapeHtml(r.product.name)}</small></div>
            <div style="text-align:right">${badge(RESERVA_STATUS, r.status)}<small class="muted" style="display:block;font-size:11.5px;color:var(--ink-soft);margin-top:3px">vence ${fmtDateShort(r.expires)}</small></div>
          </div>`,
          )
          .join("")
      : `<p style="color:var(--ink-soft);font-size:13.5px;margin:0">No hay reservas activas.</p>`;

    // Stock bajo
    const low = PRODUCTS.filter((p) => p.status === "publicado" && p.stock <= p.stockMin).slice(0, 4);
    $("#lowStock").innerHTML = (low.length ? low : [])
      .map(
        (p) => `
        <div class="stock-alert">
          <svg><use href="#ic-warning" /></svg>
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.name)}</span>
          <strong>${p.stock === 0 ? "Sin stock" : p.stock + " u."}</strong>
        </div>`,
      )
      .join("") || `<p style="color:var(--ink-soft);font-size:13.5px;margin:0">Todo el stock está por encima del mínimo.</p>`;
  }

  document.addEventListener("click", (e) => {
    const row = e.target.closest("[data-order]");
    if (row && !e.target.closest("button")) {
      openOrderDrawer(ORDERS.find((o) => o.id === row.dataset.order));
      return;
    }
    const rr = e.target.closest("[data-reserva]");
    if (rr && !e.target.closest("button")) {
      openReservaDrawer(RESERVAS.find((r) => r.id === rr.dataset.reserva));
      return;
    }
    const rp = e.target.closest("[data-product]");
    if (rp && !e.target.closest("button")) {
      openProductDrawer(PRODUCTS.find((p) => p.id === rp.dataset.product));
    }
  });

  // =====================================================================
  //  ANALÍTICAS
  // =====================================================================

  function renderAnalytics() {
    function monthly(months) {
      const labels = [], sales = [], res = [], tips = [], revenue = [];
      for (let i = months - 1; i >= 0; i--) {
        const start = new Date(TODAY.getFullYear(), TODAY.getMonth() - i, 1);
        const end = new Date(TODAY.getFullYear(), TODAY.getMonth() - i + 1, 1);
        const os = ordersBetween(start, end).filter(isPaid);
        labels.push(MONTHS[start.getMonth()]);
        tips.push(`${MONTHS_LONG[start.getMonth()]} ${start.getFullYear()}`);
        sales.push(os.length);
        revenue.push(os.reduce((s, o) => s + o.total, 0));
        res.push(RESERVAS.filter((r) => r.date >= start && r.date < end).length);
      }
      return { labels, sales, res, tips, revenue };
    }

    const el = $("#monthlyChart");
    function draw(months) {
      const m = monthly(months);
      barChart(el, {
        labels: m.labels,
        tipLabels: m.tips,
        series: [
          { name: "Ventas", color: "#3b82f6", values: m.sales },
          { name: "Reservas", color: "#9333ea", values: m.res },
        ],
        format: (v) => v + " órdenes",
        axisFormat: (v) => Math.round(v),
      });
      const totalRev = m.revenue.reduce((a, b) => a + b, 0);
      const totalOrders = m.sales.reduce((a, b) => a + b, 0);
      const paid = ORDERS.filter(isPaid);
      const units = paid.reduce((s, o) => s + o.items.reduce((x, it) => x + it.qty, 0), 0);
      const cancel = ORDERS.filter((o) => o.status === "cancelado").length;
      const kpi = (icon, label, value, sub, money) => `
        <div class="kpi">
          <div class="kpi-head"><span>${label}</span><svg><use href="#ic-${icon}" /></svg></div>
          <div class="kpi-value ${money ? "is-money" : ""}">${value}</div>
          <span class="kpi-delta">${sub}</span>
        </div>`;
      $("#analyticsKpis").innerHTML =
        kpi("payments", `Facturado (${months} meses)`, formatPrice(totalRev), `${totalOrders} órdenes pagadas`, true) +
        kpi("inventory_2", "Unidades vendidas", units, "en todo el período") +
        kpi("group", "Clientes únicos", new Set(paid.map((o) => o.customer.id)).size, `${paid.length ? Math.round((paid.length / new Set(paid.map((o) => o.customer.id)).size) * 10) / 10 : 0} órdenes por cliente`) +
        kpi("cancel", "Tasa de cancelación", `${ORDERS.length ? Math.round((cancel / ORDERS.length) * 100) : 0}%`, `${cancel} de ${ORDERS.length} órdenes`);
    }
    draw(12);
    $("#analyticsRange").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      $$("#analyticsRange button").forEach((x) => x.classList.toggle("is-active", x === b));
      draw(+b.dataset.months);
    };

    // Categorías
    const byCat = {};
    ORDERS.filter(isPaid).forEach((o) =>
      o.items.forEach((it) => (byCat[it.product.cat] = (byCat[it.product.cat] || 0) + it.price * it.qty)),
    );
    const catColors = ["#3b82f6", "#ea580c", "#059669", "#9333ea", "#db2777", "#0891b2"];
    hbars(
      $("#categoryBars"),
      Object.entries(byCat)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v], i) => ({ label: (CATEGORIES[k] || { label: "Otros" }).label, value: v, color: catColors[i % catColors.length] })),
      { format: (v) => "$" + fmtCompact(v) },
    );

    // Medios de pago
    const byPay = {};
    ORDERS.forEach((o) => (byPay[o.payment] = (byPay[o.payment] || 0) + 1));
    hbars(
      $("#paymentBars"),
      Object.entries(byPay)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v], i) => ({ label: PAYMENTS[k].label, value: v, color: catColors[i % catColors.length] })),
      { format: (v) => v },
    );

    // Horas pico
    const hours = new Array(24).fill(0);
    ORDERS.forEach((o) => hours[o.date.getHours()]++);
    const hLabels = [], hVals = [];
    for (let h = 8; h <= 23; h++) {
      hLabels.push(pad(h) + "h");
      hVals.push(hours[h]);
    }
    barChart($("#hoursChart"), {
      labels: hLabels,
      series: [{ name: "Órdenes", color: "#3b82f6", values: hVals }],
      format: (v) => v + " órdenes",
      axisFormat: (v) => Math.round(v),
    });

    // Ticket promedio por semana (últimas 8 semanas)
    const wLabels = [], tickets = [];
    for (let i = 7; i >= 0; i--) {
      const start = new Date(TODAY.getTime() - (i + 1) * 7 * DAY);
      const end = new Date(TODAY.getTime() - i * 7 * DAY);
      const os = ordersBetween(start, end).filter(isPaid);
      wLabels.push("sem " + (8 - i));
      tickets.push(os.length ? Math.round(os.reduce((s, o) => s + o.total, 0) / os.length) : 0);
    }
    lineChart($("#conversionChart"), {
      labels: wLabels,
      series: [{ name: "Ticket promedio", color: "#3b82f6", values: tickets }],
      format: (v) => "$" + formatPrice(v),
    });

    // Rendimiento por producto
    const perf = {};
    ORDERS.filter(isPaid).forEach((o) =>
      o.items.forEach((it) => {
        perf[it.product.id] = perf[it.product.id] || { p: it.product, qty: 0, rev: 0, orders: 0 };
        perf[it.product.id].qty += it.qty;
        perf[it.product.id].rev += it.qty * it.price;
        perf[it.product.id].orders++;
      }),
    );
    const rows = Object.values(perf).sort((a, b) => b.rev - a.rev).slice(0, 8);
    const maxRev = rows[0] ? rows[0].rev : 1;
    $("#productPerf").innerHTML =
      `<thead><tr><th>Producto</th><th>Categoría</th><th class="num">Unidades</th><th class="num">Órdenes</th><th class="num">Stock</th><th class="num">Facturación</th><th style="width:160px"></th></tr></thead><tbody>` +
      rows
        .map(
          (r) => `
          <tr>
            <td class="ellipsis" title="${escapeHtml(r.p.name)}">${escapeHtml(r.p.name)}</td>
            <td class="muted">${(CATEGORIES[r.p.cat] || { label: "—" }).label}</td>
            <td class="num">${r.qty}</td>
            <td class="num">${r.orders}</td>
            <td class="num">${(() => { const cur = PRODUCTS.find((p) => p.id === r.p.id); const st = cur ? cur.stock : "—"; return st === 0 ? '<span class="badge is-bad">0</span>' : cur && st <= cur.stockMin ? `<span class="badge is-warn">${st}</span>` : st; })()}</td>
            <td class="num is-money">${formatPrice(r.rev)}</td>
            <td><div class="hbar-track"><div class="hbar-fill" style="width:${((r.rev / maxRev) * 100).toFixed(1)}%;background:var(--chart-1)"></div></div></td>
          </tr>`,
        )
        .join("") +
      "</tbody>";

    $("#exportAnalytics").onclick = () => {
      const lines = [["Producto", "Categoria", "Unidades", "Ordenes", "Stock", "Facturacion"]];
      Object.values(perf).forEach((r) =>
        lines.push([r.p.name, (CATEGORIES[r.p.cat] || { label: "" }).label, r.qty, r.orders, (PRODUCTS.find((p) => p.id === r.p.id) || {}).stock ?? "", r.rev]),
      );
      downloadFile("analiticas-productos.csv", lines.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n"), "text/csv");
      toast("CSV exportado", "ok");
    };
  }

  function downloadFile(name, content, type) {
    const blob = new Blob(["﻿" + content], { type: type + ";charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  // =====================================================================
  //  ÓRDENES
  // =====================================================================

  function renderOrders() {
    $("#ventasCount").textContent = ORDERS.length;
    $("#reservasCount").textContent = RESERVAS.length;

    const search = $("#ordersSearch"), status = $("#ordersStatus"), pay = $("#ordersPayment");
    function draw() {
      const q = normalize(search.value);
      const rows = ORDERS.filter((o) => {
        if (status.value && o.status !== status.value) return false;
        if (pay.value && o.payment !== pay.value) return false;
        if (q) {
          const hay = normalize(o.id + " " + o.customer.name + " " + o.customer.email + " " + o.items.map((i) => i.product.name).join(" "));
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      $("#ordersResult").textContent = `${rows.length} de ${ORDERS.length} órdenes`;
      const pageSize = +(store.get("prefs", {}).pageSize || 25);
      $("#ordersTable").innerHTML =
        `<thead><tr><th>Orden</th><th>Cliente</th><th>Productos</th><th>Fecha</th><th>Pago</th><th>Estado</th><th class="num">Total</th></tr></thead><tbody>` +
        (rows.length
          ? rows
              .slice(0, pageSize)
              .map(
                (o) => `
            <tr class="is-clickable" data-order="${o.id}">
              <td class="mono">${o.id}</td>
              <td><div class="cell-user">${avatarHtml(o.customer.name)}<div><span>${escapeHtml(o.customer.name)}</span><small>${escapeHtml(o.customer.email)}</small></div></div></td>
              <td class="ellipsis" title="${escapeHtml(o.items.map((i) => i.product.name).join(", "))}">${escapeHtml(o.items[0].product.name)}${o.items.length > 1 ? ` <span class="muted">+${o.items.length - 1}</span>` : ""}</td>
              <td class="muted">${fmtDateTime(o.date)}</td>
              <td class="muted">${(PAYMENTS[o.payment] || { label: o.payment }).label}</td>
              <td>${badge(ORDER_STATUS, o.status)}</td>
              <td class="num is-money">${formatPrice(o.total)}</td>
            </tr>`,
              )
              .join("")
          : `<tr><td colspan="7" class="table-empty">No hay órdenes que coincidan con los filtros.</td></tr>`) +
        "</tbody>" +
        (rows.length > pageSize ? `<tfoot><tr><td colspan="7" class="muted" style="text-align:center">Mostrando ${pageSize} de ${rows.length}. Refiná la búsqueda para ver el resto.</td></tr></tfoot>` : "");
    }
    [search, status, pay].forEach((el) => (el.oninput = draw));
    draw();

    // Reservas
    const rSearch = $("#reservasSearch"), rStatus = $("#reservasStatus");
    function drawRes() {
      const q = normalize(rSearch.value);
      const rows = RESERVAS.filter((r) => {
        if (rStatus.value && r.status !== rStatus.value) return false;
        if (q && !normalize(r.id + " " + r.customer.name + " " + r.product.name).includes(q)) return false;
        return true;
      });
      $("#reservasResult").textContent = `${rows.length} de ${RESERVAS.length} reservas`;
      $("#reservasTable").innerHTML =
        `<thead><tr><th>Reserva</th><th>Cliente</th><th>Producto</th><th>Reservado</th><th>Vence</th><th class="num">Seña</th><th>Estado</th></tr></thead><tbody>` +
        (rows.length
          ? rows
              .map(
                (r) => `
            <tr class="is-clickable" data-reserva="${r.id}">
              <td class="mono">${r.id}</td>
              <td><div class="cell-user">${avatarHtml(r.customer.name)}<div><span>${escapeHtml(r.customer.name)}</span><small>${escapeHtml(r.customer.phone)}</small></div></div></td>
              <td class="ellipsis" title="${escapeHtml(r.product.name)}">${escapeHtml(r.product.name)}</td>
              <td class="muted">${fmtDateTime(r.date)}</td>
              <td class="muted">${fmtDate(r.expires)}</td>
              <td class="num is-money">${formatPrice(r.deposit)}</td>
              <td>${badge(RESERVA_STATUS, r.status)}</td>
            </tr>`,
              )
              .join("")
          : `<tr><td colspan="7" class="table-empty">No hay reservas que coincidan.</td></tr>`) +
        "</tbody>";
    }
    [rSearch, rStatus].forEach((el) => (el.oninput = drawRes));
    drawRes();
    RENDERERS._redrawOrders = () => {
      $("#ventasCount").textContent = ORDERS.length;
      $("#reservasCount").textContent = RESERVAS.length;
      draw();
      drawRes();
    };
  }

  // =====================================================================
  //  PRODUCTOS
  // =====================================================================

  const PRODUCT_STATUS = {
    publicado: { label: "Publicado", cls: "is-ok" },
    borrador: { label: "Borrador", cls: "is-warn" },
    pausado: { label: "Pausado", cls: "is-muted" },
  };
  const CONDITION_LABEL = { nuevo: "Nuevo", reacondicionado: "Reacondicionado", usado: "Usado" };
  const DELIVERY_LABEL = { "24-48hs": "24 / 48 hs", "3-5": "3 a 5 días hábiles", "7-10": "7 a 10 días hábiles", "a-pedido": "A pedido (consultar)" };
  const WARRANTY_UNIT = { dias: "días", meses: "meses", anios: "años" };

  function stockBadge(p) {
    if (p.stock === 0) return '<span class="badge is-bad">Sin stock</span>';
    if (p.stock <= p.stockMin) return `<span class="badge is-warn">${p.stock} u.</span>`;
    return `<span class="badge is-ok is-plain">${p.stock} u.</span>`;
  }

  function renderProducts() {
    const search = $("#productsSearch"), cat = $("#productsCat"), status = $("#productsStatus"), stk = $("#productsStock");
    if (cat.options.length === 1)
      Object.entries(CATEGORIES).forEach(([k, v]) => {
        const o = document.createElement("option");
        o.value = k;
        o.textContent = v.label;
        cat.appendChild(o);
      });
    function draw() {
      const q = normalize(search.value);
      const rows = PRODUCTS.filter((p) => {
        if (cat.value && p.cat !== cat.value) return false;
        if (status.value && p.status !== status.value) return false;
        if (stk.value === "sin" && p.stock !== 0) return false;
        if (stk.value === "bajo" && !(p.stock > 0 && p.stock <= p.stockMin)) return false;
        if (stk.value === "ok" && !(p.stock > p.stockMin)) return false;
        if (q && !normalize(p.name + " " + p.sku + " " + (p.brand || "") + " " + (p.sub || "")).includes(q)) return false;
        return true;
      });
      const units = rows.reduce((a, p) => a + (p.stock || 0), 0);
      $("#productsResult").textContent = `${rows.length} de ${PRODUCTS.length} productos · ${units} unidades`;
      const pageSize = +(store.get("prefs", {}).pageSize || 25);
      $("#productsTable").innerHTML =
        `<thead><tr><th>Producto</th><th>SKU</th><th>Categoría</th><th>Estado</th><th class="num">Precio</th><th class="num">Stock</th><th class="num">Mínimo</th></tr></thead><tbody>` +
        (rows.length
          ? rows
              .slice(0, pageSize)
              .map(
                (p) => `
            <tr class="is-clickable" data-product="${p.id}">
              <td><div class="cell-user"><span class="thumb">${p.img ? `<img src="${escapeHtml(p.img)}" alt="" />` : '<svg><use href="#ic-image" /></svg>'}</span><div><span>${escapeHtml(p.name)}</span><small>${escapeHtml(p.brand || "")}</small></div></div></td>
              <td class="mono">${escapeHtml(p.sku)}</td>
              <td class="muted">${(CATEGORIES[p.cat] || { label: "—" }).label}${p.sub ? ` <span class="muted">· ${escapeHtml(p.sub)}</span>` : ""}</td>
              <td>${badge(PRODUCT_STATUS, p.status)}</td>
              <td class="num is-money">${formatPrice(p.price)}</td>
              <td class="num">${stockBadge(p)}</td>
              <td class="num muted">${p.stockMin}</td>
            </tr>`,
              )
              .join("")
          : `<tr><td colspan="7" class="table-empty">No hay productos que coincidan con los filtros.</td></tr>`) +
        "</tbody>" +
        (rows.length > pageSize ? `<tfoot><tr><td colspan="7" class="muted" style="text-align:center">Mostrando ${pageSize} de ${rows.length}. Refiná la búsqueda para ver el resto.</td></tr></tfoot>` : "");
    }
    [search, cat, status, stk].forEach((el) => (el.oninput = draw));
    draw();
    RENDERERS._redrawProducts = draw;
  }

  function openProductDrawer(p) {
    if (!p) return;
    const r = p.raw || {};
    drawerOpen = { type: "product", uuid: p.id };
    drawerTitle.textContent = p.name;
    const imgs = p.images || [];
    drawerBody.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <span style="display:flex;gap:6px;flex-wrap:wrap">${badge(PRODUCT_STATUS, p.status)}${stockBadge(p)}${p.featured ? '<span class="badge is-info is-plain">Destacado</span>' : ""}</span>
        <span class="muted" style="font-size:13px;color:var(--ink-soft)">Creado ${fmtDate(p.createdAt)}</span>
      </div>
      ${imgs.length ? `<div class="product-gallery">${imgs.map((u) => `<a href="${escapeHtml(u)}" target="_blank" rel="noopener"><img src="${escapeHtml(u)}" alt="" /></a>`).join("")}</div>` : ""}
      <div>
        <h4>Datos</h4>
        <dl class="kv">
          <dt>SKU</dt><dd><span class="mono">${escapeHtml(p.sku)}</span></dd>
          <dt>Marca</dt><dd>${escapeHtml(p.brand || "—")}</dd>
          <dt>Categoría</dt><dd>${(CATEGORIES[p.cat] || { label: "—" }).label}${p.sub ? " · " + escapeHtml(p.sub) : ""}</dd>
          <dt>Condición</dt><dd>${CONDITION_LABEL[r.condition] || r.condition || "—"}</dd>
          <dt>Garantía</dt><dd>${r.warranty ? `${r.warranty} ${WARRANTY_UNIT[r.warranty_unit] || r.warranty_unit || "meses"}` : "—"}</dd>
          <dt>Etiquetas</dt><dd>${(r.tags || []).length ? r.tags.map((t) => `<span class="badge is-muted is-plain">${escapeHtml(t)}</span>`).join(" ") : "—"}</dd>
        </dl>
      </div>
      <div>
        <h4>Stock</h4>
        <dl class="kv">
          <dt>Disponible</dt><dd><strong>${p.stock}</strong> unidades</dd>
          <dt>Mínimo</dt><dd>${p.stockMin}</dd>
          <dt>Ajustar</dt><dd><span class="stock-adjust"><input type="number" min="0" step="1" id="drawerStock" value="${p.stock}" /><button class="btn btn-secondary is-sm" type="button" id="drawerStockSave">Guardar</button></span></dd>
        </dl>
      </div>
      <div>
        <h4>Precio</h4>
        <dl class="kv">
          <dt>Venta</dt><dd><strong style="font-family:var(--font-display);font-size:16px">$${formatPrice(p.price)}</strong></dd>
          ${r.on_sale && r.old_price ? `<dt>Antes</dt><dd><s>$${formatPrice(r.old_price)}</s> · ${Math.round((1 - p.price / r.old_price) * 100)}% off</dd>` : ""}
          <dt>Costo</dt><dd>${p.cost ? "$" + formatPrice(p.cost) : "—"}</dd>
          <dt>Margen</dt><dd>${p.cost && p.price ? Math.round((1 - p.cost / p.price) * 100) + "%" : "—"}</dd>
        </dl>
      </div>
      <div>
        <h4>Envío</h4>
        <dl class="kv">
          <dt>Envío gratis</dt><dd>${r.free_shipping ? "Sí" : "No"}</dd>
          <dt>Entrega</dt><dd>${DELIVERY_LABEL[r.delivery] || r.delivery || "—"}</dd>
          <dt>Peso</dt><dd>${r.weight ? `${r.weight} ${r.weight_unit || "kg"}` : "—"}</dd>
          <dt>Dimensiones</dt><dd>${r.dimensions ? `${escapeHtml(r.dimensions)} ${r.dimensions_unit || "cm"}` : "—"}</dd>
        </dl>
      </div>
      <div>
        <h4>Descripción</h4>
        <p class="product-desc">${escapeHtml(r.description || "—")}</p>
      </div>
      ${(r.highlights || []).length ? `<div><h4>Destacados</h4><ul class="product-highlights">${r.highlights.map((h) => `<li>${escapeHtml(h)}</li>`).join("")}</ul></div>` : ""}
      ${(r.specs || []).length ? `<div><h4>Especificaciones</h4><dl class="kv">${r.specs.map((sp) => `<dt>${escapeHtml(sp.k)}</dt><dd>${escapeHtml(sp.v)}</dd>`).join("")}</dl></div>` : ""}`;
    drawerFoot.innerHTML = `
      <button class="btn btn-secondary is-sm" type="button" id="drawerEditProduct"><svg><use href="#ic-edit" /></svg>Editar</button>
      <a class="btn btn-ghost is-sm" href="${storeUrl("/detail.html?id=" + encodeURIComponent(p.id))}" target="_blank" rel="noopener"><svg><use href="#ic-open_in_new" /></svg>Ver en la tienda</a>`;
    openDrawer();

    $("#drawerEditProduct").addEventListener("click", () => {
      closeDrawer();
      showView("cargas");
      RENDERERS._editProduct && RENDERERS._editProduct(p.id);
    });
    $("#drawerStockSave").addEventListener("click", async () => {
      const v = Math.max(0, Math.round(+$("#drawerStock").value || 0));
      if (v === p.stock) return;
      const { error } = await sb.from("products").update({ stock: v }).eq("id", p.id);
      if (error) return toast(error.message, "error");
      toast(`Stock de ${p.name} actualizado a ${v}`, "success");
    });
  }

  // ---- Drawer ----
  const drawer = $("#drawer"), drawerBackdrop = $("#drawerBackdrop");
  const drawerTitle = $("#drawerTitle"), drawerBody = $("#drawerBody"), drawerFoot = $("#drawerFoot");

  function openDrawer() {
    drawer.classList.add("is-open");
    drawerBackdrop.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
  }
  function closeDrawer() {
    drawer.classList.remove("is-open");
    drawerBackdrop.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
  }
  $("#drawerClose").addEventListener("click", closeDrawer);
  drawerBackdrop.addEventListener("click", closeDrawer);

  const NEXT_STATUS = { pendiente: "pagado", pagado: "preparando", preparando: "enviado" };
  const NEXT_LABEL = { pendiente: "Marcar como pagado", pagado: "Pasar a preparación", preparando: "Marcar como despachado" };

  // Pide el código de seguimiento del correo antes de marcar como despachado
  function trackingModal(o) {
    return new Promise((resolve) => {
      openModal(`
        <h3>Despachar ${escapeHtml(o.id)}</h3>
        <p>Ingresá el código de seguimiento del correo. El cliente lo ve en "Seguimiento" del pedido y recibe un aviso.</p>
        <label class="field" style="margin-top:12px">
          <span>Código de seguimiento</span>
          <input type="text" id="trackingInput" placeholder="Ej: AB123456789AR" value="${escapeHtml(o.tracking || "")}" autocomplete="off" />
          <span class="field-help">Podés dejarlo vacío y cargarlo después.</span>
        </label>
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" data-close>Cancelar</button>
          <button class="btn btn-secondary" type="button" id="modalOk"><svg><use href="#ic-check_circle" /></svg>Marcar como despachado</button>
        </div>`);
      setTimeout(() => $("#trackingInput").focus(), 50);
      $("#modalOk").addEventListener("click", () => {
        const code = $("#trackingInput").value.trim();
        closeModal();
        resolve({ ok: true, code });
      });
      $$("[data-close]", modal).forEach((b) => b.addEventListener("click", () => resolve({ ok: false })));
    });
  }

  function orderTimeline(o) {
    const steps = ["pendiente", "pagado", "preparando", "enviado"];
    const idx = o.status === "cancelado" ? -1 : steps.indexOf(o.status);
    const labels = { pendiente: "Orden creada", pagado: "Pago confirmado", preparando: "En preparación", enviado: "Despachado" };
    const when = (st) => {
      const ev = o.events.find((e) => e.status === st);
      return ev ? `<small>${fmtDateTime(new Date(ev.created_at))}${ev.note ? " · " + escapeHtml(ev.note) : ""}</small>` : "";
    };
    let html = "";
    steps.forEach((s, i) => {
      const done = i <= idx;
      html += `<li class="${done ? "" : "is-pending"}">${labels[s]}${done ? when(s) : ""}</li>`;
    });
    if (o.status === "cancelado") {
      html = `<li>Orden creada<small>${fmtDateTime(o.date)}</small></li>`;
      o.events.filter((e) => e.status !== "pendiente" && e.status !== "cancelado").forEach((e) => (html += `<li>${labels[e.status] || e.status}<small>${fmtDateTime(new Date(e.created_at))}</small></li>`));
      html += `<li style="color:var(--bad)">Cancelada${when("cancelado")}</li>`;
    }
    return `<ul class="timeline">${html}</ul>`;
  }

  // Qué hay abierto en el drawer (para refrescarlo cuando llegan cambios)
  let drawerOpen = null;

  function openOrderDrawer(o) {
    if (!o) return;
    drawerOpen = { type: "order", uuid: o.uuid };
    drawerTitle.textContent = `Orden ${o.id}`;
    drawerBody.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        ${badge(ORDER_STATUS, o.status)}
        <span class="muted" style="font-size:13px;color:var(--ink-soft)">${fmtDateTime(o.date)}</span>
      </div>
      <div>
        <h4>Cliente</h4>
        <dl class="kv">
          <dt>Nombre</dt><dd>${escapeHtml(o.customer.name)}</dd>
          <dt>Email</dt><dd>${escapeHtml(o.customer.email)}</dd>
          <dt>Teléfono</dt><dd>${escapeHtml(o.customer.phone)}</dd>
          <dt>DNI</dt><dd>${escapeHtml(o.customer.dni)}</dd>
        </dl>
      </div>
      <div>
        <h4>Productos</h4>
        <div class="list">
          ${o.items
            .map(
              (it) => `
            <div class="list-item">
              <span class="thumb">${it.product.img ? `<img src="${it.product.img}" alt="" />` : '<svg><use href="#ic-image" /></svg>'}</span>
              <div class="body"><strong>${escapeHtml(it.product.name)}</strong><small>x${it.qty} · $${formatPrice(it.price)} c/u${it.product.sku ? " · SKU " + escapeHtml(it.product.sku) : ""}</small></div>
              <span class="val is-money">${formatPrice(it.price * it.qty)}</span>
            </div>`,
            )
            .join("")}
        </div>
      </div>
      <div>
        <h4>Pago y envío</h4>
        <dl class="kv">
          <dt>Medio de pago</dt><dd>${(PAYMENTS[o.payment] || { label: o.payment }).label}${o.installments > 1 ? ` · ${o.installments} cuotas` : ""}</dd>
          <dt>Entrega</dt><dd>Envío a domicilio · ${escapeHtml(o.customer.address)}</dd>
          <dt>Subtotal</dt><dd>$${formatPrice(o.subtotal)}</dd>
          <dt>Envío</dt><dd>${o.shipping ? "$" + formatPrice(o.shipping) : "Gratis"}</dd>
          ${o.surcharge ? `<dt>Recargo</dt><dd>$${formatPrice(o.surcharge)}</dd>` : ""}
          <dt><strong>Total</strong></dt><dd><strong style="font-family:var(--font-display);font-size:16px">$${formatPrice(o.total)}</strong></dd>
          ${o.status === "enviado" ? `<dt>Seguimiento</dt><dd>${o.tracking ? `<span class="mono">${escapeHtml(o.tracking)}</span>` : '<span class="muted">Sin código</span>'} <button class="btn-text" type="button" id="editTracking" style="margin-left:6px">Editar</button></dd>` : ""}
        </dl>
      </div>
      <div>
        <h4>Seguimiento</h4>
        ${orderTimeline(o)}
      </div>`;
    const inv = INVOICES.find((i) => i.order && i.order.uuid === o.uuid);
    const rec = RECEIPTS.find((r) => r.order && r.order.uuid === o.uuid);
    drawerFoot.innerHTML = `
      ${NEXT_STATUS[o.status] ? `<button class="btn btn-secondary is-sm" type="button" id="advanceOrder"><svg><use href="#ic-check_circle" /></svg>${NEXT_LABEL[o.status]}</button>` : ""}
      ${inv ? `<button class="btn btn-ghost is-sm" type="button" id="drawerInvoice"><svg><use href="#ic-receipt_long" /></svg>Nota de venta</button>` : ""}
      ${rec ? `<button class="btn btn-ghost is-sm" type="button" id="drawerReceipt"><svg><use href="#ic-account_balance" /></svg>Comprobante</button>` : ""}
      ${o.status !== "cancelado" && o.status !== "enviado" ? `<button class="btn btn-danger is-sm" type="button" id="cancelOrder" style="margin-left:auto"><svg><use href="#ic-cancel" /></svg>Cancelar</button>` : ""}`;
    openDrawer();

    const adv = $("#advanceOrder");
    if (adv)
      adv.addEventListener("click", async () => {
        const next = NEXT_STATUS[o.status];
        let tracking = null;
        if (next === "enviado") {
          const r = await trackingModal(o);
          if (!r.ok) return;
          tracking = r.code;
        }
        adv.disabled = true;
        try {
          await setOrderStatus(o, next, "", tracking);
          toast(`${o.id}: ${ORDER_STATUS[next].label}`, "ok");
        } catch (err) {
          toast(err.message, "bad");
          adv.disabled = false;
        }
      });
    const editTr = $("#editTracking");
    if (editTr)
      editTr.addEventListener("click", async () => {
        const r = await trackingModal(o);
        if (!r.ok) return;
        try {
          await setOrderStatus(o, "enviado", "", r.code);
          toast("Código de seguimiento actualizado", "ok");
        } catch (err) {
          toast(err.message, "bad");
        }
      });
    const inv2 = $("#drawerInvoice");
    if (inv2) inv2.addEventListener("click", () => previewInvoice(inv));
    const rec2 = $("#drawerReceipt");
    if (rec2) rec2.addEventListener("click", () => previewReceipt(rec));
    const cancel = $("#cancelOrder");
    if (cancel)
      cancel.addEventListener("click", async () => {
        const ok = await confirmModal({
          title: `Cancelar ${o.id}`,
          text: "La orden pasará a estado cancelado y se notificará al cliente. Esta acción no se puede deshacer.",
          okText: "Cancelar orden",
          danger: true,
        });
        if (!ok) return;
        try {
          await setOrderStatus(o, "cancelado", "Cancelada desde el panel");
          toast(`${o.id} cancelada`, "bad");
        } catch (err) {
          toast(err.message, "bad");
        }
      });
  }

  function openReservaDrawer(r) {
    if (!r) return;
    drawerOpen = { type: "reserva", uuid: r.uuid };
    drawerTitle.textContent = `Reserva ${r.id}`;
    const daysLeft = Math.round((r.expires - TODAY) / DAY);
    drawerBody.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        ${badge(RESERVA_STATUS, r.status)}
        <span style="font-size:13px;color:var(--ink-soft)">${fmtDateTime(r.date)}</span>
      </div>
      <div class="list">
        <div class="list-item">
          <span class="thumb">${r.product.img ? `<img src="${r.product.img}" alt="" />` : ""}</span>
          <div class="body"><strong>${escapeHtml(r.product.name)}</strong><small>SKU ${r.product.sku} · Stock actual: ${r.product.stock}</small></div>
          <span class="val is-money">${formatPrice(r.product.price)}</span>
        </div>
      </div>
      <div>
        <h4>Cliente</h4>
        <dl class="kv">
          <dt>Nombre</dt><dd>${escapeHtml(r.customer.name)}</dd>
          <dt>Email</dt><dd>${escapeHtml(r.customer.email)}</dd>
          <dt>Teléfono</dt><dd>${escapeHtml(r.customer.phone)}</dd>
        </dl>
      </div>
      <div>
        <h4>Detalle</h4>
        <dl class="kv">
          <dt>Seña abonada</dt><dd>$${formatPrice(r.deposit)} (20%)</dd>
          <dt>Saldo pendiente</dt><dd>$${formatPrice(r.product.price - r.deposit)}</dd>
          <dt>Vencimiento</dt><dd>${fmtDate(r.expires)}${r.status === "activa" || r.status === "por-vencer" ? ` <span class="muted" style="color:var(--ink-soft)">(${daysLeft <= 0 ? "hoy" : `en ${daysLeft} día${daysLeft === 1 ? "" : "s"}`})</span>` : ""}</dd>
          <dt>Nota</dt><dd>${r.note ? escapeHtml(r.note) : "—"}</dd>
        </dl>
      </div>`;
    const active = r.status === "activa" || r.status === "por-vencer";
    drawerFoot.innerHTML = active
      ? `<button class="btn btn-secondary is-sm" type="button" id="resPickup"><svg><use href="#ic-task_alt" /></svg>Marcar como retirada</button>
         <button class="btn btn-ghost is-sm" type="button" id="resExtend"><svg><use href="#ic-schedule" /></svg>Extender 7 días</button>
         <button class="btn btn-danger is-sm" type="button" id="resCancel" style="margin-left:auto"><svg><use href="#ic-cancel" /></svg>Cancelar</button>`
      : `<a class="btn btn-ghost is-sm" href="https://wa.me/54${r.customer.phone.replace(/\D/g, "")}" target="_blank" rel="noopener"><svg><use href="#ic-whatsapp" /></svg>Contactar por WhatsApp</a>`;
    openDrawer();
    const done = async (patch, msg, type) => {
      const { error } = await sb.from("reservations").update(patch).eq("id", r.uuid);
      if (error) return toast(error.message, "bad");
      toast(msg, type);
    };
    $("#resPickup") && $("#resPickup").addEventListener("click", () => done({ status: "retirada" }, `${r.id} marcada como retirada`, "ok"));
    $("#resExtend") &&
      $("#resExtend").addEventListener("click", () => {
        const exp = new Date(r.expires.getTime() + 7 * DAY);
        done({ status: "activa", expires_at: exp.toISOString() }, `${r.id} extendida hasta el ${fmtDate(exp)}`, "ok");
      });
    $("#resCancel") &&
      $("#resCancel").addEventListener("click", async () => {
        const ok = await confirmModal({ title: `Cancelar ${r.id}`, text: "Se liberará el stock reservado. La seña deberá devolverse manualmente.", okText: "Cancelar reserva", danger: true });
        if (ok) done({ status: "cancelada" }, `${r.id} cancelada`, "bad");
      });
  }

  // =====================================================================
  //  FACTURAS
  // =====================================================================

  const RECEIPT_STATUS = {
    pendiente: { label: "Pendiente de revisión", cls: "is-warn" },
    aprobado: { label: "Aprobado", cls: "is-ok" },
    rechazado: { label: "Rechazado", cls: "is-bad" },
  };

  const INV_TYPE = { NV: "Nota de venta" };

  function renderInvoices() {
    $("#emitidasCount").textContent = INVOICES.length;
    $("#recibidosCount").textContent = RECEIPTS.length;

    const s = $("#invSearch"), t = $("#invType"), m = $("#invMonth");
    function draw() {
      const q = normalize(s.value);
      const rows = INVOICES.filter((i) => {
        if (t.value && i.type !== t.value) return false;
        if (m.value) {
          const [y, mo] = m.value.split("-").map(Number);
          if (i.date.getFullYear() !== y || i.date.getMonth() + 1 !== mo) return false;
        }
        if (q && !normalize(i.id + " " + i.customer.name + " " + (i.order ? i.order.id : "")).includes(q)) return false;
        return true;
      });
      $("#invResult").textContent = `${rows.length} de ${INVOICES.length} comprobantes`;
      $("#invoicesTable").innerHTML =
        `<thead><tr><th>N° comprobante</th><th>Tipo</th><th>Cliente</th><th>Orden</th><th>Fecha</th><th class="num">Monto</th><th></th></tr></thead><tbody>` +
        (rows.length
          ? rows
              .slice(0, 40)
              .map(
                (i) => `
            <tr>
              <td class="mono">${i.id}</td>
              <td><span class="badge is-muted is-plain">Nota de venta</span></td>
              <td>${escapeHtml(i.customer.name)}</td>
              <td class="muted">${i.order ? i.order.id : "—"}</td>
              <td class="muted">${fmtDate(i.date)}</td>
              <td class="num is-money">${formatPrice(i.total)}</td>
              <td><div class="actions">
                <button class="iconBtn is-sm" type="button" data-inv-preview="${i.id}" title="Previsualizar"><svg><use href="#ic-visibility" /></svg></button>
                <button class="iconBtn is-sm" type="button" data-inv-download="${i.id}" title="Descargar PDF"><svg><use href="#ic-download" /></svg></button>
              </div></td>
            </tr>`,
              )
              .join("")
          : `<tr><td colspan="7" class="table-empty">No hay comprobantes que coincidan.</td></tr>`) +
        "</tbody>";
    }
    [s, t, m].forEach((el) => (el.oninput = draw));
    draw();
    RENDERERS._redrawInvoices = () => {
      $("#emitidasCount").textContent = INVOICES.length;
      $("#recibidosCount").textContent = RECEIPTS.length;
      draw();
    };

    const rs = $("#recSearch"), rst = $("#recStatus");
    function drawRec() {
      const q = normalize(rs.value);
      const rows = RECEIPTS.filter((r) => {
        if (rst.value && r.status !== rst.value) return false;
        if (q && !normalize(r.customer.name + " " + (r.order ? r.order.id : "") + " " + r.bank).includes(q)) return false;
        return true;
      });
      $("#recResult").textContent = `${rows.length} de ${RECEIPTS.length} comprobantes`;
      $("#receiptsTable").innerHTML =
        `<thead><tr><th>Comprobante</th><th>Cliente</th><th>Orden</th><th>Banco</th><th>Recibido</th><th class="num">Monto</th><th>Estado</th><th></th></tr></thead><tbody>` +
        (rows.length
          ? rows
              .map(
                (r) => `
            <tr>
              <td class="mono">${r.id}</td>
              <td>${escapeHtml(r.customer.name)}</td>
              <td class="muted">${r.order ? r.order.id : "—"}</td>
              <td class="muted">${escapeHtml(r.bank) || "—"}</td>
              <td class="muted">${fmtDateTime(r.date)}</td>
              <td class="num is-money">${formatPrice(r.amount)}</td>
              <td>${badge(RECEIPT_STATUS, r.status)}</td>
              <td><div class="actions">
                <button class="iconBtn is-sm" type="button" data-rec-preview="${r.id}" title="Ver comprobante"><svg><use href="#ic-visibility" /></svg></button>

              </div></td>
            </tr>`,
              )
              .join("")
          : `<tr><td colspan="8" class="table-empty">No hay comprobantes que coincidan.</td></tr>`) +
        "</tbody>";
    }
    [rs, rst].forEach((el) => (el.oninput = drawRec));
    drawRec();
    RENDERERS._redrawReceipts = drawRec;
  }

  document.addEventListener("click", (e) => {
    const p = e.target.closest("[data-inv-preview]");
    if (p) return previewInvoice(INVOICES.find((i) => i.id === p.dataset.invPreview));
    const d = e.target.closest("[data-inv-download]");
    if (d) return downloadInvoice(INVOICES.find((i) => i.id === d.dataset.invDownload));
    const r = e.target.closest("[data-rec-preview]");
    if (r) return previewReceipt(RECEIPTS.find((x) => x.id === r.dataset.recPreview));
  });

  function invoiceHtml(inv) {
    if (!inv.order) return "<p>Orden no disponible.</p>";
    return saleNoteHtml({ number: inv.id, type: inv.type, total: inv.total, issued_at: inv.date }, orderForNote(inv.order));
  }

  async function previewInvoice(inv) {
    if (!inv) return;
    await loadSignature();
    openModal(
      `
      <div class="modal-head">
        <h3>${INV_TYPE[inv.type]} ${inv.id}</h3>
        <button class="btn btn-secondary is-sm" type="button" id="modalDownload"><svg><use href="#ic-download" /></svg>Descargar PDF</button>
        <button class="iconBtn is-sm" type="button" data-close aria-label="Cerrar"><svg><use href="#ic-close" /></svg></button>
      </div>
      ${invoiceHtml(inv)}`,
      { wide: true },
    );
    $("#modalDownload").addEventListener("click", () => downloadInvoice(inv));
  }

  // Datos de la orden en la forma que espera el documento (misma que la tabla orders)
  function orderForNote(o) {
    return {
      number: o.number,
      created_at: o.date,
      customer: o.customer,
      order_items: o.items.map((it) => ({ title: it.product.name, sku: it.product.sku, qty: it.qty, unit_price: it.price })),
      shipping_cost: o.shipping,
      surcharge: o.surcharge,
      subtotal: o.subtotal,
      payment_method: o.payment,
      installments: o.installments,
    };
  }

  // "Descargar": abre el comprobante en una ventana de impresión (Guardar como PDF)
  async function downloadInvoice(inv) {
    if (!inv || !inv.order) return;
    if (!(await printSaleNote({ number: inv.id, type: inv.type, total: inv.total, issued_at: inv.date }, orderForNote(inv.order)))) {
      return toast("El navegador bloqueó la ventana. Permití pop-ups para descargar.", "bad");
    }
    toast("Se abrió el comprobante para guardar como PDF");
  }

  async function previewReceipt(r) {
    if (!r) return;
    const url = await receiptUrl(r);
    const isPdf = /\.pdf$/i.test(r.file);
    openModal(
      `
      <div class="modal-head">
        <h3>Comprobante ${r.id}</h3>
        <a class="btn btn-secondary is-sm" href="${url}" target="_blank" rel="noopener"><svg><use href="#ic-download" /></svg>Abrir</a>
        <button class="iconBtn is-sm" type="button" data-close aria-label="Cerrar"><svg><use href="#ic-close" /></svg></button>
      </div>
      <div class="receipt-preview">
        ${isPdf ? `<iframe src="${url}" style="width:100%;height:420px;border:0;border-radius:12px;background:#fff"></iframe>` : `<img src="${url}" alt="Comprobante de transferencia" />`}
        <dl class="kv">
          <dt>Estado</dt><dd>${badge(RECEIPT_STATUS, r.status)}</dd>
          <dt>Cliente</dt><dd>${escapeHtml(r.customer.name)}</dd>
          <dt>Orden</dt><dd>${r.order ? `${r.order.id} · $${formatPrice(r.order.total)}` : "—"}</dd>
          <dt>Banco</dt><dd>${escapeHtml(r.bank) || "—"}</dd>
          <dt>Referencia</dt><dd>${escapeHtml(r.reference) || "—"}</dd>
          <dt>Monto</dt><dd>$${formatPrice(r.amount)}</dd>
          <dt>Recibido</dt><dd>${fmtDateTime(r.date)}</dd>
        </dl>
      </div>
      ${r.status === "pendiente" ? `
      <div class="modal-actions">
        <button class="btn btn-danger is-sm" type="button" id="recReject"><svg><use href="#ic-cancel" /></svg>Rechazar</button>
        <button class="btn btn-secondary is-sm" type="button" id="recApprove"><svg><use href="#ic-check_circle" /></svg>Aprobar y marcar pagada</button>
      </div>` : ""}`,
      { wide: true },
    );
    const done = async (status) => {
      try {
        await reviewReceipt(r, status === "aprobado");
        closeModal();
        toast(status === "aprobado" ? `${r.order ? r.order.id : "Orden"} marcada como pagada` : `Comprobante ${r.id} rechazado`, status === "aprobado" ? "ok" : "bad");
      } catch (err) {
        toast(err.message, "bad");
      }
    };
    $("#recApprove") && $("#recApprove").addEventListener("click", () => done("aprobado"));
    $("#recReject") && $("#recReject").addEventListener("click", () => done("rechazado"));
  }

  // =====================================================================
  //  CARGAS (formulario de producto)
  // =====================================================================

  const SPEC_PRESETS = {
    computadoras: ["Procesador", "Placa de video", "Memoria RAM", "Almacenamiento", "Motherboard", "Fuente", "Gabinete", "Sistema operativo"],
    notebooks: ["Procesador", "Placa de video", "Memoria RAM", "Almacenamiento", "Pantalla", "Batería", "Sistema operativo", "Peso"],
    tablets: ["Procesador", "Memoria RAM", "Almacenamiento", "Pantalla", "Cámara", "Batería", "Conectividad", "Sistema operativo"],
    celulares: ["Procesador", "Memoria RAM", "Almacenamiento", "Pantalla", "Cámara principal", "Cámara frontal", "Batería", "Sistema operativo"],
    componentes: ["Modelo", "Socket / Interfaz", "Frecuencia", "Capacidad", "Consumo", "Garantía"],
    perifericos: ["Modelo", "Conexión", "Compatibilidad", "Iluminación", "Cable", "Garantía"],
  };

  function renderUpload() {
    const form = $("#productForm");
    const title = $("#pTitle"), brand = $("#pBrand"), sku = $("#pSku");
    const cat = $("#pCategory"), sub = $("#pSubcategory");
    const desc = $("#pDescription");
    const price = $("#pPrice"), cost = $("#pCost"), oldPrice = $("#pOldPrice"), discount = $("#pDiscount");
    const stock = $("#pStock"), status = $("#pStatus");
    const sale = $("#pSale"), cuotas = $("#pCuotas"), cuotasN = $("#pCuotasN"), freeShip = $("#pFreeShip");
    const tagsBox = $("#pTags"), tagInput = $("#pTagInput");
    const imgDrop = $("#imgDrop"), imgInput = $("#imgInput"), imgGrid = $("#imgGrid");
    const specRows = $("#specRows"), highlightRows = $("#highlightRows");

    let tags = [];
    let images = []; // { url, name, file }

    // --- Contadores ---
    const counter = (el, out, max) => {
      const upd = () => (out.textContent = `${el.value.length} / ${max}`);
      el.addEventListener("input", upd);
      upd();
    };
    counter(title, $("#pTitleCount"), 120);
    counter(desc, $("#pDescCount"), 2000);

    // --- Subcategorías dependientes ---
    cat.addEventListener("change", () => {
      const subs = (CATEGORIES[cat.value] || { subs: [] }).subs;
      sub.innerHTML = `<option value="">Sin subcategoría</option>` + subs.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
      sub.disabled = !subs.length;
      sub.required = false;
      // presets de especificaciones si aún no se cargó nada
      if (cat.value && !$$(".row-kv input", specRows).some((i) => i.value.trim())) {
        specRows.innerHTML = "";
        SPEC_PRESETS[cat.value].forEach((k) => addSpec(k, ""));
      }
      updateSummary();
    });

    // --- Formato de precios (1.304.424) ---
    function moneyInput(el) {
      el.addEventListener("input", () => {
        const n = parsePrice(el.value);
        // "0" se conserva (costo cero = sin costo); vacío queda vacío
        el.value = n ? formatPrice(n) : /d/.test(el.value) ? "0" : "";
      });
    }
    [price, cost, oldPrice].forEach(moneyInput);

    // --- Dimensiones: "45 20 45" o "45x20x45" -> "45 × 20 × 45" ---
    // Espacio, x, *, / o - pasan al número siguiente (máximo 3). Una unidad al
    // final ("45x20x45cm", al pegar o al salir del campo) se pasa al select.
    const dims = $("#pDims");
    const DIM_SEP = " × ";
    function formatDims(raw, done) {
      const unit = done && /(mm|cm|m)\s*$/i.exec(raw);
      if (unit) {
        $("#pDimsUnit").value = unit[1].toLowerCase();
        raw = raw.slice(0, unit.index);
      }
      const nums = raw.split(/[^\d.,]+/);
      const nextNum = nums.length > 1 && nums[nums.length - 1] === "";
      // Un solo separador decimal por número
      const parts = nums.filter(Boolean).slice(0, 3).map((n) => n.replace(/([.,])(.*)/, (_, s, rest) => s + rest.replace(/[.,]/g, "")));
      return parts.join(DIM_SEP) + (!done && nextNum && parts.length && parts.length < 3 ? DIM_SEP : "");
    }
    // Un separador después del 3er número cierra el campo: lo que se siga
    // escribiendo al final se ignora (si no, se pegaría al alto: 45 × 20 × 4599)
    let dimsClosed = false;
    dims.addEventListener("focus", () => (dimsClosed = false));
    dims.addEventListener("beforeinput", (e) => {
      if (e.inputType !== "insertText" || dims.selectionStart !== dims.value.length) return;
      if (dims.value.split(DIM_SEP).length === 3 && /\d$/.test(dims.value) && /[^\d.,]/.test(e.data)) dimsClosed = true;
      if (dimsClosed) e.preventDefault();
    });
    dims.addEventListener("input", (e) => {
      // Editando en el medio no se toca (movería el cursor); se formatea al salir
      if (dims.selectionStart !== dims.value.length) return;
      let raw = dims.value;
      if (e.inputType && e.inputType.startsWith("delete")) dimsClosed = false;
      // Borrar sobre " × " lo borra entero, si no volvería a aparecer
      // (si quedó entero es que se borró el número de después: se deja)
      if (e.inputType && e.inputType.startsWith("delete") && !raw.endsWith(DIM_SEP)) raw = raw.replace(/[^\d.,]+$/, "");
      dims.value = formatDims(raw, e.inputType === "insertFromPaste");
    });
    dims.addEventListener("change", () => (dims.value = formatDims(dims.value, true)));

    // Oferta: precio anterior <-> % descuento
    let syncing = false;
    const syncDiscount = () => {
      if (syncing) return;
      syncing = true;
      const p = parsePrice(price.value), o = parsePrice(oldPrice.value);
      discount.value = o > p && p ? Math.round((1 - p / o) * 100) : "";
      syncing = false;
    };
    oldPrice.addEventListener("input", syncDiscount);
    // Cambiar el precio mantiene el precio anterior y recalcula el %
    price.addEventListener("input", () => oldPrice.value && syncDiscount());
    discount.addEventListener("input", () => {
      if (syncing) return;
      syncing = true;
      const p = parsePrice(price.value), d = +discount.value;
      oldPrice.value = d > 0 && d < 100 && p ? formatPrice(Math.round(p / (1 - d / 100))) : "";
      syncing = false;
    });

    // Margen
    const updateMargin = () => {
      const p = parsePrice(price.value), c = parsePrice(cost.value), o = parsePrice(oldPrice.value);
      const fmt = (v) => `${Math.round(((v - c) / v) * 100)}% (${v - c < 0 ? "-" : ""}$${formatPrice(Math.abs(v - c))})`;
      // Costo vacío o 0 = sin costo (margen del 100%)
      const noCost = c ? "" : " · sin costo";
      const loss = c > p ? " · a pérdida" : "";
      // En oferta se cobra "Precio"; el precio anterior muestra el margen sin la oferta
      $("#pMargin").innerHTML = !p
        ? "Margen: —"
        : sale.checked && o > p
          ? `Margen en oferta: ${fmt(p)}${loss}${noCost}<br>Sin oferta ($${formatPrice(o)}): ${fmt(o)}`
          : `Margen: ${fmt(p)}${loss}${noCost}`;
    };
    [price, cost, oldPrice, discount].forEach((el) => el.addEventListener("input", updateMargin));
    sale.addEventListener("change", updateMargin);

    // --- Tags ---
    function renderTags() {
      $$(".tag", tagsBox).forEach((t) => t.remove());
      tags.forEach((t, i) => {
        const el = document.createElement("span");
        el.className = "tag";
        el.innerHTML = `${escapeHtml(t)}<button type="button" aria-label="Quitar"><svg><use href="#ic-close" /></svg></button>`;
        el.querySelector("button").addEventListener("click", () => {
          tags.splice(i, 1);
          renderTags();
        });
        tagsBox.insertBefore(el, tagInput);
      });
      updateSummary();
    }
    tagsBox.addEventListener("click", () => tagInput.focus());
    tagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        const v = tagInput.value.trim().replace(/,+$/, "");
        if (!v) return;
        if (tags.length >= 10) return toast("Máximo 10 etiquetas", "bad");
        if (!tags.some((t) => t.toLowerCase() === v.toLowerCase())) tags.push(v);
        tagInput.value = "";
        renderTags();
      } else if (e.key === "Backspace" && !tagInput.value && tags.length) {
        tags.pop();
        renderTags();
      }
    });

    // --- Imágenes ---
    function addFiles(files) {
      Array.from(files).forEach((f) => {
        if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return toast(`${f.name}: formato no permitido`, "bad");
        if (f.size > 5 * 1024 * 1024) return toast(`${f.name}: supera los 5 MB`, "bad");
        if (images.length >= 8) return toast("Máximo 8 imágenes", "bad");
        images.push({ url: URL.createObjectURL(f), name: f.name, file: f, isNew: true });
      });
      renderImages();
    }
    imgInput.addEventListener("change", () => {
      addFiles(imgInput.files);
      imgInput.value = "";
    });
    ["dragenter", "dragover"].forEach((ev) =>
      imgDrop.addEventListener(ev, (e) => {
        e.preventDefault();
        imgDrop.classList.add("is-dragover");
      }),
    );
    ["dragleave", "drop"].forEach((ev) =>
      imgDrop.addEventListener(ev, (e) => {
        e.preventDefault();
        imgDrop.classList.remove("is-dragover");
        if (ev === "drop") addFiles(e.dataTransfer.files);
      }),
    );

    let dragEl = null;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    function flipItems(mutate) {
      const items = $$(".imgItem", imgGrid);
      const first = new Map(items.map((el) => [el, el.getBoundingClientRect()]));
      mutate();
      if (reduceMotion.matches) return;
      items.forEach((el) => {
        if (el === dragEl) return;
        const a = first.get(el), b = el.getBoundingClientRect();
        const dx = a.left - b.left, dy = a.top - b.top;
        if (!dx && !dy) return;
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
          id: "flip",
          duration: 250,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        });
      });
    }
    function updateMainTag() {
      $$(".imgItem", imgGrid).forEach((el, i) => el.classList.toggle("is-main", i === 0));
    }
    function startSort(item, e) {
      const r = item.getBoundingClientRect();
      const offX = e.clientX - r.left, offY = e.clientY - r.top;
      const from = +item.dataset.i;
      const ghost = item.cloneNode(true);
      ghost.className = "imgItem imgGhost";
      Object.assign(ghost.style, { width: `${r.width}px`, height: `${r.height}px`, left: `${r.left}px`, top: `${r.top}px` });
      document.body.appendChild(ghost);
      document.body.classList.add("is-sorting");
      dragEl = item;
      item.classList.add("is-dragging");
      updateMainTag();

      const move = (ev) => {
        ghost.style.transform = `translate(${ev.clientX - offX - r.left}px, ${ev.clientY - offY - r.top}px) scale(1.06) rotate(-2deg)`;
        const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".imgItem");
        if (!over || over === dragEl || !imgGrid.contains(over)) return;
        if (over.getAnimations().some((a) => a.id === "flip" && a.playState === "running")) return;
        const items = $$(".imgItem", imgGrid);
        const after = items.indexOf(dragEl) < items.indexOf(over);
        flipItems(() => over[after ? "after" : "before"](dragEl));
        updateMainTag();
      };
      const end = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        const t = dragEl.getBoundingClientRect();
        const finish = () => {
          ghost.remove();
          document.body.classList.remove("is-sorting");
          item.classList.remove("is-dragging");
          const order = $$(".imgItem", imgGrid).map((el) => +el.dataset.i);
          dragEl = null;
          if (order.every((v, i) => v === i)) return updateMainTag();
          images.splice(0, images.length, ...order.map((i) => images[i]));
          renderImages(order.indexOf(from));
        };
        if (reduceMotion.matches) return finish();
        ghost.style.transition = "transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)";
        ghost.style.transform = `translate(${t.left - r.left}px, ${t.top - r.top}px)`;
        setTimeout(finish, 220);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
      move(e);
    }

    function renderImages(droppedIdx = -1) {
      imgGrid.innerHTML = images
        .map(
          (im, i) => `
          <div class="imgItem${im.isNew ? " is-new" : ""}${i === droppedIdx ? " is-dropped" : ""}${i === 0 ? " is-main" : ""}" data-i="${i}">
            <img src="${im.url}" alt="" draggable="false" />
            <span class="imgItem-main">Principal</span>
            <div class="imgItem-tools">
              <button type="button" data-remove="${i}" title="Quitar"><svg><use href="#ic-delete" /></svg></button>
            </div>
          </div>`,
        )
        .join("");
      images.forEach((im) => delete im.isNew);
      $$(".imgItem", imgGrid).forEach((item) => {
        item.addEventListener("pointerdown", (e) => {
          if (e.button !== 0 || dragEl || e.target.closest("button")) return;
          e.preventDefault();
          const sx = e.clientX, sy = e.clientY;
          const pending = (ev) => {
            if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
            cancel();
            startSort(item, ev);
          };
          const cancel = () => {
            window.removeEventListener("pointermove", pending);
            window.removeEventListener("pointerup", cancel);
            window.removeEventListener("pointercancel", cancel);
          };
          window.addEventListener("pointermove", pending);
          window.addEventListener("pointerup", cancel);
          window.addEventListener("pointercancel", cancel);
        });
      });
      $$("[data-remove]", imgGrid).forEach((b) =>
        b.addEventListener("click", () => {
          images.splice(+b.dataset.remove, 1);
          renderImages();
        }),
      );
      updatePreview();
      updateSummary();
    }

    // --- Filas dinámicas ---
    function addSpec(k, v) {
      const row = document.createElement("div");
      row.className = "row-kv";
      row.innerHTML = `<input type="text" placeholder="Característica" value="${escapeHtml(k || "")}" /><input type="text" placeholder="Valor" value="${escapeHtml(v || "")}" /><button class="row-remove" type="button" aria-label="Quitar"><svg><use href="#ic-delete" /></svg></button>`;
      row.querySelector(".row-remove").addEventListener("click", () => {
        row.remove();
        updateSummary();
      });
      row.querySelectorAll("input").forEach((i) => i.addEventListener("input", updateSummary));
      specRows.appendChild(row);
    }
    function addHighlight(v) {
      const row = document.createElement("div");
      row.className = "row-single";
      row.innerHTML = `<input type="text" placeholder="Ej: Armado y testeado en Argentina, listo para usar" value="${escapeHtml(v || "")}" /><button class="row-remove" type="button" aria-label="Quitar"><svg><use href="#ic-delete" /></svg></button>`;
      row.querySelector(".row-remove").addEventListener("click", () => {
        row.remove();
        updatePreview();
      });
      highlightRows.appendChild(row);
      if (!v) row.querySelector("input").focus();
    }
    $("#addSpec").addEventListener("click", () => {
      addSpec("", "");
      specRows.lastElementChild.querySelector("input").focus();
    });
    $("#addHighlight").addEventListener("click", () => addHighlight(""));
    addSpec("", "");
    ["Armado y testeado en Argentina, listo para usar", "Soporte técnico directo durante toda la garantía"].forEach(addHighlight);

    // --- Vista previa (misma tarjeta que la tienda + descripción) ---
    function updatePreview() {
      $("#pvTitle").textContent = title.value.trim() || "Título del producto";
      const p = parsePrice(price.value), o = parsePrice(oldPrice.value);
      $("#pvPrice").textContent = formatPrice(p);
      const pvOld = $("#pvOld");
      const onSale = sale.checked && o > p && p > 0;
      pvOld.hidden = !onSale;
      pvOld.textContent = "$" + formatPrice(o);
      // Mismo cálculo que la tarjeta de la tienda (utils.js)
      const pvBadge = $("#pvBadge");
      pvBadge.hidden = !onSale;
      pvBadge.textContent = onSale ? `${Math.round((1 - p / o) * 100)}% OFF` : "";
      const pvC = $("#pvCuotas");
      pvC.hidden = true; // cuotas sin interés ocultas: solo se paga por transferencia
      pvC.textContent = `${cuotasN.value} cuotas sin interés`;

      const pvImage = $("#pvImage"), pvImg = $("#pvImage img");
      pvImage.classList.toggle("is-empty", !images.length);
      pvImg.hidden = !images.length;
      pvImg.src = images[0] ? images[0].url : "";

      const d = desc.value.trim();
      const pvText = $("#pvDescText");
      pvText.textContent = d || "La descripción aparece acá a medida que la escribís.";
      pvText.classList.toggle("is-empty", !d);
      $("#pvHighlights").innerHTML = $$(".row-single input", highlightRows)
        .map((i) => i.value.trim())
        .filter(Boolean)
        .map((h) => `<li><svg><use href="#ic-check" /></svg><span>${escapeHtml(h)}</span></li>`)
        .join("");
    }
    [title, price, oldPrice, sale, cuotas, cuotasN, discount, desc].forEach((el) => {
      el.addEventListener("input", updatePreview);
      el.addEventListener("change", updatePreview);
    });
    highlightRows.addEventListener("input", updatePreview);

    // --- Resumen / validación ---
    function collect() {
      const specs = $$(".row-kv", specRows)
        .map((r) => {
          const [k, v] = r.querySelectorAll("input");
          return { k: k.value.trim(), v: v.value.trim() };
        })
        .filter((s) => s.k && s.v);
      const highlights = $$(".row-single input", highlightRows).map((i) => i.value.trim()).filter(Boolean);
      return {
        title: title.value.trim(),
        brand: brand.value.trim(),
        sku: sku.value.trim().toUpperCase() || autoSku(),
        category: cat.value,
        subcategory: sub.value,
        description: desc.value.trim(),
        tags: tags.slice(),
        price: parsePrice(price.value),
        cost: parsePrice(cost.value),
        stock: +stock.value || 0,
        stockMin: +$("#pStockMin").value || 0,
        status: status.value,
        warranty: +$("#pWarranty").value || 0,
        warrantyUnit: $("#pWarrantyUnit").value,
        weightUnit: $("#pWeightUnit").value,
        dimensionsUnit: $("#pDimsUnit").value,
        sale: sale.checked,
        oldPrice: parsePrice(oldPrice.value),
        featured: $("#pFeatured").checked,
        installments: cuotas.checked ? +cuotasN.value : 0,
        freeShipping: freeShip.checked,
        delivery: $("#pDelivery").value,
        weight: $("#pWeight").value,
        dimensions: formatDims(dims.value, true),
        condition: $("#pCondition").value,
        images: images.map((i) => i.name),
        image: images[0] ? images[0].url : "",
        specs,
        highlights,
      };
    }

    function autoSku() {
      const c = { computadoras: "PC", notebooks: "NB", tablets: "TB", celulares: "CE", componentes: "CO", perifericos: "PE" }[cat.value] || "XX";
      const t = title.value.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase() || "PROD";
      return `${c}-${t}-${String(Date.now()).slice(-4)}`;
    }

    function updateSummary() {
      const d = collect();
      // [etiqueta, ok, elemento a marcar, elemento al que scrollear]
      const checks = [
        ["Título", !!d.title, title.closest(".field"), title],
        ["Marca", !!d.brand, brand.closest(".field"), brand],
        ["Categoría", !!d.category, cat.closest(".field"), cat],
        ["Descripción", d.description.length >= 40, desc.closest(".field"), desc],
        ["Precio", d.price > 0, price.closest(".field"), price],
        ["Stock", stock.value !== "", stock.closest(".field"), stock],
        ["Peso", +d.weight > 0, $("#pWeight").closest(".field"), $("#pWeight")],
        ["Imágenes", d.images.length > 0, imgDrop, imgDrop],
        ["Especificaciones", d.specs.length > 0, specRows, specRows],
      ];
      checks.forEach(([, ok, mark]) => mark.classList.toggle("is-error", !ok));
      const okCount = checks.filter((c) => c[1]).length;
      $("#uploadSummary").innerHTML =
        checks.map(([l, ok], i) => `<div><span>${l}</span><strong class="${ok ? "is-ok" : "is-warn"}" data-check="${i}">${ok ? "Listo" : "Falta"}</strong></div>`).join("") +
        `<div style="border-top:1px solid var(--line);padding-top:8px;margin-top:4px"><span>Completado</span><strong>${okCount} / ${checks.length}</strong></div>`;
      // "Falta" lleva al campo
      $$("[data-check].is-warn", $("#uploadSummary")).forEach((el) =>
        el.addEventListener("click", () => {
          form.classList.add("is-submitted");
          const target = checks[+el.dataset.check][3];
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          const focusable = target.matches("input,select,textarea") ? target : target.querySelector("input,select,textarea");
          focusable && setTimeout(() => focusable.focus({ preventScroll: true }), 350);
        }),
      );
      return okCount === checks.length;
    }
    form.addEventListener("input", updateSummary);
    form.addEventListener("change", updateSummary);
    updateSummary();

    // --- Guardado (tabla products + bucket products) ---
    let editingId = null; // uuid del producto que se está editando (null = alta)
    const editBanner = document.createElement("div");
    editBanner.className = "card";
    editBanner.style.cssText = "display:none;align-items:center;gap:12px;flex-direction:row;padding:14px 18px;border-color:var(--blue)";
    editBanner.innerHTML = `<svg style="width:18px;height:18px;fill:var(--blue)"><use href="" /></svg><span style="flex:1;font-size:13.5px" id="editingText"></span><button class="btn btn-ghost is-sm" type="button" id="editCancel"></button>`;
    form.querySelector(".upload-form").prepend(editBanner);
    $("#editCancel").addEventListener("click", () => resetForm());

    // p = producto de referencia; copy = "publicar similar" (alta nueva a partir de p)
    function setEditing(p, copy) {
      editingId = p && !copy ? p.id : null;
      editBanner.style.display = p ? "flex" : "none";
      if (p) {
        editBanner.querySelector("use").setAttribute("href", copy ? "#ic-content_copy" : "#ic-edit");
        $("#editingText").innerHTML = copy
          ? `Nuevo producto basado en <strong>${escapeHtml(p.name)}</strong>. Cargá las imágenes y revisá el SKU antes de publicar.`
          : `Editando <strong>${escapeHtml(p.name)}</strong>. Los cambios se publican al guardar.`;
        $("#editCancel").textContent = copy ? "Descartar" : "Cancelar edición";
      }
      $("#publishBtn").innerHTML = `<svg><use href="#ic-cloud_upload" /></svg>${editingId ? "Guardar cambios" : "Publicar"}`;
    }

    // Carga un producto existente en el formulario (copy: sin imágenes ni SKU, se guarda como alta)
    function loadIntoForm(p, copy) {
      const r = p.raw;
      resetForm(true);
      setEditing(p, copy);
      title.value = r.title;
      brand.value = r.brand;
      sku.value = copy ? "" : r.sku;
      cat.value = r.category;
      cat.dispatchEvent(new Event("change"));
      sub.value = r.subcategory || "";
      desc.value = r.description;
      tags = (r.tags || []).slice();
      renderTags();
      price.value = r.price ? formatPrice(r.price) : "";
      cost.value = r.cost ? formatPrice(r.cost) : "";
      stock.value = r.stock;
      $("#pStockMin").value = r.stock_min;
      status.value = r.status;
      $("#pWarranty").value = r.warranty;
      $("#pWarrantyUnit").value = r.warranty_unit || "meses";
      $("#pWeightUnit").value = r.weight_unit || "kg";
      $("#pDimsUnit").value = r.dimensions_unit || "cm";
      sale.checked = r.on_sale;
      oldPrice.value = r.old_price ? formatPrice(r.old_price) : "";
      discount.value = r.on_sale && r.old_price > r.price ? Math.round((1 - r.price / r.old_price) * 100) : "";
      $("#pFeatured").checked = r.featured;
      cuotas.checked = r.installments > 0;
      if (r.installments) cuotasN.value = String(r.installments);
      freeShip.checked = r.free_shipping;
      $("#pDelivery").value = r.delivery;
      $("#pWeight").value = r.weight || "";
      $("#pDims").value = r.dimensions;
      $("#pCondition").value = r.condition;
      images = copy ? [] : (r.images || []).map((url) => ({ url, name: url.split("/").pop(), existing: true }));
      renderImages();
      specRows.innerHTML = "";
      (r.specs || []).forEach((s) => addSpec(s.k, s.v));
      if (!specRows.children.length) addSpec("", "");
      highlightRows.innerHTML = "";
      (r.highlights || []).forEach(addHighlight);
      updateMargin();
      updatePreview();
      updateSummary();
      $("#pTitleCount").textContent = `${title.value.length} / 120`;
      $("#pDescCount").textContent = `${desc.value.length} / 2000`;
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    RENDERERS._editProduct = (id, copy) => {
      const p = PRODUCTS.find((x) => x.id === id);
      if (p) loadIntoForm(p, copy);
    };

    // Se muestran 5; "Ver más" deja ver todas en una caja scrolleable del alto de esas 5
    const UPLOADED_VISIBLE = 5;
    const uploadedList = $("#uploadedList");
    const uploadedMore = document.createElement("button");
    uploadedMore.type = "button";
    uploadedMore.className = "btn btn-ghost is-sm uploaded-more";
    uploadedList.after(uploadedMore);
    let uploadedExpanded = false;

    // Alto hasta el final del 5º ítem (se mide, porque en mobile los ítems pueden ocupar 2 líneas)
    function fitUploaded() {
      const fifth = uploadedList.children[UPLOADED_VISIBLE - 1];
      if (!uploadedExpanded || !fifth) return;
      const h = fifth.getBoundingClientRect().bottom - uploadedList.getBoundingClientRect().top + uploadedList.scrollTop;
      uploadedList.style.maxHeight = `${Math.ceil(h)}px`;
    }
    function setUploadedExpanded(on) {
      // Con la vista oculta no se puede medir: queda cerrada
      uploadedExpanded = on && !!uploadedList.offsetParent;
      uploadedList.classList.toggle("is-expanded", uploadedExpanded);
      if (uploadedExpanded) fitUploaded();
      else {
        uploadedList.style.maxHeight = "";
        uploadedList.scrollTop = 0;
      }
      uploadedMore.textContent = uploadedExpanded ? "Ver menos" : `Ver más (${PRODUCTS.length - UPLOADED_VISIBLE})`;
    }
    uploadedMore.addEventListener("click", () => setUploadedExpanded(!uploadedExpanded));
    window.addEventListener("resize", fitUploaded);

    function renderUploaded() {
      const list = PRODUCTS;
      $("#uploadedHint").textContent = list.length ? `${list.length} producto${list.length === 1 ? "" : "s"}` : "";
      uploadedList.innerHTML = list.length
        ? list
            .map(
              (p) => `
            <div class="list-item">
              <span class="thumb">${p.img ? `<img src="${escapeHtml(p.img)}" alt="" loading="lazy" />` : '<svg><use href="#ic-image" /></svg>'}</span>
              <div class="body"><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.sku)} · ${CATEGORIES[p.cat] ? CATEGORIES[p.cat].label : "—"} · stock ${p.stock} · ${fmtRelative(p.createdAt)}</small></div>
              <span class="badge ${p.status === "publicado" ? "is-ok" : p.status === "borrador" ? "is-warn" : "is-muted"}">${p.status}</span>
              <span class="val is-money">${formatPrice(p.price)}</span>
              <button class="iconBtn is-sm" type="button" data-copy-product="${p.id}" title="Publicar similar"><svg><use href="#ic-content_copy" /></svg></button>
              <button class="iconBtn is-sm" type="button" data-edit-product="${p.id}" title="Editar"><svg><use href="#ic-edit" /></svg></button>
              <button class="iconBtn is-sm is-danger" type="button" data-del-product="${p.id}" title="Eliminar"><svg><use href="#ic-delete" /></svg></button>
            </div>`,
            )
            .join("")
        : `<p style="color:var(--ink-soft);font-size:13.5px;margin:0">Todavía no cargaste productos desde el panel.</p>`;
      uploadedMore.hidden = list.length <= UPLOADED_VISIBLE;
      setUploadedExpanded(uploadedExpanded && !uploadedMore.hidden);
    }
    RENDERERS._redrawUploaded = renderUploaded;
    uploadedList.addEventListener("click", async (e) => {
      const cp = e.target.closest("[data-copy-product]");
      if (cp) return RENDERERS._editProduct(cp.dataset.copyProduct, true);
      const ed = e.target.closest("[data-edit-product]");
      if (ed) return RENDERERS._editProduct(ed.dataset.editProduct);
      const b = e.target.closest("[data-del-product]");
      if (!b) return;
      const p = PRODUCTS.find((x) => x.id === b.dataset.delProduct);
      if (!p) return;
      const ok = await confirmModal({ title: "Eliminar producto", text: `Se quitará "${p.name}" del catálogo. Las órdenes anteriores conservan su detalle.`, okText: "Eliminar", danger: true });
      if (!ok) return;
      const { error } = await sb.from("products").delete().eq("id", p.id);
      if (error) return toast(error.message, "bad");
      // Imágenes del bucket
      const paths = (p.images || []).map((u) => (u.split("/products/")[1] || "")).filter(Boolean);
      if (paths.length) sb.storage.from("products").remove(paths).then(() => {});
      if (editingId === p.id) resetForm();
      toast("Producto eliminado", "bad");
    });
    renderUploaded();

    async function uploadImages(productId) {
      const urls = [];
      for (let i = 0; i < images.length; i++) {
        const im = images[i];
        if (im.existing) {
          urls.push(im.url);
          continue;
        }
        const ext = (im.file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${productId}/${Date.now()}-${i}.${ext}`;
        const { error } = await sb.storage.from("products").upload(path, im.file, { contentType: im.file.type, upsert: false });
        if (error) throw new Error(`No se pudo subir ${im.name}: ${error.message}`);
        urls.push(sb.storage.from("products").getPublicUrl(path).data.publicUrl);
      }
      return urls;
    }

    async function save(statusOverride) {
      const d = collect();
      const productId = editingId || crypto.randomUUID();
      const imageUrls = await uploadImages(productId);
      const row = {
        id: productId,
        sku: d.sku,
        title: d.title,
        brand: d.brand,
        category: d.category,
        subcategory: d.subcategory,
        description: d.description,
        tags: d.tags,
        price: d.price,
        cost: d.cost,
        old_price: d.oldPrice,
        on_sale: d.sale && d.oldPrice > d.price,
        stock: d.stock,
        stock_min: d.stockMin,
        status: statusOverride || d.status,
        warranty: d.warranty,
        warranty_unit: d.warrantyUnit,
        weight_unit: d.weightUnit,
        dimensions_unit: d.dimensionsUnit,
        featured: d.featured,
        installments: d.installments,
        free_shipping: d.freeShipping,
        delivery: d.delivery,
        weight: +d.weight || 0,
        dimensions: d.dimensions,
        condition: d.condition,
        images: imageUrls,
        specs: d.specs,
        highlights: d.highlights,
      };
      if (!editingId) row.created_by = USER.id;
      // insert / update (no upsert: leer excluded.cost exige SELECT sobre cost, que solo tiene admin_products)
      const { error } = editingId ? await sb.from("products").update(row).eq("id", productId) : await sb.from("products").insert(row);
      if (error) {
        if (/products_sku_key|duplicate key/i.test(error.message)) throw new Error(`Ya existe un producto con el SKU ${d.sku}`);
        throw error;
      }
      await loadProducts();
      renderUploaded();
      return row;
    }

    async function submitWith(statusOverride, okMessage) {
      const btn = statusOverride ? $("#saveDraft") : $("#publishBtn");
      btn.disabled = true;
      try {
        const row = await save(statusOverride);
        toast(okMessage(row), "ok");
        resetForm();
      } catch (err) {
        toast(err.message || "No se pudo guardar el producto", "bad");
      } finally {
        btn.disabled = false;
      }
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      form.classList.add("is-submitted");
      const complete = updateSummary();
      if (!form.checkValidity() || !complete) {
        toast("Completá los campos marcados antes de publicar", "bad");
        const bad = $(".is-error", form);
        if (bad) {
          bad.scrollIntoView({ behavior: "smooth", block: "center" });
          const focusable = bad.matches("input,select,textarea") ? bad : bad.querySelector("input,select,textarea");
          focusable && setTimeout(() => focusable.focus({ preventScroll: true }), 350);
        }
        return;
      }
      const wasEditing = !!editingId;
      submitWith(null, (row) => (wasEditing ? `"${row.title}" actualizado` : row.status === "publicado" ? `"${row.title}" publicado en la tienda` : `"${row.title}" guardado como ${row.status}`));
    });

    $("#saveDraft").addEventListener("click", () => {
      if (!title.value.trim()) return toast("Poné al menos un título para guardar el borrador", "bad");
      if (!cat.value) return toast("Elegí una categoría para guardar el borrador", "bad");
      if (!parsePrice(price.value)) price.value = "0";
      submitWith("borrador", () => "Borrador guardado");
    });

    function resetForm(keepEditing) {
      form.reset();
      form.classList.remove("is-submitted");
      if (!keepEditing) setEditing(null);
      tags = [];
      images.forEach((i) => !i.existing && URL.revokeObjectURL(i.url));
      images = [];
      renderTags();
      renderImages();
      specRows.innerHTML = "";
      addSpec("", "");
      highlightRows.innerHTML = "";
      cat.dispatchEvent(new Event("change"));
      updateMargin();
      updatePreview();
      updateSummary();
      $("#pTitleCount").textContent = "0 / 120";
      $("#pDescCount").textContent = "0 / 2000";
    }
    $("#resetForm").addEventListener("click", async () => {
      const ok = await confirmModal({ title: "Limpiar formulario", text: "Se perderán los datos que cargaste hasta ahora.", okText: "Limpiar", danger: true });
      if (ok) resetForm();
    });

    updatePreview();
  }

  // =====================================================================
  //  PERFIL
  // =====================================================================

  const DEFAULT_PREFS = {
    lang: "es", currency: "ARS", tz: "America/Argentina/Buenos_Aires", dateFormat: "dd/mm/yyyy",
    homeView: "dashboard", pageSize: "25", startCollapsed: false, reduceMotion: false,
    twofa: false, dailyDigest: true, weeklyDigest: true, sound: false, dnd: false,
  };
  const NOTIF_EVENTS = [
    ["venta", "Nueva venta", "Cada vez que se confirma una orden"],
    ["reserva", "Nueva reserva", "Y avisos cuando está por vencer"],
    ["pago", "Pago recibido", "Comprobantes de transferencia y acreditaciones"],
    ["stock", "Stock bajo", "Cuando un producto llega al mínimo configurado"],
    ["resena", "Nueva opinión", "Reseñas de clientes en los productos"],
    ["sistema", "Avisos del sistema", "Actualizaciones y mantenimiento del panel"],
  ];
  const DEFAULT_MATRIX = {
    venta: { panel: true, email: true, whatsapp: false },
    reserva: { panel: true, email: true, whatsapp: true },
    pago: { panel: true, email: true, whatsapp: false },
    stock: { panel: true, email: false, whatsapp: false },
    resena: { panel: true, email: false, whatsapp: false },
    sistema: { panel: true, email: false, whatsapp: false },
  };

  function applyAvatar() {
    const html = USER.avatar ? `<img src="${escapeHtml(USER.avatar)}" alt="" referrerpolicy="no-referrer" />` : escapeHtml(initials(USER.name));
    $("#sbAvatar").innerHTML = html;
    $("#profileAvatar").innerHTML = html;
    $("#sbUserName").textContent = USER.name;
    $("#sbUserEmail").textContent = USER.email;
    $("#profileName").textContent = USER.name;
    $("#profileEmail").textContent = USER.email;
    const inputs = $$('.tab-panel[data-tab="perfil"] .formGrid input[disabled]');
    if (inputs.length >= 4) {
      inputs[0].value = USER.name;
      inputs[1].value = USER.email;
      inputs[2].value = "Administrador";
      const since = USER.profile ? new Date(USER.profile.created_at).toLocaleDateString("es-AR", { month: "long", year: "numeric" }) : "";
      inputs[3].value = since.charAt(0).toUpperCase() + since.slice(1);
    }
  }

  function applyTheme(theme) {
    let t = theme;
    if (t === "system") t = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    document.documentElement.dataset.theme = t;
  }

  function renderProfile() {
    const prefs = Object.assign({}, DEFAULT_PREFS, store.get("prefs", {}));

    // Avatar
    $("#avatarInput").addEventListener("change", () => {
      const f = $("#avatarInput").files[0];
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) return toast("La imagen no puede superar 2 MB", "bad");
      (async () => {
        const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${USER.id}/avatar-${Date.now()}.${ext}`;
        const { error } = await sb.storage.from("avatars").upload(path, f, { upsert: true, contentType: f.type });
        if (error) return toast("No se pudo subir la foto", "bad");
        const url = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
        await sb.from("profiles").update({ avatar_url: url }).eq("id", USER.id);
        USER.avatar = url;
        applyAvatar();
        toast("Foto de perfil actualizada", "ok");
      })();
      $("#avatarInput").value = "";
    });
    $("#avatarRemove").addEventListener("click", async () => {
      await sb.from("profiles").update({ avatar_url: null }).eq("id", USER.id);
      USER.avatar = "";
      applyAvatar();
      toast("Foto de perfil eliminada");
    });

    // Preferencias genéricas (data-pref)
    $$("[data-pref]").forEach((el) => {
      const key = el.dataset.pref;
      if (el.type === "checkbox") el.checked = !!prefs[key];
      else el.value = prefs[key];
      el.addEventListener("change", () => {
        prefs[key] = el.type === "checkbox" ? el.checked : el.value;
        store.set("prefs", prefs);
        if (key === "reduceMotion") document.documentElement.style.setProperty("--motion", el.checked ? "0" : "1");
        if (key === "lang" && el.value !== "es") toast("La traducción del panel llega en una próxima versión");
        else toast("Preferencia guardada", "ok");
      });
    });

    // Tema
    const theme = store.get("theme", "dark");
    $$('#themeCards input[name="theme"]').forEach((r) => {
      r.checked = r.value === theme;
      r.addEventListener("change", () => {
        store.set("theme", r.value);
        applyTheme(r.value);
        toast(`Tema: ${r.value === "dark" ? "oscuro" : r.value === "light" ? "claro" : "según el sistema"}`, "ok");
      });
    });

    // Matriz de notificaciones
    const matrix = Object.assign({}, DEFAULT_MATRIX, store.get("notifMatrix", {}));
    $("#notifMatrix tbody").innerHTML = NOTIF_EVENTS.map(
      ([key, label, help]) => `
      <tr>
        <td><strong>${label}</strong><small>${help}</small></td>
        ${["panel", "email", "whatsapp"].map((ch) => `<td><label class="switch is-sm"><input type="checkbox" data-ev="${key}" data-ch="${ch}" ${matrix[key][ch] ? "checked" : ""} /><span class="track"></span></label></td>`).join("")}
      </tr>`,
    ).join("");
    $("#notifMatrix").addEventListener("change", (e) => {
      const i = e.target;
      if (!i.dataset.ev) return;
      matrix[i.dataset.ev] = Object.assign({}, matrix[i.dataset.ev], { [i.dataset.ch]: i.checked });
      store.set("notifMatrix", matrix);
      toast("Preferencia guardada", "ok");
    });
  }

  // =====================================================================
  //  BÚSQUEDA RÁPIDA
  //  Panel raíz: busca en todo. Las secciones con contenido (notificaciones,
  //  órdenes, facturas, perfil) se abren dentro del cuadro en un segundo
  //  panel que se desliza, con "Volver" y filtro propio.
  // =====================================================================

  const palette = $("#palette");
  const paletteBackdrop = $("#paletteBackdrop"), paletteInput = $("#paletteInput");
  const paletteResults = $("#paletteResults"), paletteDetail = $("#paletteDetail");
  const paletteCrumbTitle = $("#paletteCrumbTitle");

  // Estado: sección abierta (null = raíz), ítems del panel activo, foco, query de la raíz
  const pal = { section: null, items: [], idx: 0, rootQuery: "" };

  const NOTIF_TYPE_LABEL = { venta: "Venta", reserva: "Reserva", pago: "Pago", stock: "Stock", sistema: "Sistema" };
  const truncate = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

  // ---- Ítems reutilizables ----
  const itemOrder = (o) => ({
    icon: "shopping_cart",
    title: `${o.id} · ${o.customer.name}`,
    sub: `${fmtDate(o.date)} · ${o.items[0].product.name}${o.items.length > 1 ? ` +${o.items.length - 1}` : ""}`,
    right: `${badge(ORDER_STATUS, o.status)}<span class="meta">$${formatPrice(o.total)}</span>`,
    run: () => { showView("ordenes", { tab: "ventas" }); openOrderDrawer(o); },
  });
  const itemReserva = (r) => ({
    icon: "event",
    title: `${r.id} · ${r.customer.name}`,
    sub: `${r.product.name} · vence ${fmtDate(r.expires)}`,
    right: badge(RESERVA_STATUS, r.status),
    run: () => { showView("ordenes", { tab: "reservas" }); openReservaDrawer(r); },
  });
  const itemInvoice = (i) => ({
    icon: "receipt_long",
    title: `${INV_TYPE[i.type]} ${i.id}`,
    sub: `${i.customer.name} · ${i.order ? i.order.id : ""} · ${fmtDate(i.date)}`,
    right: `<span class="meta">$${formatPrice(i.total)}</span>`,
    run: () => { showView("facturas", { tab: "emitidas" }); previewInvoice(i); },
  });
  const itemReceipt = (r) => ({
    icon: "account_balance",
    title: `Comprobante ${r.id} · ${r.customer.name}`,
    sub: `${r.order ? r.order.id : ""} · ${r.bank || "transferencia"} · ${fmtDateTime(r.date)}`,
    right: `${badge(RECEIPT_STATUS, r.status)}<span class="meta">$${formatPrice(r.amount)}</span>`,
    run: () => { showView("facturas", { tab: "recibidos" }); previewReceipt(r); },
  });
  const itemNotif = (n) => ({
    icon: n.icon,
    title: n.title,
    sub: truncate(n.body, 90),
    right: `<span class="meta">${fmtRelative(n.date)}</span>${isRead(n) ? "" : '<span class="badge is-info is-plain">Nueva</span>'}`,
    run: () => openNotification(n),
  });
  const itemProduct = (p) => ({
    icon: "inventory_2",
    title: p.name,
    sub: `${p.sku} · ${(CATEGORIES[p.cat] || { label: "" }).label}${p.sub ? " · " + p.sub : ""}`,
    right: `<span class="meta">${formatPrice(p.price)}</span>${p.stock === 0 ? '<span class="badge is-bad">Sin stock</span>' : p.stock <= p.stockMin ? `<span class="badge is-warn">${p.stock} u.</span>` : `<span class="meta">${p.stock} u.</span>`}`,
    run: () => { showView("productos"); openProductDrawer(p); },
  });
  const itemCustomer = (c) => ({
    icon: "person",
    title: c.name,
    sub: `${c.email} · ${c.phone}`,
    right: `<span class="meta">${ORDERS.filter((o) => o.customer.id === c.id).length} órdenes</span>`,
    run: () => { showView("ordenes", { tab: "ventas" }); $("#ordersSearch").value = c.name; $("#ordersSearch").dispatchEvent(new Event("input")); },
  });

  const matches = (q, ...parts) => !q || normalize(parts.join(" ")).includes(q);

  // ---- Secciones (las que tienen "browse" se abren adentro del cuadro) ----
  const PROFILE_TABS = [
    { tab: "perfil", icon: "person", label: "Perfil", sub: "Foto, datos de la cuenta y seguridad" },
    { tab: "config", icon: "settings", label: "Configuración", sub: "Tema, idioma, región y preferencias" },
    { tab: "notif", icon: "notifications_active", label: "Notificaciones", sub: "Qué recibís y por dónde" },
    { tab: "about", icon: "info", label: "Acerca de", sub: "Versión, soporte y novedades" },
  ];
  const itemProfileTab = (t, prefix) => ({
    icon: t.icon,
    title: t.label,
    sub: (prefix || "") + t.sub,
    run: () => showView("perfil", { tab: t.tab }),
  });

  const SECTIONS = [
    { view: "dashboard", icon: "dashboard", label: "Dashboard", sub: "Resumen general" },
    {
      view: "notificaciones", icon: "notifications", label: "Notificaciones", sub: "Avisos de la tienda",
      count: () => `${unreadCount()} sin leer`,
      browse: (q) => [["Notificaciones", NOTIFS.filter((n) => matches(q, n.title, n.body, NOTIF_TYPE_LABEL[n.type])).map(itemNotif)]],
    },
    { view: "analiticas", icon: "analytics", label: "Analíticas", sub: "Estadísticas de ventas" },
    {
      view: "ordenes", icon: "orders", label: "Órdenes", sub: "Ventas y reservas",
      count: () => `${ORDERS.length} ventas · ${RESERVAS.length} reservas`,
      browse: (q) => [
        ["Ventas", ORDERS.filter((o) => matches(q, o.id, o.customer.name, o.customer.email, ORDER_STATUS[o.status].label, PAYMENTS[o.payment].label, ...o.items.map((i) => i.product.name))).slice(0, q ? 40 : 20).map(itemOrder)],
        ["Reservas", RESERVAS.filter((r) => matches(q, r.id, r.customer.name, r.product.name, RESERVA_STATUS[r.status].label)).map(itemReserva)],
      ],
    },
    {
      view: "facturas", icon: "receipt_long", label: "Facturas", sub: "Comprobantes emitidos y recibidos",
      count: () => `${INVOICES.length} emitidas · ${RECEIPTS.length} recibidos`,
      browse: (q) => [
        ["Facturas emitidas", INVOICES.filter((i) => matches(q, i.id, i.customer.name, i.order.id, INV_TYPE[i.type])).slice(0, q ? 40 : 20).map(itemInvoice)],
        ["Comprobantes recibidos", RECEIPTS.filter((r) => matches(q, r.id, r.customer.name, r.order.id, r.bank, RECEIPT_STATUS[r.status].label)).map(itemReceipt)],
      ],
    },
    { view: "cargas", icon: "upload", label: "Cargas", sub: "Publicar un producto" },
    {
      view: "perfil", icon: "person", label: "Mi perfil", sub: "Cuenta y configuración",
      browse: (q) => [["Pestañas", PROFILE_TABS.filter((t) => matches(q, t.label, t.sub)).map((t) => itemProfileTab(t))]],
    },
  ];

  const itemSection = (s) => ({
    icon: s.icon,
    title: s.label,
    sub: s.sub,
    browse: !!s.browse,
    right: s.browse ? `<span class="meta">${s.count ? s.count() : ""}</span><svg class="chev"><use href="#ic-chevron_right" /></svg>` : "",
    run: () => (s.browse ? enterSection(s) : showView(s.view)),
  });

  // ---- Render ----
  function renderGroups(container, groups, emptyText) {
    groups = groups.filter((g) => g[1].length);
    pal.items = groups.flatMap((g) => g[1]);
    pal.idx = 0;
    if (!pal.items.length) {
      container.innerHTML = `<div class="palette-empty">${emptyText}</div>`;
      return;
    }
    let idx = 0;
    container.innerHTML = groups
      .map(
        ([name, items]) =>
          `<div class="palette-group">${name}</div>` +
          items
            .map(
              (it) =>
                `<button class="palette-item ${idx === 0 ? "is-focused" : ""}" type="button" data-idx="${idx++}">
                  <svg><use href="#ic-${escapeHtml(it.icon)}" /></svg>
                  <div class="body"><strong>${escapeHtml(it.title)}</strong><small>${escapeHtml(it.sub)}</small></div>
                  ${it.right || ""}
                </button>`,
            )
            .join(""),
      )
      .join("");
    container.scrollTop = 0;
  }

  function searchRoot(q) {
    q = normalize(q);
    const groups = [["Secciones", SECTIONS.filter((s) => matches(q, s.label, s.sub)).map(itemSection)]];
    if (q) {
      groups.push(
        ["Órdenes", ORDERS.filter((o) => matches(q, o.id, o.customer.name, o.customer.email, ORDER_STATUS[o.status].label, ...o.items.map((i) => i.product.name))).slice(0, 5).map(itemOrder)],
        ["Reservas", RESERVAS.filter((r) => matches(q, r.id, r.customer.name, r.product.name)).slice(0, 4).map(itemReserva)],
        ["Facturas", INVOICES.filter((i) => matches(q, i.id, i.customer.name, i.order.id)).slice(0, 4).map(itemInvoice)],
        ["Comprobantes", RECEIPTS.filter((r) => matches(q, r.id, r.customer.name, r.order.id, r.bank)).slice(0, 3).map(itemReceipt)],
        ["Notificaciones", NOTIFS.filter((n) => matches(q, n.title, n.body)).slice(0, 4).map(itemNotif)],
        ["Productos", PRODUCTS.filter((p) => matches(q, p.name, p.sku, p.sub || "")).slice(0, 4).map(itemProduct)],
        ["Clientes", CUSTOMERS.filter((c) => matches(q, c.name, c.email, c.phone)).slice(0, 3).map(itemCustomer)],
        ["Configuración", PROFILE_TABS.filter((t) => matches(q, t.label, t.sub)).map((t) => itemProfileTab(t, "Mi perfil · "))],
      );
    }
    renderGroups(paletteResults, groups, `Sin resultados para "${escapeHtml(q)}"`);
  }

  function searchSection(q) {
    const s = pal.section;
    renderGroups(paletteDetail, s.browse(normalize(q)), `Nada en ${s.label} coincide con "${escapeHtml(q)}"`);
  }

  function enterSection(s) {
    pal.section = s;
    pal.rootQuery = paletteInput.value;
    paletteCrumbTitle.textContent = s.label;
    paletteInput.value = "";
    paletteInput.placeholder = `Buscar en ${s.label}…`;
    palette.classList.add("is-detail");
    searchSection("");
    paletteInput.focus();
  }

  function leaveSection() {
    if (!pal.section) return;
    pal.section = null;
    palette.classList.remove("is-detail");
    paletteInput.value = pal.rootQuery;
    paletteInput.placeholder = "Buscar en todo el panel…";
    searchRoot(pal.rootQuery);
    paletteInput.focus();
  }

  function openPalette() {
    pal.section = null;
    pal.rootQuery = "";
    palette.classList.remove("is-detail");
    paletteInput.value = "";
    paletteInput.placeholder = "Buscar en todo el panel…";
    paletteBackdrop.classList.add("is-open");
    searchRoot("");
    setTimeout(() => paletteInput.focus(), 30);
  }
  function closePalette() {
    paletteBackdrop.classList.remove("is-open");
  }

  function activePane() {
    return pal.section ? paletteDetail : paletteResults;
  }

  function focusPalette(i) {
    if (!pal.items.length) return;
    pal.idx = (i + pal.items.length) % pal.items.length;
    $$(".palette-item", activePane()).forEach((el) => el.classList.toggle("is-focused", +el.dataset.idx === pal.idx));
    const f = $(".palette-item.is-focused", activePane());
    f && f.scrollIntoView({ block: "nearest" });
  }

  // Las secciones navegables se quedan dentro del cuadro; cualquier otro ítem lo cierra
  function runFocused() {
    const it = pal.items[pal.idx];
    if (!it) return;
    if (it.browse) return it.run();
    closePalette();
    it.run();
  }

  paletteInput.addEventListener("input", () => (pal.section ? searchSection(paletteInput.value) : searchRoot(paletteInput.value)));
  paletteInput.addEventListener("keydown", (e) => {
    const cur = pal.items[pal.idx];
    if (e.key === "ArrowDown") { e.preventDefault(); focusPalette(pal.idx + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusPalette(pal.idx - 1); }
    else if (e.key === "Enter") { e.preventDefault(); runFocused(); }
    else if (e.key === "ArrowRight" && !pal.section && cur && cur.browse) { e.preventDefault(); runFocused(); }
    else if ((e.key === "ArrowLeft" || e.key === "Backspace") && pal.section && !paletteInput.value) { e.preventDefault(); leaveSection(); }
  });
  $("#paletteTrack").addEventListener("click", (e) => {
    const b = e.target.closest(".palette-item");
    if (!b) return;
    pal.idx = +b.dataset.idx;
    runFocused();
  });
  $("#paletteBack").addEventListener("click", leaveSection);
  $("#paletteOpenSection").addEventListener("click", () => {
    if (!pal.section) return;
    const v = pal.section.view;
    closePalette();
    showView(v);
  });
  paletteBackdrop.addEventListener("click", (e) => e.target === paletteBackdrop && closePalette());
  $("#sbSearch").addEventListener("click", openPalette);
  $("#topSearchBtn").addEventListener("click", openPalette);

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      paletteBackdrop.classList.contains("is-open") ? closePalette() : openPalette();
    } else if (e.key === "Escape") {
      if (paletteBackdrop.classList.contains("is-open")) pal.section ? leaveSection() : closePalette();
      else if (modalBackdrop.classList.contains("is-open")) closeModal();
      else if (drawer.classList.contains("is-open")) closeDrawer();
      else closeSidebarMobile();
    }
  });

  // =====================================================================
  //  LOGOUT
  // =====================================================================

  $("#logoutBtn").addEventListener("click", async () => {
    const ok = await confirmModal({ title: "Cerrar sesión", text: `Vas a salir del panel con la cuenta ${USER.email}.`, okText: "Cerrar sesión" });
    if (ok) {
      await signOut();
      window.location.href = "login.html#login";
    }
  });

  // =====================================================================
  //  INIT
  // =====================================================================

  const RENDERERS = {
    notificaciones: renderNotifs,
    dashboard: renderDashboard,
    analiticas: renderAnalytics,
    ordenes: renderOrders,
    productos: renderProducts,
    facturas: renderInvoices,
    cargas: renderUpload,
    perfil: renderProfile,
  };

  applyAvatar();
  applyTheme(store.get("theme", "dark"));

  // Realtime: cada cambio en la base refresca la vista que corresponda
  onChange((what) => {
    updateNotifBadges();
    if (rendered.notificaciones && what === "notifs") renderNotifs();
    if (rendered.dashboard && what !== "notifs") renderDashboard();
    if (rendered.analiticas && (what === "orders" || what === "products" || what === "reservas")) renderAnalytics();
    if (rendered.ordenes && RENDERERS._redrawOrders && what !== "notifs") RENDERERS._redrawOrders();
    if (rendered.facturas && (what === "orders" || what === "invoices" || what === "receipts")) {
      RENDERERS._redrawInvoices && RENDERERS._redrawInvoices();
      RENDERERS._redrawReceipts && RENDERERS._redrawReceipts();
    }
    if (rendered.cargas && what === "products" && RENDERERS._redrawUploaded) RENDERERS._redrawUploaded();
    if (rendered.productos && what === "products" && RENDERERS._redrawProducts) RENDERERS._redrawProducts();
    if (drawerOpen && drawer.classList.contains("is-open")) {
      if (drawerOpen.type === "product" && what === "products") {
        const p = PRODUCTS.find((x) => x.id === drawerOpen.uuid);
        p ? openProductDrawer(p) : closeDrawer();
      }
      if (drawerOpen.type === "order" && (what === "orders" || what === "invoices" || what === "receipts")) {
        const o = ORDERS.find((x) => x.uuid === drawerOpen.uuid);
        o && openOrderDrawer(o);
      }
      if (drawerOpen.type === "reserva" && what === "reservas") {
        const r = RESERVAS.find((x) => x.uuid === drawerOpen.uuid);
        r && openReservaDrawer(r);
      }
    }
    if (what === "notifs") {
      const latest = NOTIFS[0];
      if (latest && !isRead(latest) && Date.now() - latest.date.getTime() < 15000) toast(latest.title);
    }
  });
  startRealtime();
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => applyTheme(store.get("theme", "dark")));
  updateNotifBadges();

  const prefs = Object.assign({}, DEFAULT_PREFS, store.get("prefs", {}));
  const savedCollapsed = store.get("collapsed", null);
  setCollapsed(savedCollapsed === null ? !!prefs.startCollapsed : savedCollapsed);

  // Perfil se renderiza siempre (los switches de preferencias tienen que estar listos)
  rendered.perfil = true;
  renderProfile();

  const hash = location.hash.replace("#", "");
  showView(VIEW_META[hash] ? hash : prefs.homeView || "dashboard", { silent: true });
  window.addEventListener("hashchange", () => {
    const h = location.hash.replace("#", "");
    if (VIEW_META[h]) showView(h, { silent: true });
  });
})();
