// Detalle de un pedido (compra-detalle.html?id=<uuid>): estado con timeline,
// productos, resumen de pago, envío, factura y comprobante de transferencia.
// Se actualiza en tiempo real cuando el panel cambia el estado.
import { sb, requireAuth, subscribe } from "../core/supabase.js";
import { printSaleNote } from "../core/sale-note.js";

const { formatPrice, escapeHtml, toast } = window.CS;
const $ = (s) => document.querySelector(s);

const id = new URLSearchParams(location.search).get("id");
const wantInvoice = new URLSearchParams(location.search).get("factura");

const STATUS = {
  pendiente: ["Pendiente de pago", "badge-pending"],
  pagado: ["Pagado", "badge-ok"],
  preparando: ["Preparando", "badge-pending"],
  enviado: ["Despachado", "badge-ok"],
  cancelado: ["Cancelado", "badge-cancel"],
};
const PAYMENT = { credito: "Tarjeta de crédito", debito: "Tarjeta de débito", transferencia: "Transferencia", mercadopago: "Mercado Pago" };
const STEPS = [
  ["pagado", "Confirmado", "#ic-check"],
  ["preparando", "Preparando", "#ic-shopping_bag"],
  ["enviado", "Despachado", "#ic-shipping_truck"],
];
const fmtDate = (d) => new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
const fmtDateTime = (d) => new Date(d).toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

let order = null;

function renderStepper(o, events) {
  const stepper = $("#stepper");
  if (o.status === "cancelado") {
    const ev = events.find((e) => e.status === "cancelado");
    stepper.innerHTML = `
      <div class="step is-current">
        <div class="step-icon" style="border-color:#ff6b6b;color:#ff6b6b;background:var(--bg-2)"><svg class="ic-md"><use href="#ic-close"/></svg></div>
        <div class="step-label">Pedido cancelado</div>
        <div class="step-date">${ev ? fmtDateTime(ev.created_at) : ""}</div>
      </div>`;
    return;
  }
  const rank = { pendiente: -1, pagado: 0, preparando: 1, enviado: 2 };
  const current = rank[o.status];
  stepper.innerHTML = STEPS.map(([key, label, icon], i) => {
    const ev = events.find((e) => e.status === key);
    const cls = i < current ? "is-done" : i === current ? "is-current" : "";
    return `
      <div class="step ${cls}">
        <div class="step-icon"><svg class="ic-md"><use href="${icon}"/></svg></div>
        <div class="step-label">${label}</div>
        <div class="step-date">${ev ? fmtDateTime(ev.created_at) : i === 0 && o.status === "pendiente" ? "Esperando pago" : "Pendiente"}</div>
      </div>`;
  }).join("");
}

function render(o) {
  order = o;
  const title = `Pedido CS-${o.number}`;
  document.title = `${title} — ComputerSell`;
  $("#crumbOrderId").textContent = title;
  $("#orderTitle").textContent = title;
  $("#orderSub").textContent = "Realizado el " + fmtDate(o.created_at);
  const [label, cls] = STATUS[o.status] || [o.status, ""];
  const badge = $("#orderBadge");
  badge.textContent = label;
  badge.className = "badge " + cls;

  renderStepper(o, o.order_events || []);

  $("#itemsList").innerHTML = (o.order_items || [])
    .map(
      (it) => `
      <div class="item-row">
        <div class="item-thumb">${it.image ? `<img src="${escapeHtml(it.image)}" alt="" style="width:100%;height:100%;object-fit:contain" />` : '<svg class="ic-md"><use href="#ic-shopping_bag"/></svg>'}</div>
        <div class="item-info">
          <strong>${it.product_id ? `<a href="/detail.html?id=${it.product_id}" style="color:inherit;text-decoration:none">${escapeHtml(it.title)}</a>` : escapeHtml(it.title)}</strong>
          <span class="item-qty">Cantidad: ${it.qty} · $${formatPrice(it.unit_price)} c/u</span>
        </div>
        <div class="item-price">${formatPrice(it.unit_price * it.qty)}</div>
      </div>`,
    )
    .join("");

  $("#sumSubtotal").textContent = formatPrice(o.subtotal);
  $("#sumShipping").textContent = o.shipping_cost ? formatPrice(o.shipping_cost) : "Gratis";
  $("#sumDiscount").textContent = o.surcharge ? `+${formatPrice(o.surcharge)} (recargo)` : "0";
  $("#sumDiscount").previousElementSibling.textContent = o.surcharge ? "Recargo medio de pago" : "Descuento";
  $("#sumTotal").textContent = formatPrice(o.total);

  const c = o.customer || {};
  $("#shipAddress").textContent = o.shipping_method === "retiro" ? "Retiro en el local" : c.address || "—";
  $("#payMethod").textContent = `${PAYMENT[o.payment_method] || o.payment_method}${o.installments > 1 ? ` · ${o.installments} cuotas sin interés` : ""}`;

  const inv = (o.invoices || []).find((i) => i.type !== "NC");
  const btn = $("#downloadInvoiceBtn");
  btn.hidden = !inv;
  btn.onclick = () => inv && openInvoice(inv);
  if (wantInvoice && inv && inv.id === wantInvoice) openInvoice(inv);

  // Seguimiento: habilitado solo cuando el pedido fue despachado
  const track = $("#trackingBtn");
  const shipped = o.status === "enviado";
  track.disabled = !shipped;
  track.title = shipped ? "" : "Se habilita cuando despachamos tu pedido";
  track.onclick = () => shipped && openTracking(o);

  renderReceipt(o);
}

// Comprobante de transferencia: estado y re-subida si fue rechazado
function renderReceipt(o) {
  let box = $("#receiptBox");
  if (o.payment_method !== "transferencia") return box && box.remove();
  if (!box) {
    box = document.createElement("div");
    box.id = "receiptBox";
    box.className = "card";
    $(".detail-side").prepend(box);
  }
  const receipts = (o.payment_receipts || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const last = receipts[0];
  const RS = { pendiente: ["En revisión", "badge-pending"], aprobado: ["Aprobado", "badge-ok"], rechazado: ["Rechazado", "badge-cancel"] };
  const st = last ? RS[last.status] : null;
  const canUpload = o.status === "pendiente" && (!last || last.status === "rechazado");
  box.innerHTML = `
    <h3><svg><use href="#ic-credit_card" /></svg>Transferencia</h3>
    <div class="info-block">
      <div class="label">Comprobante</div>
      <div class="value">${st ? `<span class="badge ${st[1]}">${st[0]}</span> <small style="color:var(--ink-soft)">${fmtDateTime(last.created_at)}</small>` : "Todavía no subiste el comprobante"}</div>
    </div>
    ${
      canUpload
        ? `<label class="btn btn-secondary" style="cursor:pointer;width:100%;justify-content:center">
             <input type="file" id="receiptUpload" accept="image/png,image/jpeg,application/pdf" hidden />
             ${last ? "Subir otro comprobante" : "Subir comprobante"}
           </label>`
        : ""
    }`;
  const input = box.querySelector("#receiptUpload");
  if (input) {
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) return toast("El archivo supera los 5 MB", "bad");
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${o.user_id}/${o.id}-${Date.now()}.${ext}`;
      const up = await sb.storage.from("receipts").upload(path, file, { contentType: file.type });
      if (up.error) return toast("No se pudo subir el comprobante", "bad");
      const ins = await sb.from("payment_receipts").insert({ order_id: o.id, user_id: o.user_id, file_path: path, amount: o.total });
      if (ins.error) return toast("No se pudo registrar el comprobante", "bad");
      toast("Comprobante enviado. Te avisamos cuando lo revisemos.", "ok");
      load();
    });
  }
}

// Seguimiento del envío (Correo Argentino)
function openTracking(o) {
  let box = $("#trackingBox");
  if (!box) {
    box = document.createElement("div");
    box.id = "trackingBox";
    box.className = "card";
    $(".detail-side").prepend(box);
  }
  const code = (o.tracking || "").trim();
  box.innerHTML = `
    <h3><svg><use href="#ic-shipping_truck" /></svg>Seguimiento del envío</h3>
    <div class="info-block">
      <div class="label">Código de seguimiento</div>
      <div class="value">${code ? `<strong style="font-family:monospace;font-size:15px;letter-spacing:.04em">${escapeHtml(code)}</strong>` : "Todavía no cargamos el código. Te avisamos apenas esté."}</div>
    </div>
    ${code ? `<div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-third" type="button" id="copyTracking">Copiar código</button>
      <a class="btn btn-secondary" href="https://www.correoargentino.com.ar/formularios/e-commerce" target="_blank" rel="noopener">Rastrear en Correo Argentino</a>
    </div>` : ""}`;
  box.scrollIntoView({ behavior: "smooth", block: "center" });
  const copy = box.querySelector("#copyTracking");
  if (copy)
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code);
        toast("Código copiado", "ok");
      } catch (e) {
        toast(code);
      }
    });
}

// Nota de venta en una ventana para imprimir / guardar como PDF
async function openInvoice(inv) {
  if (!(await printSaleNote(inv, order))) toast("Permití las ventanas emergentes para ver la nota de venta", "bad");
}

async function load() {
  const { data } = await sb
    .from("orders")
    .select("*, order_items(*), order_events(*), invoices(*), payment_receipts(*)")
    .eq("id", id)
    .maybeSingle();
  if (!data) {
    $("#orderTitle").textContent = "Pedido no encontrado";
    $("#orderSub").textContent = "";
    $("#orderBadge").hidden = true;
    document.querySelector(".stepper-card").hidden = true;
    document.querySelector(".detail-grid").hidden = true;
    $("#downloadInvoiceBtn").hidden = true;
    return;
  }
  data.order_events.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  render(data);
}

(async () => {
  const user = await requireAuth();
  if (!user) return;
  document.getElementById("footerYear").textContent = new Date().getFullYear();
  if (!id) return load();
  await load();
  subscribe("orders", load, `id=eq.${id}`);
  subscribe("payment_receipts", load, `order_id=eq.${id}`);
  subscribe("invoices", load, `order_id=eq.${id}`);
})();
