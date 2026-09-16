// Panel de administración (dashboard.html).
// Todo corre en el navegador con datos de demostración generados de forma
// determinística (misma semilla => mismos datos). Lo que el usuario cambia
// (notificaciones leídas, productos cargados, preferencias, avatar, tema)
// se persiste en localStorage con prefijo "cs_admin_".
(function () {
  const { formatPrice, parsePrice, escapeHtml, loadList, saveList } = window.CS;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const TODAY = new Date(2026, 8, 15, 18, 30); // fecha de referencia de la demo
  const DAY = 86400000;

  const USER = {
    name: "Nicolás Corera",
    email: "nicolas.corera@gmail.com",
  };

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
  function rng(seed) {
    // mulberry32: aleatorio determinístico
    let a = seed >>> 0;
    return function () {
      a += 0x6d2b79f5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

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
  //  DATOS DE DEMOSTRACIÓN
  // =====================================================================

  const CATEGORIES = {
    computadoras: { label: "Computadoras", subs: [] },
    notebooks: { label: "Notebooks", subs: [] },
    componentes: {
      label: "Componentes",
      subs: [
        "Placas de video", "Procesadores", "Memorias RAM", "Almacenamiento",
        "Motherboards", "Fuentes", "Gabinetes", "Refrigeración",
      ],
    },
    perifericos: {
      label: "Periféricos",
      subs: [
        "Teclados", "Mouse", "Auriculares", "Monitores", "Micrófonos",
        "Parlantes", "Webcams", "Mousepads",
      ],
    },
  };

  const IMGS = {
    pc1: "/assets/images/pc1.webp",
    pc2: "/assets/images/pc2.webp",
    pc3: "/assets/images/pc3.webp",
    pcw: "/assets/images/PCWhite.webp",
    pc: "/assets/images/PC.png",
  };

  const PRODUCTS = [
    { id: "p1", name: "PC Armada AMD Ryzen 5 5500, RTX 3050, 16GB RAM, 512GB SSD", price: 1304424, cat: "computadoras", img: IMGS.pc1, stock: 4, sku: "CS-5500-3050-16-512" },
    { id: "p2", name: "PC Gamer Intel Core i5 12400F, RTX 4060, 16GB DDR4, 1TB NVMe", price: 1789900, cat: "computadoras", img: IMGS.pc2, stock: 2, sku: "CS-12400-4060-16-1T" },
    { id: "p3", name: "PC Armada AMD Ryzen 7 5700X, RTX 4070, 32GB RAM, 1TB SSD", price: 2649000, cat: "computadoras", img: IMGS.pc3, stock: 1, sku: "CS-5700-4070-32-1T" },
    { id: "p4", name: "PC Oficina Intel Core i3 12100, 8GB RAM, 256GB SSD", price: 549900, cat: "computadoras", img: IMGS.pcw, stock: 9, sku: "CS-12100-8-256" },
    { id: "p5", name: "PC Gamer White Edition Ryzen 5 7600, RTX 4060 Ti, 32GB DDR5", price: 2199000, cat: "computadoras", img: IMGS.pcw, stock: 3, sku: "CS-7600-4060TI-32" },
    { id: "p6", name: "Notebook Lenovo IdeaPad 3 Ryzen 5 7520U 8GB 512GB 15.6\"", price: 899900, cat: "notebooks", img: IMGS.pc, stock: 6, sku: "NB-LEN-IP3-7520" },
    { id: "p7", name: "Notebook ASUS TUF Gaming F15 i5 RTX 3050 16GB 512GB", price: 1549000, cat: "notebooks", img: IMGS.pc, stock: 2, sku: "NB-ASUS-TUF-F15" },
    { id: "p8", name: "Notebook HP 15 Intel Core i7 1255U 16GB 512GB", price: 1199000, cat: "notebooks", img: IMGS.pc, stock: 0, sku: "NB-HP-15-I7" },
    { id: "p9", name: "Placa de video NVIDIA GeForce RTX 4060 8GB GDDR6", price: 619900, cat: "componentes", sub: "Placas de video", img: IMGS.pc, stock: 7, sku: "CO-GPU-4060-8" },
    { id: "p10", name: "Procesador AMD Ryzen 5 5600 AM4", price: 189900, cat: "componentes", sub: "Procesadores", img: IMGS.pc, stock: 12, sku: "CO-CPU-5600" },
    { id: "p11", name: "Memoria RAM Kingston Fury Beast 16GB DDR4 3200MHz", price: 62900, cat: "componentes", sub: "Memorias RAM", img: IMGS.pc, stock: 25, sku: "CO-RAM-KF-16-3200" },
    { id: "p12", name: "SSD Kingston NV2 1TB NVMe PCIe 4.0", price: 94900, cat: "componentes", sub: "Almacenamiento", img: IMGS.pc, stock: 18, sku: "CO-SSD-NV2-1T" },
    { id: "p13", name: "Fuente Corsair CV650 650W 80 Plus Bronze", price: 109900, cat: "componentes", sub: "Fuentes", img: IMGS.pc, stock: 2, sku: "CO-PSU-CV650" },
    { id: "p14", name: "Teclado mecánico Redragon Kumara K552 RGB", price: 54900, cat: "perifericos", sub: "Teclados", img: IMGS.pc, stock: 14, sku: "PE-KB-K552" },
    { id: "p15", name: "Mouse Logitech G502 Hero 25K", price: 79900, cat: "perifericos", sub: "Mouse", img: IMGS.pc, stock: 3, sku: "PE-MS-G502" },
    { id: "p16", name: "Monitor Samsung Odyssey G5 27\" 165Hz QHD", price: 449900, cat: "perifericos", sub: "Monitores", img: IMGS.pc, stock: 5, sku: "PE-MON-G5-27" },
    { id: "p17", name: "Auriculares HyperX Cloud II 7.1", price: 119900, cat: "perifericos", sub: "Auriculares", img: IMGS.pc, stock: 8, sku: "PE-HS-CLOUD2" },
  ];

  const CUSTOMERS = [
    ["Martín González", "martin.gonzalez@gmail.com", "11 4567-8901", "32.456.789", "Av. Rivadavia 4520, CABA"],
    ["Rocío Pereyra", "rocio.pereyra@hotmail.com", "11 5678-9012", "35.123.456", "Belgrano 1180, Quilmes"],
    ["Lucas Fernández", "lucasf@outlook.com", "11 2345-6789", "38.765.432", "Mitre 830, San Isidro"],
    ["Camila Sosa", "cami.sosa@gmail.com", "11 6789-0123", "40.111.222", "Córdoba 2210, Rosario"],
    ["Julián Ríos", "julian.rios@gmail.com", "11 3456-7890", "36.987.654", "San Martín 455, Lanús"],
    ["Florencia Díaz", "flor.diaz@yahoo.com", "11 7890-1234", "41.222.333", "Alsina 990, Morón"],
    ["Tomás Herrera", "tomas.herrera@gmail.com", "11 8901-2345", "33.444.555", "Av. Santa Fe 3100, CABA"],
    ["Valentina Cruz", "valen.cruz@gmail.com", "11 9012-3456", "42.555.666", "Las Heras 720, Tigre"],
    ["Agustín Molina", "agus.molina@gmail.com", "11 0123-4567", "37.666.777", "Sarmiento 1500, La Plata"],
    ["Sofía Romero", "sofi.romero@gmail.com", "11 1234-5678", "39.777.888", "Av. Cabildo 2345, CABA"],
    ["Bruno Castro", "bruno.castro@gmail.com", "11 4321-8765", "34.888.999", "Italia 610, Avellaneda"],
    ["Micaela Vega", "mica.vega@gmail.com", "11 8765-4321", "43.999.000", "Brown 150, Adrogué"],
  ].map((c, i) => ({ id: "c" + (i + 1), name: c[0], email: c[1], phone: c[2], dni: c[3], address: c[4] }));

  const PAYMENTS = {
    credito: { label: "Tarjeta de crédito", surcharge: 0.1 },
    debito: { label: "Tarjeta de débito", surcharge: 0.03 },
    transferencia: { label: "Transferencia", surcharge: 0 },
    mercadopago: { label: "Mercado Pago", surcharge: 0.05 },
  };

  const ORDER_STATUS = {
    pendiente: { label: "Pendiente de pago", cls: "is-warn" },
    pagado: { label: "Pagado", cls: "is-info" },
    preparando: { label: "En preparación", cls: "is-info" },
    enviado: { label: "Enviado", cls: "is-info" },
    entregado: { label: "Entregado", cls: "is-ok" },
    cancelado: { label: "Cancelado", cls: "is-bad" },
  };

  const RESERVA_STATUS = {
    activa: { label: "Activa", cls: "is-info" },
    "por-vencer": { label: "Por vencer", cls: "is-warn" },
    retirada: { label: "Retirada", cls: "is-ok" },
    vencida: { label: "Vencida", cls: "is-muted" },
    cancelada: { label: "Cancelada", cls: "is-bad" },
  };

  // Genera ~140 órdenes en los últimos 12 meses, más densas en los últimos días.
  function generateOrders() {
    const rand = rng(20260915);
    const orders = [];
    let seq = 10480;
    const total = 150;
    for (let i = 0; i < total; i++) {
      // distribución sesgada hacia lo reciente
      const r = rand();
      const daysAgo = Math.floor(Math.pow(r, 1.6) * 365);
      const hour = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 9, 23, 8][
        Math.floor(Math.pow(rand(), 0.8) * 16)
      ];
      const date = new Date(TODAY.getTime() - daysAgo * DAY);
      date.setHours(hour, Math.floor(rand() * 60), 0, 0);

      const customer = CUSTOMERS[Math.floor(rand() * CUSTOMERS.length)];
      const nItems = rand() < 0.7 ? 1 : rand() < 0.7 ? 2 : 3;
      const items = [];
      const used = new Set();
      for (let k = 0; k < nItems; k++) {
        let p = PRODUCTS[Math.floor(rand() * PRODUCTS.length)];
        if (used.has(p.id)) continue;
        used.add(p.id);
        const qty = p.price > 500000 ? 1 : 1 + Math.floor(rand() * 2);
        items.push({ product: p, qty, price: p.price });
      }
      const payKeys = Object.keys(PAYMENTS);
      const payment = payKeys[Math.floor(Math.pow(rand(), 1.3) * payKeys.length)];
      const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
      const shippingMethod = rand() < 0.7 ? "domicilio" : "retiro";
      const shipping = shippingMethod === "domicilio" ? (subtotal > 1200000 ? 0 : 15000) : 0;
      const surcharge = Math.round(subtotal * PAYMENTS[payment].surcharge);
      const total = subtotal + shipping + surcharge;

      let status;
      const s = rand();
      if (daysAgo === 0) status = s < 0.5 ? "pendiente" : s < 0.85 ? "pagado" : "preparando";
      else if (daysAgo < 3) status = s < 0.2 ? "pendiente" : s < 0.5 ? "pagado" : s < 0.8 ? "preparando" : "enviado";
      else if (daysAgo < 8) status = s < 0.1 ? "cancelado" : s < 0.5 ? "enviado" : "entregado";
      else status = s < 0.07 ? "cancelado" : "entregado";

      orders.push({
        id: "CS-" + (seq + i),
        date,
        customer,
        items,
        payment,
        shippingMethod,
        shipping,
        surcharge,
        subtotal,
        total,
        status,
        installments: payment === "credito" && subtotal > 1200000 ? 3 : 1,
      });
    }
    orders.sort((a, b) => b.date - a.date);
    // renumerar en orden cronológico
    orders.forEach((o, i) => (o.id = "CS-" + (seq + orders.length - i)));
    return orders;
  }

  function generateReservas() {
    const rand = rng(777);
    const list = [];
    const statusPool = ["activa", "activa", "activa", "por-vencer", "retirada", "retirada", "vencida", "cancelada"];
    for (let i = 0; i < 14; i++) {
      const daysAgo = Math.floor(rand() * 20) - 2;
      const date = new Date(TODAY.getTime() - daysAgo * DAY);
      date.setHours(10 + Math.floor(rand() * 10), Math.floor(rand() * 60), 0, 0);
      const product = PRODUCTS[Math.floor(rand() * PRODUCTS.length)];
      const customer = CUSTOMERS[Math.floor(rand() * CUSTOMERS.length)];
      const expires = new Date(date.getTime() + 7 * DAY);
      let status = statusPool[Math.floor(rand() * statusPool.length)];
      const daysToExpire = Math.round((expires - TODAY) / DAY);
      if (status === "activa" && daysToExpire <= 2 && daysToExpire >= 0) status = "por-vencer";
      if ((status === "activa" || status === "por-vencer") && daysToExpire < 0) status = "vencida";
      list.push({
        id: "RS-" + pad(120 + i),
        date,
        expires,
        customer,
        product,
        qty: 1,
        deposit: Math.round(product.price * 0.2),
        status,
        note: rand() < 0.3 ? "Consulta por cambio de RAM a 32GB" : "",
      });
    }
    list.sort((a, b) => b.date - a.date);
    return list;
  }

  const ORDERS = generateOrders();
  const RESERVAS = generateReservas();

  // Facturas: una por orden pagada (o posterior). Comprobantes: transferencias.
  const INVOICES = ORDERS.filter((o) => o.status !== "pendiente" && o.status !== "cancelado").map(
    (o, i) => {
      const rand = rng(i + 99);
      const type = rand() < 0.15 ? "A" : "B";
      return {
        id: `${type}-0003-${pad(String(20000 + i)).padStart(8, "0")}`,
        type,
        order: o,
        date: o.date,
        customer: o.customer,
        total: o.total,
        cae: String(76000000000000 + Math.floor(rand() * 999999999)),
      };
    },
  );
  // Un par de notas de crédito para órdenes canceladas
  ORDERS.filter((o) => o.status === "cancelado")
    .slice(0, 3)
    .forEach((o, i) => {
      INVOICES.push({
        id: `NC-0003-${String(300 + i).padStart(8, "0")}`,
        type: "NC",
        order: o,
        date: new Date(o.date.getTime() + DAY),
        customer: o.customer,
        total: o.total,
        cae: String(76000000000000 + i * 12345),
      });
    });
  INVOICES.sort((a, b) => b.date - a.date);

  const RECEIPTS = ORDERS.filter((o) => o.payment === "transferencia").map((o, i) => {
    const rand = rng(i + 500);
    let status = "aprobado";
    if (o.status === "pendiente") status = "pendiente";
    else if (o.status === "cancelado") status = "rechazado";
    return {
      id: "CP-" + pad(900 + i),
      order: o,
      customer: o.customer,
      date: new Date(o.date.getTime() + Math.floor(rand() * 6) * 3600000),
      amount: o.total,
      bank: ["Banco Galicia", "Banco Nación", "Mercado Pago", "Brubank", "Santander"][Math.floor(rand() * 5)],
      reference: String(100000000 + Math.floor(rand() * 899999999)),
      file: "/assets/images/image_test.jpg",
      status,
    };
  });

  // Notificaciones generadas a partir de los datos
  function buildNotifications() {
    const list = [];
    ORDERS.slice(0, 6).forEach((o) => {
      list.push({
        id: "n-venta-" + o.id,
        type: "venta",
        icon: "shopping_cart",
        title: `Nueva venta ${o.id}`,
        body: `${o.customer.name} compró ${o.items[0].product.name}${o.items.length > 1 ? ` y ${o.items.length - 1} más` : ""} por $${formatPrice(o.total)}.`,
        date: o.date,
        target: { view: "ordenes", tab: "ventas", order: o.id },
      });
    });
    RESERVAS.filter((r) => r.status === "activa" || r.status === "por-vencer")
      .slice(0, 4)
      .forEach((r) => {
        list.push({
          id: "n-reserva-" + r.id,
          type: "reserva",
          icon: "event",
          title: r.status === "por-vencer" ? `Reserva ${r.id} por vencer` : `Nueva reserva ${r.id}`,
          body: `${r.customer.name} reservó ${r.product.name}. Seña: $${formatPrice(r.deposit)}. Vence el ${fmtDate(r.expires)}.`,
          date: r.status === "por-vencer" ? new Date(TODAY - 3 * 3600000) : r.date,
          target: { view: "ordenes", tab: "reservas", reserva: r.id },
        });
      });
    RECEIPTS.filter((r) => r.status === "pendiente")
      .slice(0, 3)
      .forEach((r) => {
        list.push({
          id: "n-pago-" + r.id,
          type: "pago",
          icon: "account_balance",
          title: `Comprobante recibido · ${r.order.id}`,
          body: `${r.customer.name} envió un comprobante de transferencia por $${formatPrice(r.amount)} (${r.bank}). Pendiente de revisión.`,
          date: r.date,
          target: { view: "facturas", tab: "recibidos" },
        });
      });
    PRODUCTS.filter((p) => p.stock <= 2).forEach((p, i) => {
      list.push({
        id: "n-stock-" + p.id,
        type: "stock",
        icon: "inventory_2",
        title: p.stock === 0 ? "Sin stock" : "Stock bajo",
        body: `${p.name}: ${p.stock === 0 ? "se agotó" : `quedan ${p.stock} unidad${p.stock === 1 ? "" : "es"}`}.`,
        date: new Date(TODAY - (i + 1) * 5 * 3600000),
        target: { view: "cargas" },
      });
    });
    list.push(
      {
        id: "n-sys-1",
        type: "sistema",
        icon: "verified",
        title: "Panel actualizado a la versión 1.0.0",
        body: "Nuevas analíticas, búsqueda rápida y formulario de carga completo. Mirá las novedades en Acerca de.",
        date: new Date(TODAY - 2 * DAY),
        target: { view: "perfil", tab: "about" },
      },
      {
        id: "n-sys-2",
        type: "sistema",
        icon: "star_rate",
        title: "Nueva opinión de 5 estrellas",
        body: "Martín G. dejó una reseña en PC Armada AMD Ryzen 5 5500: \"Llegó bien embalado y anduvo perfecto desde el primer arranque\".",
        date: new Date(TODAY - 5 * DAY),
        target: { view: "analiticas" },
      },
    );
    list.sort((a, b) => b.date - a.date);
    return list;
  }

  const NOTIFS = buildNotifications();
  let readIds = new Set(store.get("read", []));

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
    return NOTIFS.filter((n) => !readIds.has(n.id)).length;
  }

  function updateNotifBadges() {
    const c = unreadCount();
    $("#sbNotifBadge").textContent = c ? String(c) : "";
    $("#topNotifDot").textContent = c ? " " : "";
    $$("#notifChips [data-count]").forEach((el) => {
      const t = el.dataset.count;
      const n = NOTIFS.filter((x) => (t === "todas" || x.type === t) && !readIds.has(x.id)).length;
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
        <article class="notif ${readIds.has(n.id) ? "" : "is-unread"}" data-id="${n.id}">
          <span class="notif-icon is-${n.type}"><svg><use href="#ic-${n.icon}" /></svg></span>
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
    readIds.add(n.id);
    store.set("read", Array.from(readIds));
    const el = $(`.notif[data-id="${n.id}"]`, notifList);
    el && el.classList.remove("is-unread");
    updateNotifBadges();
    if (n.target) {
      showView(n.target.view, { tab: n.target.tab });
      if (n.target.order) openOrderDrawer(ORDERS.find((o) => o.id === n.target.order));
      if (n.target.reserva) openReservaDrawer(RESERVAS.find((r) => r.id === n.target.reserva));
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
    NOTIFS.forEach((n) => readIds.add(n.id));
    store.set("read", Array.from(readIds));
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
    const prevRev = prev.reduce((s, o) => s + o.total, 0) || 1;
    const ticket = cur.length ? Math.round(curRev / cur.length) : 0;
    const prevTicket = prev.length ? Math.round(prevRev / prev.length) : 1;
    const activeRes = RESERVAS.filter((r) => r.status === "activa" || r.status === "por-vencer").length;
    const pending = ORDERS.filter((o) => o.status === "pendiente").length;

    const delta = (a, b) => Math.round(((a - b) / (b || 1)) * 100);
    const spark = dailyRevenue(14).values;
    const sparkOrders = (() => {
      const arr = [];
      for (let i = 13; i >= 0; i--) {
        const s = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - i);
        arr.push(ordersBetween(s, new Date(s.getTime() + DAY)).length);
      }
      return arr;
    })();

    const kpi = (icon, label, value, d, sparkVals, money) => `
      <div class="kpi">
        <div class="kpi-head"><span>${label}</span><svg><use href="#ic-${icon}" /></svg></div>
        <div class="kpi-value ${money ? "is-money" : ""}">${value}</div>
        ${d !== null ? `<span class="kpi-delta ${d >= 0 ? "is-up" : "is-down"}"><svg><use href="#ic-${d >= 0 ? "trending_up" : "trending_down"}" /></svg><strong>${d >= 0 ? "+" : ""}${d}%</strong> vs. mes anterior</span>` : `<span class="kpi-delta">${sparkVals}</span>`}
        ${Array.isArray(sparkVals) ? sparkline(sparkVals, "#3b82f6") : ""}
      </div>`;

    $("#kpis").innerHTML =
      kpi("payments", "Ingresos del mes", formatPrice(curRev), delta(curRev, prevRev), spark, true) +
      kpi("orders", "Órdenes del mes", cur.length, delta(cur.length, prev.length), sparkOrders) +
      kpi("point_of_sale", "Ticket promedio", formatPrice(ticket), delta(ticket, prevTicket), null, true) +
      kpi("event", "Reservas activas", activeRes, null, `${pending} órdenes pendientes de pago`);

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
    $("#revenueRange").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      $$("#revenueRange button").forEach((x) => x.classList.toggle("is-active", x === b));
      drawRevenue(+b.dataset.days);
    });

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
    $("#topProducts").innerHTML = top
      .map(
        (t, i) => `
        <div class="list-item">
          <span class="rank ${i === 0 ? "is-top" : ""}">${i + 1}</span>
          <span class="thumb"><img src="${t.p.img}" alt="" /></span>
          <div class="body"><strong>${escapeHtml(t.p.name)}</strong><small>${t.qty} vendido${t.qty === 1 ? "" : "s"}</small></div>
          <span class="val is-money">${formatPrice(t.rev)}</span>
        </div>`,
      )
      .join("");

    // Órdenes recientes
    $("#recentOrders").innerHTML =
      `<thead><tr><th>Orden</th><th>Cliente</th><th>Fecha</th><th>Estado</th><th class="num">Total</th></tr></thead><tbody>` +
      ORDERS.slice(0, 6)
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
            <span class="thumb"><img src="${r.product.img}" alt="" /></span>
            <div class="body"><strong>${escapeHtml(r.customer.name)}</strong><small>${escapeHtml(r.product.name)}</small></div>
            <div style="text-align:right">${badge(RESERVA_STATUS, r.status)}<small class="muted" style="display:block;font-size:11.5px;color:var(--ink-soft);margin-top:3px">vence ${fmtDateShort(r.expires)}</small></div>
          </div>`,
          )
          .join("")
      : `<p style="color:var(--ink-soft);font-size:13.5px;margin:0">No hay reservas activas.</p>`;

    // Stock bajo
    const low = PRODUCTS.filter((p) => p.stock <= 2).slice(0, 4);
    $("#lowStock").innerHTML = low
      .map(
        (p) => `
        <div class="stock-alert">
          <svg><use href="#ic-warning" /></svg>
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.name)}</span>
          <strong>${p.stock === 0 ? "Sin stock" : p.stock + " u."}</strong>
        </div>`,
      )
      .join("");
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
        // reservas: la demo solo tiene reservas recientes; se estima proporcional
        res.push(i === 0 ? RESERVAS.length : Math.round(os.length * 0.35));
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
        kpi("group", "Clientes únicos", new Set(paid.map((o) => o.customer.id)).size, `${Math.round((paid.length / new Set(paid.map((o) => o.customer.id)).size) * 10) / 10} órdenes por cliente`) +
        kpi("cancel", "Tasa de cancelación", `${Math.round((cancel / ORDERS.length) * 100)}%`, `${cancel} de ${ORDERS.length} órdenes`);
    }
    draw(12);
    $("#analyticsRange").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      $$("#analyticsRange button").forEach((x) => x.classList.toggle("is-active", x === b));
      draw(+b.dataset.months);
    });

    // Categorías
    const byCat = {};
    ORDERS.filter(isPaid).forEach((o) =>
      o.items.forEach((it) => (byCat[it.product.cat] = (byCat[it.product.cat] || 0) + it.price * it.qty)),
    );
    const catColors = ["#3b82f6", "#ea580c", "#059669", "#9333ea"];
    hbars(
      $("#categoryBars"),
      Object.entries(byCat)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v], i) => ({ label: CATEGORIES[k].label, value: v, color: catColors[i] })),
      { format: (v) => "$" + fmtCompact(v) },
    );

    // Medios de pago
    const byPay = {};
    ORDERS.forEach((o) => (byPay[o.payment] = (byPay[o.payment] || 0) + 1));
    hbars(
      $("#paymentBars"),
      Object.entries(byPay)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v], i) => ({ label: PAYMENTS[k].label, value: v, color: catColors[i] })),
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

    // Visitas vs conversiones (visitas simuladas)
    const rand = rng(42);
    const wLabels = [], visits = [], convs = [];
    for (let i = 7; i >= 0; i--) {
      const start = new Date(TODAY.getTime() - (i + 1) * 7 * DAY);
      const end = new Date(TODAY.getTime() - i * 7 * DAY);
      const os = ordersBetween(start, end).length;
      wLabels.push("sem " + (8 - i));
      visits.push(Math.round(1800 + rand() * 900 + os * 40));
      convs.push(os * 100);
    }
    lineChart($("#conversionChart"), {
      labels: wLabels,
      series: [
        { name: "Visitas", color: "#3b82f6", values: visits },
        { name: "Órdenes (x100)", color: "#059669", values: convs },
      ],
      format: (v) => formatPrice(v),
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
            <td class="muted">${CATEGORIES[r.p.cat].label}</td>
            <td class="num">${r.qty}</td>
            <td class="num">${r.orders}</td>
            <td class="num">${r.p.stock === 0 ? '<span class="badge is-bad">0</span>' : r.p.stock <= 2 ? `<span class="badge is-warn">${r.p.stock}</span>` : r.p.stock}</td>
            <td class="num is-money">${formatPrice(r.rev)}</td>
            <td><div class="hbar-track"><div class="hbar-fill" style="width:${((r.rev / maxRev) * 100).toFixed(1)}%;background:var(--chart-1)"></div></div></td>
          </tr>`,
        )
        .join("") +
      "</tbody>";

    $("#exportAnalytics").addEventListener("click", () => {
      const lines = [["Producto", "Categoria", "Unidades", "Ordenes", "Stock", "Facturacion"]];
      Object.values(perf).forEach((r) =>
        lines.push([r.p.name, CATEGORIES[r.p.cat].label, r.qty, r.orders, r.p.stock, r.rev]),
      );
      downloadFile("analiticas-productos.csv", lines.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n"), "text/csv");
      toast("CSV exportado", "ok");
    });
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
              <td class="muted">${PAYMENTS[o.payment].label}</td>
              <td>${badge(ORDER_STATUS, o.status)}</td>
              <td class="num is-money">${formatPrice(o.total)}</td>
            </tr>`,
              )
              .join("")
          : `<tr><td colspan="7" class="table-empty">No hay órdenes que coincidan con los filtros.</td></tr>`) +
        "</tbody>" +
        (rows.length > pageSize ? `<tfoot><tr><td colspan="7" class="muted" style="text-align:center">Mostrando ${pageSize} de ${rows.length}. Refiná la búsqueda para ver el resto.</td></tr></tfoot>` : "");
    }
    [search, status, pay].forEach((el) => el.addEventListener("input", draw));
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
    [rSearch, rStatus].forEach((el) => el.addEventListener("input", drawRes));
    drawRes();
    RENDERERS._redrawOrders = () => {
      draw();
      drawRes();
    };
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

  const NEXT_STATUS = { pendiente: "pagado", pagado: "preparando", preparando: "enviado", enviado: "entregado" };
  const NEXT_LABEL = { pendiente: "Marcar como pagado", pagado: "Pasar a preparación", preparando: "Marcar como enviado", enviado: "Marcar como entregado" };

  function orderTimeline(o) {
    const steps = ["pendiente", "pagado", "preparando", "enviado", "entregado"];
    const idx = o.status === "cancelado" ? -1 : steps.indexOf(o.status);
    const labels = { pendiente: "Orden creada", pagado: "Pago confirmado", preparando: "En preparación", enviado: "Despachado", entregado: "Entregado" };
    let html = "";
    steps.forEach((s, i) => {
      const done = i <= idx;
      html += `<li class="${done ? "" : "is-pending"}">${labels[s]}${done ? `<small>${fmtDateTime(new Date(o.date.getTime() + i * 2 * 3600000))}</small>` : ""}</li>`;
    });
    if (o.status === "cancelado") html = `<li>Orden creada<small>${fmtDateTime(o.date)}</small></li><li style="color:var(--bad)">Cancelada<small>${fmtDateTime(new Date(o.date.getTime() + 8 * 3600000))}</small></li>`;
    return `<ul class="timeline">${html}</ul>`;
  }

  function openOrderDrawer(o) {
    if (!o) return;
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
              <span class="thumb"><img src="${it.product.img}" alt="" /></span>
              <div class="body"><strong>${escapeHtml(it.product.name)}</strong><small>x${it.qty} · $${formatPrice(it.price)} c/u</small></div>
              <span class="val is-money">${formatPrice(it.price * it.qty)}</span>
            </div>`,
            )
            .join("")}
        </div>
      </div>
      <div>
        <h4>Pago y envío</h4>
        <dl class="kv">
          <dt>Medio de pago</dt><dd>${PAYMENTS[o.payment].label}${o.installments > 1 ? ` · ${o.installments} cuotas sin interés` : ""}</dd>
          <dt>Entrega</dt><dd>${o.shippingMethod === "domicilio" ? "Envío a domicilio · " + escapeHtml(o.customer.address) : "Retiro en el local"}</dd>
          <dt>Subtotal</dt><dd>$${formatPrice(o.subtotal)}</dd>
          <dt>Envío</dt><dd>${o.shipping ? "$" + formatPrice(o.shipping) : "Gratis"}</dd>
          <dt>Recargo</dt><dd>${o.surcharge ? "$" + formatPrice(o.surcharge) : "—"}</dd>
          <dt><strong>Total</strong></dt><dd><strong style="font-family:var(--font-display);font-size:16px">$${formatPrice(o.total)}</strong></dd>
        </dl>
      </div>
      <div>
        <h4>Seguimiento</h4>
        ${orderTimeline(o)}
      </div>`;
    const inv = INVOICES.find((i) => i.order === o && i.type !== "NC");
    drawerFoot.innerHTML = `
      ${NEXT_STATUS[o.status] ? `<button class="btn btn-secondary is-sm" type="button" id="advanceOrder"><svg><use href="#ic-check_circle" /></svg>${NEXT_LABEL[o.status]}</button>` : ""}
      ${inv ? `<button class="btn btn-ghost is-sm" type="button" id="drawerInvoice"><svg><use href="#ic-receipt_long" /></svg>Ver factura</button>` : ""}
      ${o.status !== "cancelado" && o.status !== "entregado" ? `<button class="btn btn-danger is-sm" type="button" id="cancelOrder" style="margin-left:auto"><svg><use href="#ic-cancel" /></svg>Cancelar</button>` : ""}`;
    openDrawer();

    const adv = $("#advanceOrder");
    if (adv)
      adv.addEventListener("click", () => {
        o.status = NEXT_STATUS[o.status];
        toast(`${o.id}: ${ORDER_STATUS[o.status].label}`, "ok");
        RENDERERS._redrawOrders && RENDERERS._redrawOrders();
        openOrderDrawer(o);
      });
    const inv2 = $("#drawerInvoice");
    if (inv2) inv2.addEventListener("click", () => previewInvoice(inv));
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
        o.status = "cancelado";
        toast(`${o.id} cancelada`, "bad");
        RENDERERS._redrawOrders && RENDERERS._redrawOrders();
        openOrderDrawer(o);
      });
  }

  function openReservaDrawer(r) {
    if (!r) return;
    drawerTitle.textContent = `Reserva ${r.id}`;
    const daysLeft = Math.round((r.expires - TODAY) / DAY);
    drawerBody.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        ${badge(RESERVA_STATUS, r.status)}
        <span style="font-size:13px;color:var(--ink-soft)">${fmtDateTime(r.date)}</span>
      </div>
      <div class="list">
        <div class="list-item">
          <span class="thumb"><img src="${r.product.img}" alt="" /></span>
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
    const done = (status, msg, type) => {
      r.status = status;
      toast(msg, type);
      RENDERERS._redrawOrders && RENDERERS._redrawOrders();
      openReservaDrawer(r);
    };
    $("#resPickup") && $("#resPickup").addEventListener("click", () => done("retirada", `${r.id} marcada como retirada`, "ok"));
    $("#resExtend") &&
      $("#resExtend").addEventListener("click", () => {
        r.expires = new Date(r.expires.getTime() + 7 * DAY);
        done("activa", `${r.id} extendida hasta el ${fmtDate(r.expires)}`, "ok");
      });
    $("#resCancel") &&
      $("#resCancel").addEventListener("click", async () => {
        const ok = await confirmModal({ title: `Cancelar ${r.id}`, text: "Se liberará el stock reservado. La seña deberá devolverse manualmente.", okText: "Cancelar reserva", danger: true });
        if (ok) done("cancelada", `${r.id} cancelada`, "bad");
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

  const INV_TYPE = { A: "Factura A", B: "Factura B", C: "Factura C", NC: "Nota de crédito" };

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
        if (q && !normalize(i.id + " " + i.customer.name + " " + i.order.id).includes(q)) return false;
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
              <td>${i.type === "NC" ? '<span class="badge is-bad is-plain">Nota de crédito</span>' : `<span class="badge is-muted is-plain">Factura ${i.type}</span>`}</td>
              <td>${escapeHtml(i.customer.name)}</td>
              <td class="muted">${i.order.id}</td>
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
    [s, t, m].forEach((el) => el.addEventListener("input", draw));
    draw();

    const rs = $("#recSearch"), rst = $("#recStatus");
    function drawRec() {
      const q = normalize(rs.value);
      const rows = RECEIPTS.filter((r) => {
        if (rst.value && r.status !== rst.value) return false;
        if (q && !normalize(r.customer.name + " " + r.order.id + " " + r.bank).includes(q)) return false;
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
              <td class="muted">${r.order.id}</td>
              <td class="muted">${r.bank}</td>
              <td class="muted">${fmtDateTime(r.date)}</td>
              <td class="num is-money">${formatPrice(r.amount)}</td>
              <td>${badge(RECEIPT_STATUS, r.status)}</td>
              <td><div class="actions">
                <button class="iconBtn is-sm" type="button" data-rec-preview="${r.id}" title="Ver comprobante"><svg><use href="#ic-visibility" /></svg></button>
                <a class="iconBtn is-sm" href="${r.file}" download="${r.id}.jpg" title="Descargar"><svg><use href="#ic-download" /></svg></a>
              </div></td>
            </tr>`,
              )
              .join("")
          : `<tr><td colspan="8" class="table-empty">No hay comprobantes que coincidan.</td></tr>`) +
        "</tbody>";
    }
    [rs, rst].forEach((el) => el.addEventListener("input", drawRec));
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
    const o = inv.order;
    const isNC = inv.type === "NC";
    return `
      <div class="invoice" id="invoiceDoc">
        <div class="invoice-head">
          <div class="invoice-brand">
            <img src="${location.origin}/assets/images/isotipo.png" alt="" />
            <div>
              <strong>ComputerSell</strong>
              <small>Av. Corrientes 1234, CABA · CUIT 30-71234567-8<br />IVA Responsable Inscripto · Inicio de actividades 03/2025</small>
            </div>
          </div>
          <div class="invoice-type">${isNC ? "NC" : inv.type}</div>
          <div class="invoice-meta">
            <strong>${isNC ? "NOTA DE CRÉDITO" : "FACTURA"} ${inv.id}</strong>
            <span>Fecha de emisión: ${fmtDate(inv.date)}</span>
            <span>Orden: ${o.id}</span>
            <span>CAE: ${inv.cae} · Vto. ${fmtDate(new Date(inv.date.getTime() + 10 * DAY))}</span>
          </div>
        </div>
        <div class="invoice-parties">
          <div>
            <small>Cliente</small>
            <strong>${escapeHtml(o.customer.name)}</strong><br />
            DNI ${escapeHtml(o.customer.dni)}<br />
            ${escapeHtml(o.customer.address)}<br />
            ${escapeHtml(o.customer.email)}
          </div>
          <div>
            <small>Condiciones</small>
            Condición IVA: Consumidor final<br />
            Medio de pago: ${PAYMENTS[o.payment].label}<br />
            Entrega: ${o.shippingMethod === "domicilio" ? "Envío a domicilio" : "Retiro en el local"}
          </div>
        </div>
        <table class="invoice-table">
          <thead><tr><th>Descripción</th><th>Cant.</th><th>P. unitario</th><th>Subtotal</th></tr></thead>
          <tbody>
            ${o.items.map((it) => `<tr><td>${escapeHtml(it.product.name)}<br /><span style="color:#5b6270;font-size:11.5px">SKU ${it.product.sku}</span></td><td>${it.qty}</td><td>$${formatPrice(it.price)}</td><td>$${formatPrice(it.price * it.qty)}</td></tr>`).join("")}
            ${o.shipping ? `<tr><td>Envío a domicilio</td><td>1</td><td>$${formatPrice(o.shipping)}</td><td>$${formatPrice(o.shipping)}</td></tr>` : ""}
            ${o.surcharge ? `<tr><td>Recargo por medio de pago (${Math.round(PAYMENTS[o.payment].surcharge * 100)}%)</td><td>1</td><td>$${formatPrice(o.surcharge)}</td><td>$${formatPrice(o.surcharge)}</td></tr>` : ""}
          </tbody>
        </table>
        <div class="invoice-totals">
          <div><span>Subtotal</span><span>$${formatPrice(o.total)}</span></div>
          <div><span>IVA 21% (incluido)</span><span>$${formatPrice(Math.round(o.total - o.total / 1.21))}</span></div>
          <div class="total"><span>${isNC ? "Total a acreditar" : "Total"}</span><span>$${formatPrice(o.total)}</span></div>
        </div>
        <div class="invoice-foot">
          <span>Comprobante autorizado · Documento generado por ComputerSell Panel</span>
          <span>Página 1 de 1</span>
        </div>
      </div>`;
  }

  function previewInvoice(inv) {
    if (!inv) return;
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

  // "Descargar": abre el comprobante en una ventana de impresión (Guardar como PDF)
  function downloadInvoice(inv) {
    if (!inv) return;
    const css = Array.from(document.styleSheets)
      .map((s) => (s.href ? `<link rel="stylesheet" href="${s.href}" />` : ""))
      .join("");
    const w = window.open("", "_blank");
    if (!w) return toast("El navegador bloqueó la ventana. Permití pop-ups para descargar.", "bad");
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8" /><title>${inv.id}</title>${css}
      <style>body{background:#fff!important;margin:0;padding:24px}.invoice{border-radius:0;padding:0}@page{margin:18mm}</style></head>
      <body>${invoiceHtml(inv)}<script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>`);
    w.document.close();
    toast("Se abrió el comprobante para guardar como PDF");
  }

  function previewReceipt(r) {
    if (!r) return;
    openModal(
      `
      <div class="modal-head">
        <h3>Comprobante ${r.id}</h3>
        <a class="btn btn-secondary is-sm" href="${r.file}" download="${r.id}.jpg"><svg><use href="#ic-download" /></svg>Descargar</a>
        <button class="iconBtn is-sm" type="button" data-close aria-label="Cerrar"><svg><use href="#ic-close" /></svg></button>
      </div>
      <div class="receipt-preview">
        <img src="${r.file}" alt="Comprobante de transferencia" />
        <dl class="kv">
          <dt>Estado</dt><dd>${badge(RECEIPT_STATUS, r.status)}</dd>
          <dt>Cliente</dt><dd>${escapeHtml(r.customer.name)}</dd>
          <dt>Orden</dt><dd>${r.order.id} · $${formatPrice(r.order.total)}</dd>
          <dt>Banco</dt><dd>${r.bank}</dd>
          <dt>Referencia</dt><dd>${r.reference}</dd>
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
    const done = (status) => {
      r.status = status;
      if (status === "aprobado" && r.order.status === "pendiente") r.order.status = "pagado";
      if (status === "rechazado") r.order.status = "pendiente";
      closeModal();
      toast(status === "aprobado" ? `${r.order.id} marcada como pagada` : `Comprobante ${r.id} rechazado`, status === "aprobado" ? "ok" : "bad");
      RENDERERS._redrawReceipts && RENDERERS._redrawReceipts();
      RENDERERS._redrawOrders && RENDERERS._redrawOrders();
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
      sub.innerHTML = `<option value="">${subs.length ? "Seleccionar…" : "Sin subcategoría"}</option>` + subs.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
      sub.disabled = !subs.length;
      sub.required = !!subs.length;
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
        el.value = n ? formatPrice(n) : "";
      });
    }
    [price, cost, oldPrice].forEach(moneyInput);

    // Oferta: precio anterior <-> % descuento
    let syncing = false;
    oldPrice.addEventListener("input", () => {
      if (syncing) return;
      syncing = true;
      const p = parsePrice(price.value), o = parsePrice(oldPrice.value);
      discount.value = o > p && p ? Math.round((1 - p / o) * 100) : "";
      syncing = false;
    });
    discount.addEventListener("input", () => {
      if (syncing) return;
      syncing = true;
      const p = parsePrice(price.value), d = +discount.value;
      oldPrice.value = d > 0 && d < 100 && p ? formatPrice(Math.round(p / (1 - d / 100))) : "";
      syncing = false;
    });

    // Margen
    const updateMargin = () => {
      const p = parsePrice(price.value), c = parsePrice(cost.value);
      $("#pMargin").textContent = p && c ? `Margen: ${Math.round(((p - c) / p) * 100)}% ($${formatPrice(p - c)})` : "Margen: —";
    };
    [price, cost].forEach((el) => el.addEventListener("input", updateMargin));

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
        const v = tagInput.value.trim().toLowerCase().replace(/,+$/, "");
        if (!v) return;
        if (tags.length >= 10) return toast("Máximo 10 etiquetas", "bad");
        if (!tags.includes(v)) tags.push(v);
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
        images.push({ url: URL.createObjectURL(f), name: f.name, file: f });
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

    let dragIdx = null;
    function renderImages() {
      imgGrid.innerHTML = images
        .map(
          (im, i) => `
          <div class="imgItem" draggable="true" data-i="${i}">
            <img src="${im.url}" alt="" />
            ${i === 0 ? '<span class="imgItem-main">Principal</span>' : ""}
            <div class="imgItem-tools">
              <button type="button" data-remove="${i}" title="Quitar"><svg><use href="#ic-delete" /></svg></button>
            </div>
          </div>`,
        )
        .join("");
      $$(".imgItem", imgGrid).forEach((item) => {
        item.addEventListener("dragstart", () => {
          dragIdx = +item.dataset.i;
          item.classList.add("is-dragging");
        });
        item.addEventListener("dragend", () => item.classList.remove("is-dragging"));
        item.addEventListener("dragover", (e) => e.preventDefault());
        item.addEventListener("drop", (e) => {
          e.preventDefault();
          const to = +item.dataset.i;
          if (dragIdx === null || dragIdx === to) return;
          const [moved] = images.splice(dragIdx, 1);
          images.splice(to, 0, moved);
          dragIdx = null;
          renderImages();
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
      row.querySelector(".row-remove").addEventListener("click", () => row.remove());
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
      pvOld.hidden = !(sale.checked && o > p);
      pvOld.textContent = "$" + formatPrice(o);
      const pvC = $("#pvCuotas");
      pvC.hidden = !cuotas.checked;
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
        sale: sale.checked,
        oldPrice: parsePrice(oldPrice.value),
        featured: $("#pFeatured").checked,
        installments: cuotas.checked ? +cuotasN.value : 0,
        freeShipping: freeShip.checked,
        delivery: $("#pDelivery").value,
        weight: $("#pWeight").value,
        dimensions: $("#pDims").value.trim(),
        condition: $("#pCondition").value,
        images: images.map((i) => i.name),
        image: images[0] ? images[0].url : "",
        specs,
        highlights,
      };
    }

    function autoSku() {
      const c = { computadoras: "PC", notebooks: "NB", componentes: "CO", perifericos: "PE" }[cat.value] || "XX";
      const t = title.value.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase() || "PROD";
      return `${c}-${t}-${String(Date.now()).slice(-4)}`;
    }

    function updateSummary() {
      const d = collect();
      // [etiqueta, ok, elemento a marcar, elemento al que scrollear]
      const checks = [
        ["Título", !!d.title, title.closest(".field"), title],
        ["Marca", !!d.brand, brand.closest(".field"), brand],
        ["Categoría", !!d.category && (!sub.required || !!d.subcategory), (d.category ? sub : cat).closest(".field"), d.category ? sub : cat],
        ["Descripción", d.description.length >= 40, desc.closest(".field"), desc],
        ["Precio", d.price > 0, price.closest(".field"), price],
        ["Stock", stock.value !== "", stock.closest(".field"), stock],
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

    // --- Guardado ---
    function uploaded() {
      return store.get("products", []);
    }

    function renderUploaded() {
      const list = uploaded();
      $("#uploadedHint").textContent = list.length ? `${list.length} producto${list.length === 1 ? "" : "s"}` : "";
      $("#uploadedList").innerHTML = list.length
        ? list
            .slice()
            .reverse()
            .map(
              (p, idx) => `
            <div class="list-item">
              <span class="thumb">${p.image ? `<img src="${escapeHtml(p.image)}" alt="" />` : '<svg><use href="#ic-image" /></svg>'}</span>
              <div class="body"><strong>${escapeHtml(p.title)}</strong><small>${escapeHtml(p.sku)} · ${CATEGORIES[p.category] ? CATEGORIES[p.category].label : "—"} · ${fmtRelative(p.createdAt)}</small></div>
              <span class="badge ${p.status === "publicado" ? "is-ok" : p.status === "borrador" ? "is-warn" : "is-muted"}">${p.status}</span>
              <span class="val is-money">${formatPrice(p.price)}</span>
              <button class="iconBtn is-sm is-danger" type="button" data-del-product="${list.length - 1 - idx}" title="Eliminar"><svg><use href="#ic-delete" /></svg></button>
            </div>`,
            )
            .join("")
        : `<p style="color:var(--ink-soft);font-size:13.5px;margin:0">Todavía no cargaste productos desde el panel.</p>`;
    }
    $("#uploadedList").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-del-product]");
      if (!b) return;
      const list = uploaded();
      const p = list[+b.dataset.delProduct];
      const ok = await confirmModal({ title: "Eliminar producto", text: `Se quitará "${p.title}" del catálogo.`, okText: "Eliminar", danger: true });
      if (!ok) return;
      list.splice(+b.dataset.delProduct, 1);
      store.set("products", list);
      renderUploaded();
      toast("Producto eliminado", "bad");
    });
    renderUploaded();

    function save(statusOverride) {
      const d = collect();
      if (statusOverride) d.status = statusOverride;
      d.createdAt = new Date().toISOString();
      d.image = ""; // los blobs no sobreviven al recargar; se guarda solo el nombre
      const list = uploaded();
      list.push(d);
      store.set("products", list);
      renderUploaded();
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
      save();
      const d = collect();
      toast(`"${d.title}" publicado en la tienda`, "ok");
      resetForm();
    });

    $("#saveDraft").addEventListener("click", () => {
      if (!title.value.trim()) return toast("Poné al menos un título para guardar el borrador", "bad");
      save("borrador");
      toast("Borrador guardado", "ok");
      resetForm();
    });

    function resetForm() {
      form.reset();
      form.classList.remove("is-submitted");
      tags = [];
      images.forEach((i) => URL.revokeObjectURL(i.url));
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
    const data = store.get("avatar", "");
    const html = data ? `<img src="${data}" alt="" />` : escapeHtml(initials(USER.name));
    $("#sbAvatar").innerHTML = html;
    $("#profileAvatar").innerHTML = html;
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
      const reader = new FileReader();
      reader.onload = () => {
        // reducimos a 160px para que entre cómodo en localStorage
        const img = new Image();
        img.onload = () => {
          const c = document.createElement("canvas");
          const s = 160;
          c.width = c.height = s;
          const ctx = c.getContext("2d");
          const m = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, s, s);
          store.set("avatar", c.toDataURL("image/jpeg", 0.85));
          applyAvatar();
          toast("Foto de perfil actualizada", "ok");
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(f);
      $("#avatarInput").value = "";
    });
    $("#avatarRemove").addEventListener("click", () => {
      store.remove("avatar");
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
    sub: `${i.customer.name} · ${i.order.id} · ${fmtDate(i.date)}`,
    right: `<span class="meta">$${formatPrice(i.total)}</span>`,
    run: () => { showView("facturas", { tab: "emitidas" }); previewInvoice(i); },
  });
  const itemReceipt = (r) => ({
    icon: "account_balance",
    title: `Comprobante ${r.id} · ${r.customer.name}`,
    sub: `${r.order.id} · ${r.bank} · ${fmtDateTime(r.date)}`,
    right: `${badge(RECEIPT_STATUS, r.status)}<span class="meta">$${formatPrice(r.amount)}</span>`,
    run: () => { showView("facturas", { tab: "recibidos" }); previewReceipt(r); },
  });
  const itemNotif = (n) => ({
    icon: n.icon,
    title: n.title,
    sub: truncate(n.body, 90),
    right: `<span class="meta">${fmtRelative(n.date)}</span>${readIds.has(n.id) ? "" : '<span class="badge is-info is-plain">Nueva</span>'}`,
    run: () => openNotification(n),
  });
  const itemProduct = (p) => ({
    icon: "inventory_2",
    title: p.name,
    sub: `${p.sku} · ${CATEGORIES[p.cat].label}${p.sub ? " · " + p.sub : ""}`,
    right: `<span class="meta">$${formatPrice(p.price)}</span>${p.stock === 0 ? '<span class="badge is-bad">Sin stock</span>' : p.stock <= 2 ? `<span class="badge is-warn">${p.stock} u.</span>` : `<span class="meta">${p.stock} u.</span>`}`,
    run: () => { showView("analiticas"); $("#productPerf").scrollIntoView({ behavior: "smooth", block: "center" }); toast(`${p.name}: ${p.stock} en stock`); },
  });
  const itemCustomer = (c) => ({
    icon: "person",
    title: c.name,
    sub: `${c.email} · ${c.phone}`,
    right: `<span class="meta">${ORDERS.filter((o) => o.customer === c).length} órdenes</span>`,
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
                  <svg><use href="#ic-${it.icon}" /></svg>
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
    if (ok) window.location.href = "/admin-login.html#login";
  });

  // =====================================================================
  //  INIT
  // =====================================================================

  const RENDERERS = {
    notificaciones: renderNotifs,
    dashboard: renderDashboard,
    analiticas: renderAnalytics,
    ordenes: renderOrders,
    facturas: renderInvoices,
    cargas: renderUpload,
    perfil: renderProfile,
  };

  applyAvatar();
  applyTheme(store.get("theme", "dark"));
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
