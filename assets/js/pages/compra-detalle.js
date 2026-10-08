// Detalle de un pedido (compra-detalle.html?id=<uuid>): estado con timeline,
// productos, resumen de pago, envío, factura y comprobante de transferencia.
// Se actualiza en tiempo real cuando el panel cambia el estado.
//
// Pedido por transferencia pendiente: muestra la cuenta para transferir (la
// base la da solo con un pedido pendiente), el plazo para pagar, la subida del
// comprobante y el botón para cancelarlo mientras no se haya pagado.
import { sb, requireAuth, subscribe, loading, getSellerPrivate } from "../core/supabase.js";
import { printSaleNote } from "../core/sale-note.js";
import { whatsappUrl } from "../core/legal.js";
import { uploadReceipt, RECEIPT_ACCEPT } from "../core/receipts.js";

const { formatPrice, escapeHtml, toast } = window.CS;
const $ = (s) => document.querySelector(s);

const params = new URLSearchParams(location.search);
const id = params.get("id");
const wantInvoice = params.get("factura");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS = {
  pendiente: ["Pendiente de pago", "badge-pending"],
  pagado: ["Pagado", "badge-ok"],
  preparando: ["Preparando", "badge-pending"],
  enviado: ["Despachado", "badge-ok"],
  entregado: ["Entregado", "badge-ok"],
  cancelado: ["Cancelado", "badge-cancel"],
};
const PAYMENT = { credito: "Tarjeta de crédito", debito: "Tarjeta de débito", transferencia: "Transferencia", mercadopago: "Mercado Pago" };
const STEPS = [
  ["pendiente", "Pedido realizado", "#ic-receipt_long"],
  ["pagado", "Pago confirmado", "#ic-check"],
  ["preparando", "Preparando", "#ic-shopping_bag"],
  ["enviado", "Despachado", "#ic-shipping_truck"],
  ["entregado", "Entregado", "#ic-task_alt"],
];
const REVOCATION = {
  recibida: ["Recibida", "badge-pending"],
  en_curso: ["En curso", "badge-pending"],
  reintegrada: ["Reintegrada", "badge-ok"],
  rechazada: ["Rechazada", "badge-cancel"],
  desistida: ["Desistida", "badge-cancel"],
};
const fmtDate = (d) => new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
const fmtDateTime = (d) => new Date(d).toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

let order = null;
let userId = null;

function renderStepper(o, events) {
  const stepper = $("#stepper");
  if (o.status === "cancelado") {
    const ev = events.filter((e) => e.status === "cancelado").pop();
    stepper.innerHTML = `
      <div class="step is-current">
        <div class="step-icon" style="border-color:#ff6b6b;color:#ff6b6b;background:var(--bg-2)"><svg class="ic-md"><use href="#ic-close"/></svg></div>
        <div class="step-label">Pedido cancelado</div>
        <div class="step-date">${ev ? fmtDateTime(ev.created_at) : ""}</div>
        ${ev && ev.note ? `<div class="step-date">${escapeHtml(ev.note)}</div>` : ""}
      </div>`;
    return;
  }
  const rank = { pendiente: 0, pagado: 1, preparando: 2, enviado: 3, entregado: 4 };
  const current = rank[o.status] ?? 0;
  const last = STEPS.length - 1;
  stepper.innerHTML = STEPS.map(([key, label, icon], i) => {
    // Fecha del paso: el primer evento con ese estado
    const ev = events.find((e) => e.status === key);
    const cls = i < current || (i === current && i === last) || (i === 0 && current > 0) ? "is-done" : i === current ? "is-current" : "";
    const sub = ev ? fmtDateTime(ev.created_at) : i === current + 1 && o.status === "pendiente" ? "Esperando el pago" : "";
    return `
      <div class="step ${cls}">
        <div class="step-icon"><svg class="ic-md"><use href="${icon}"/></svg></div>
        <div class="step-label">${label}</div>
        <div class="step-date">${sub || "&nbsp;"}</div>
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
  badge.hidden = false;

  renderStepper(o, o.order_events || []);

  $("#itemsList").innerHTML = (o.order_items || [])
    .map(
      (it) => `
      <div class="item-row">
        <div class="item-thumb">${it.image ? `<img src="${escapeHtml(it.image)}" alt="" style="width:100%;height:100%;object-fit:contain" />` : '<svg class="ic-md"><use href="#ic-shopping_bag"/></svg>'}</div>
        <div class="item-info">
          <strong>${it.product_id ? `<a href="/detail.html?id=${escapeHtml(it.product_id)}" style="color:inherit;text-decoration:none">${escapeHtml(it.title)}</a>` : escapeHtml(it.title)}</strong>
          <span class="item-qty">Cantidad: ${Number(it.qty)} · $${formatPrice(it.unit_price)} c/u</span>
        </div>
        <div class="item-price">$${formatPrice(it.unit_price * it.qty)}</div>
      </div>`,
    )
    .join("");

  $("#sumSubtotal").textContent = "$" + formatPrice(o.subtotal);
  $("#sumShipping").textContent = o.shipping_cost ? "$" + formatPrice(o.shipping_cost) : "Gratis";
  $("#sumDiscountRow").hidden = !o.surcharge;
  $("#sumDiscount").textContent = "+$" + formatPrice(o.surcharge || 0);
  $("#sumTotal").textContent = "$" + formatPrice(o.total);

  const c = o.customer || {};
  $("#shipAddress").textContent = c.address || "—";
  const pay = o.payment || {};
  const card = pay.brand ? ` · ${pay.brand}${pay.last_four ? " •••• " + pay.last_four : ""}` : "";
  $("#payMethod").textContent = `${PAYMENT[o.payment_method] || o.payment_method}${card}${o.installments > 1 ? ` · ${o.installments} cuotas` : ""}`;

  // Nota de venta solo si el pedido sigue vigente
  const inv = o.status === "cancelado" ? null : (o.invoices || [])[0];
  const btn = $("#downloadInvoiceBtn");
  btn.hidden = !inv;
  btn.onclick = () => inv && openInvoice(inv);
  // Llegó desde "Mis comprobantes": se resalta el botón (abrir la ventana sin
  // un click del usuario la bloquea el navegador)
  if (wantInvoice && inv && inv.id === wantInvoice && !btn.dataset.highlighted) {
    btn.dataset.highlighted = "1";
    btn.classList.add("is-highlight");
    btn.scrollIntoView({ behavior: "smooth", block: "center" });
    toast("Tocá \"Nota de venta\" para verla o descargarla");
  }

  // Seguimiento: habilitado cuando el pedido fue despachado
  const track = $("#trackingBtn");
  const shipped = o.status === "enviado" || o.status === "entregado";
  track.hidden = false;
  track.disabled = !shipped;
  track.title = shipped ? "" : "Se habilita cuando despachamos tu pedido";
  track.onclick = () => shipped && openTracking(o);

  // Arrepentimiento: estado de la solicitud si ya hay una; si no, el botón
  const revocations = (o.revocation_requests || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const active = revocations.find((r) => ["recibida", "en_curso", "reintegrada"].includes(r.status));
  const revoke = $("#revocationBtn");
  revoke.hidden = o.status === "cancelado" || !!active;
  revoke.href = "/arrepentimiento?pedido=CS-" + o.number + "#solicitud";
  renderRevocation(revocations[0]);

  $("#supportBtn").href = whatsappUrl(`Hola, tengo una consulta sobre mi pedido CS-${o.number}.`);

  renderTransfer(o);
}

function sideCard(boxId) {
  let box = document.getElementById(boxId);
  if (!box) {
    box = document.createElement("div");
    box.id = boxId;
    box.className = "card";
    $(".detail-side").prepend(box);
  }
  return box;
}

function renderRevocation(r) {
  const existing = $("#revocationBox");
  if (!r) return existing && existing.remove();
  const box = sideCard("revocationBox");
  const [label, cls] = REVOCATION[r.status] || [r.status, ""];
  box.innerHTML = `
    <h3><svg><use href="#ic-info" /></svg>Arrepentimiento</h3>
    <div class="info-block">
      <div class="label">Solicitud ${escapeHtml(r.code)}</div>
      <div class="value"><span class="badge ${cls}">${escapeHtml(label)}</span> <small style="color:var(--ink-soft)">${fmtDateTime(r.created_at)}</small></div>
    </div>
    ${r.admin_note ? `<div class="info-block"><div class="label">Respuesta</div><div class="value">${escapeHtml(r.admin_note)}</div></div>` : ""}
    <p style="font-size:13px;color:var(--ink-soft);margin:0">Te contactamos para coordinar la devolución y el reintegro. Detalle en <a href="/arrepentimiento#mis-solicitudes">Tus solicitudes</a>.</p>`;
}

// Transferencia: cuenta, plazo, comprobante (estado, ver, subir otro) y cancelar
async function renderTransfer(o) {
  const box = document.getElementById("receiptBox");
  if (o.payment_method !== "transferencia") return box && box.remove();
  const el = sideCard("receiptBox");
  const receipts = (o.payment_receipts || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const last = receipts[0];
  const RS = { pendiente: ["En revisión", "badge-pending"], aprobado: ["Aprobado", "badge-ok"], rechazado: ["Rechazado", "badge-cancel"] };
  const st = last ? RS[last.status] : null;
  const pending = o.status === "pendiente";
  const canUpload = pending && (!last || last.status === "rechazado");
  const canCancel = pending && !(last && ["pendiente", "aprobado"].includes(last.status));
  const bank = pending ? (await getSellerPrivate(true)).bank || {} : {};

  el.innerHTML = `
    <h3><svg><use href="#ic-account_balance" /></svg>Transferencia</h3>
    ${
      pending && (bank.cbu || bank.alias)
        ? `<dl class="bankList">
             <dt>Titular</dt><dd>${escapeHtml(bank.holder || "—")}</dd>
             <dt>CBU</dt><dd><button type="button" class="copyValue" data-copy="${escapeHtml(bank.cbu || "")}" aria-label="Copiar CBU">${escapeHtml(bank.cbu || "—")}</button></dd>
             <dt>Alias</dt><dd><button type="button" class="copyValue" data-copy="${escapeHtml(bank.alias || "")}" aria-label="Copiar alias">${escapeHtml(bank.alias || "—")}</button></dd>
             <dt>Monto</dt><dd><strong>$${formatPrice(o.total)}</strong></dd>
           </dl>`
        : ""
    }
    ${
      pending && o.expires_at && canUpload
        ? `<p class="transferDeadline">Subí el comprobante antes del <strong>${escapeHtml(fmtDateTime(o.expires_at))} hs</strong>: si no lo recibimos, el pedido se cancela solo y el stock se libera.${last && last.status === "rechazado" ? " Como rechazamos el anterior, tenés 24 hs desde el rechazo." : ""}</p>`
        : ""
    }
    <div class="info-block">
      <div class="label">Comprobante</div>
      <div class="value">${st ? `<span class="badge ${st[1]}">${st[0]}</span> <small style="color:var(--ink-soft)">${fmtDateTime(last.created_at)}</small> <button type="button" class="btn-link" id="viewReceipt">Ver</button>` : "Todavía no subiste el comprobante"}</div>
    </div>
    ${
      canUpload
        ? `<input type="file" id="receiptUpload" accept="${RECEIPT_ACCEPT}" class="sr-only" tabindex="-1" aria-hidden="true" />
           <button class="btn btn-secondary" type="button" id="receiptUploadBtn" style="width:100%;justify-content:center">${last ? "Subir otro comprobante" : "Subir comprobante"}</button>
           <small style="color:var(--ink-soft)">PDF, JPG o PNG · hasta 5 MB</small>`
        : ""
    }
    ${canCancel ? `<button class="btn btn-third" type="button" id="cancelOrderBtn" style="width:100%;justify-content:center;margin-top:8px">Cancelar pedido</button>` : ""}`;

  el.querySelectorAll(".copyValue").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
        toast("Copiado", "ok");
      } catch (e) {
        toast("No se pudo copiar", "bad");
      }
    }),
  );

  const view = el.querySelector("#viewReceipt");
  if (view)
    view.addEventListener("click", async () => {
      const w = window.open("", "_blank", "noopener");
      const { data, error } = await sb.storage.from("receipts").createSignedUrl(last.file_path, 120);
      if (error || !data) {
        if (w) w.close();
        return toast("No pudimos abrir el comprobante", "bad");
      }
      if (w) w.location.href = data.signedUrl;
      else location.href = data.signedUrl;
    });

  const input = el.querySelector("#receiptUpload");
  const uploadBtn = el.querySelector("#receiptUploadBtn");
  if (input && uploadBtn) {
    uploadBtn.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files[0];
      input.value = ""; // elegir el mismo archivo otra vez vuelve a disparar change
      if (!file) return;
      uploadBtn.disabled = true;
      uploadBtn.textContent = "Subiendo…";
      try {
        await uploadReceipt({ userId, orderId: o.id, file });
        toast("Comprobante enviado. Te avisamos cuando lo revisemos.", "ok");
        load();
      } catch (err) {
        toast(err.message, "bad");
        uploadBtn.disabled = false;
        uploadBtn.textContent = last ? "Subir otro comprobante" : "Subir comprobante";
      }
    });
  }

  const cancel = el.querySelector("#cancelOrderBtn");
  if (cancel)
    cancel.addEventListener("click", async () => {
      if (!confirm(`¿Cancelar el pedido CS-${o.number}? Liberamos el stock y no vas a poder pagarlo después.`)) return;
      cancel.disabled = true;
      const { error } = await sb.rpc("cancel_my_order", { p_order: o.id });
      if (error) {
        cancel.disabled = false;
        return toast(/[áéíóúñ]/i.test(error.message) ? error.message : "No pudimos cancelar el pedido. Escribinos por WhatsApp.", "bad");
      }
      toast("Pedido cancelado", "ok");
      load();
    });
}

// Seguimiento del envío (Correo Argentino)
function openTracking(o) {
  const box = sideCard("trackingBox");
  const code = (o.tracking || "").trim();
  box.innerHTML = `
    <h3><svg><use href="#ic-shipping_truck" /></svg>Seguimiento del envío</h3>
    <div class="info-block">
      <div class="label">Código de seguimiento</div>
      <div class="value">${code ? `<strong style="font-family:monospace;font-size:15px;letter-spacing:.04em">${escapeHtml(code)}</strong>` : "Todavía no cargamos el código. Te avisamos apenas esté."}</div>
    </div>
    ${code ? `<div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-third" type="button" id="copyTracking">Copiar código</button>
      <a class="btn btn-secondary" href="https://www.correoargentino.com.ar/formularios/e-commerce" target="_blank" rel="noopener">Ir al correo</a>
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

function notFound() {
  document.title = "Pedido no encontrado — ComputerSell";
  $("#crumbOrderId").textContent = "Pedido no encontrado";
  $("#orderTitle").textContent = "Pedido no encontrado";
  $("#orderSub").textContent = "";
  $("#orderBadge").hidden = true;
  $("#orderNotFound").hidden = false;
  document.querySelector(".stepper-card").hidden = true;
  document.querySelector(".detail-grid").hidden = true;
  $("#downloadInvoiceBtn").hidden = true;
  $("#trackingBtn").hidden = true;
  $("#revocationBtn").hidden = true;
}

async function load() {
  // Un id mal formado ni se consulta (la base respondería 400)
  if (!id || !UUID_RE.test(id)) return notFound();
  const { data } = await sb
    .from("orders")
    .select("*, order_items(*), order_events(*), invoices(*), payment_receipts(*), revocation_requests(id, code, status, admin_note, created_at)")
    .eq("id", id)
    .maybeSingle();
  if (!data) return notFound();
  data.order_events.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  render(data);
}

loading(async () => {
  const user = await requireAuth();
  if (!user) return;
  userId = user.id;
  document.getElementById("footerYear").textContent = new Date().getFullYear();
  await load();
  if (!id || !UUID_RE.test(id)) return;
  subscribe("orders", load, `id=eq.${id}`, ["UPDATE"]);
  subscribe("payment_receipts", load, `order_id=eq.${id}`, ["INSERT", "UPDATE"]);
  subscribe("invoices", load, `order_id=eq.${id}`, ["INSERT", "UPDATE"]);
});
