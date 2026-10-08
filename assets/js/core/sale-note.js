// Nota de venta / nota de crédito: documento propio (no es factura fiscal).
// Lo usan el panel (vista previa + imprimir) y el detalle de pedido del cliente.
// Los datos públicos del vendedor están en assets/js/config/seller.js (SELLER),
// que también usan las páginas legales. Nombre completo y DNI/CUIT no son
// públicos: salen de seller_private() (solo admin o quien tiene una nota de
// venta). La imagen de la firma no va en el repo: se sube al bucket privado
// "docs" con `npm run firma`. El panel la lee con una URL firmada de pocos
// minutos (solo admins); el cliente, de /api/firma (solo con una nota emitida).
import { sb, getSellerPrivate } from "./supabase.js";
import { SELLER } from "../config/seller.js";

export { SELLER };

const PAYMENT = { credito: "Tarjeta de crédito", debito: "Tarjeta de débito", transferencia: "Transferencia", mercadopago: "Mercado Pago" };
const money = (n) => "$" + Number(n || 0).toLocaleString("es-AR");
const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const fmtDate = (d) => new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

export const NOTE_STYLE = `
.saleNote{background:#fff;color:#111;font-family:Inter,Arial,sans-serif;font-size:13px;line-height:1.45;padding:36px 40px;border-radius:12px;max-width:820px;margin:0 auto}
.saleNote *{box-sizing:border-box}
.saleNote .sn-head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:2px solid #111;padding-bottom:14px}
.saleNote .sn-brand{display:flex;align-items:center;gap:12px}
.saleNote .sn-brand img{width:52px;height:52px;padding:8px;border-radius:12px;background:#14161c;box-shadow:0 4px 12px rgba(0,0,0,.28);object-fit:contain}
.saleNote .sn-brand strong{font-size:20px;display:block}
.saleNote .sn-brand small{color:#555;display:block;font-size:12px}
.saleNote .sn-title{text-align:right}
.saleNote .sn-title h2{margin:0;font-size:18px;letter-spacing:.04em;color:#111;font-family:inherit;font-weight:800}
.saleNote strong,.saleNote h2{color:#111}
.saleNote .sn-title .sn-num{font-size:15px;font-weight:700;margin-top:2px}
.saleNote .sn-title small{color:#555;display:block;font-size:12px}
.saleNote .sn-parties{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:18px 0}
.saleNote .sn-box{border:1px solid #ddd;border-radius:8px;padding:10px 12px}
.saleNote .sn-box small{display:block;color:#666;font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
.saleNote table{width:100%;border-collapse:collapse;margin-top:6px}
.saleNote th,.saleNote td{padding:8px 10px;border-bottom:1px solid #e3e3e3;text-align:left;vertical-align:top}
.saleNote th{background:#f3f4f6;font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:#444}
.saleNote td.num,.saleNote th.num{text-align:right;white-space:nowrap}
.saleNote td small{color:#666}
.saleNote .sn-totals{display:flex;justify-content:flex-end;margin-top:12px}
.saleNote .sn-totals table{width:auto;min-width:280px}
.saleNote .sn-totals td{border:none;padding:4px 10px}
.saleNote .sn-totals tr.total td{border-top:2px solid #111;font-size:16px;font-weight:700;padding-top:8px}
.saleNote .sn-sign{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-top:44px}
.saleNote .sn-sign .line{width:260px;border-top:1px solid #111;padding-top:6px;text-align:center;font-size:12px;color:#333;position:relative}
.saleNote .sn-firma{display:block;height:70px;max-width:230px;object-fit:contain;object-position:bottom;margin:0 auto -6px;position:relative;z-index:1}
.saleNote .sn-sign .line strong{display:block;font-size:13px}
.saleNote .sn-legal{margin-top:26px;padding:10px 12px;border:1px solid #f0c36d;background:#fff8e6;border-radius:8px;font-size:11.5px;color:#5a4500}
.saleNote .sn-foot{margin-top:14px;display:flex;justify-content:space-between;font-size:11px;color:#777}
@media print{.saleNote{padding:0;border-radius:0;max-width:none}}
`;

// Firma (data URL o URL firmada de 10 min) y datos privados del vendedor. Se
// cachean; si la firma no está o no corresponde verla, no se muestra.
let signatureUrl = null;
let seller = {};
const inPanel = /^dash\./i.test(location.hostname) || location.pathname.startsWith("/dash/");

async function fetchSignature() {
  if (inPanel) {
    const { data } = await sb.storage.from("docs").createSignedUrl("firma.png", 600);
    return data ? data.signedUrl : "";
  }
  const { data: sess } = await sb.auth.getSession();
  if (!sess || !sess.session) return "";
  const res = await fetch("/api/firma", { headers: { Authorization: "Bearer " + sess.session.access_token } });
  if (!res.ok) return "";
  const blob = await res.blob();
  if (blob.type !== "image/png") return "";
  return await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });
}

export async function loadSignature() {
  seller = await getSellerPrivate(true);
  if (signatureUrl !== null) return signatureUrl;
  try {
    signatureUrl = await fetchSignature();
  } catch (e) {
    signatureUrl = "";
  }
  return signatureUrl;
}

// inv: { number, type ('NV'), total, issued_at } · order: fila de orders con order_items
// Llamar antes a loadSignature() para que aparezcan la firma y los datos del vendedor.
export function saleNoteHtml(inv, order) {
  const o = order || {};
  const c = o.customer || {};
  const items = (o.order_items || o.items || []).map((it) => ({
    title: it.title || (it.product && it.product.name) || "",
    sku: it.sku || (it.product && it.product.sku) || "",
    qty: it.qty,
    price: it.unit_price != null ? it.unit_price : it.price,
  }));
  const shipping = o.shipping_cost != null ? o.shipping_cost : o.shipping || 0;
  const surcharge = o.surcharge || 0;
  const subtotal = o.subtotal || items.reduce((s, it) => s + it.price * it.qty, 0);
  const pay = o.payment || o.paymentInfo || {};
  const card = pay.brand ? ` · ${pay.brand}${pay.last_four ? " •••• " + pay.last_four : ""}` : "";
  const payment = (PAYMENT[o.payment_method || o.payment] || o.payment_method || o.payment || "") + card;
  const installments = o.installments > 1 ? ` · ${o.installments} cuotas` : "";
  const number = o.number || (o.id && String(o.id).replace(/^CS-/, "")) || "";
  const sellerName = seller.owner || SELLER.name;

  return `
  <style>${NOTE_STYLE}</style>
  <div class="saleNote" id="saleNoteDoc">
    <div class="sn-head">
      <div class="sn-brand">
        <img src="${location.origin}/assets/images/isotipo.png" alt="" />
        <div>
          <strong>${esc(SELLER.name)}</strong>
          <small>${esc([SELLER.address, SELLER.email].filter(Boolean).join(" · "))}</small>
        </div>
      </div>
      <div class="sn-title">
        <h2>NOTA DE VENTA</h2>
        <div class="sn-num">N° ${esc(inv.number)}</div>
        <small>Fecha de la operación: ${fmtDate(inv.issued_at || inv.date || o.created_at)}</small>
        <small>Pedido: CS-${esc(number)}</small>
      </div>
    </div>

    <div class="sn-parties">
      <div class="sn-box">
        <small>Vendedor</small>
        <strong>${esc(sellerName)}</strong><br />
        ${seller.doc ? esc(seller.doc) : '<span style="color:#999">DNI / CUIT sin cargar</span>'}<br />
        ${SELLER.phone ? esc(SELLER.phone) : '<span style="color:#999">Teléfono sin cargar</span>'}
      </div>
      <div class="sn-box">
        <small>Comprador</small>
        <strong>${esc(c.name || "")}</strong><br />
        DNI ${esc(c.dni || "-")}${c.email ? `<br /><span style="color:#555">${esc(c.email)}</span>` : ""}${c.address ? `<br /><span style="color:#555">${esc(c.address)}</span>` : ""}
      </div>
    </div>

    <table>
      <thead><tr><th>Descripción</th><th class="num">Cantidad</th><th class="num">Precio unitario</th><th class="num">Subtotal</th></tr></thead>
      <tbody>
        ${items.map((it) => `<tr><td>${esc(it.title)}${it.sku ? `<br /><small>SKU ${esc(it.sku)}</small>` : ""}</td><td class="num">${it.qty}</td><td class="num">${money(it.price)}</td><td class="num">${money(it.price * it.qty)}</td></tr>`).join("")}
        ${shipping ? `<tr><td>Envío a domicilio</td><td class="num">1</td><td class="num">${money(shipping)}</td><td class="num">${money(shipping)}</td></tr>` : ""}
        ${surcharge ? `<tr><td>Recargo por medio de pago</td><td class="num">1</td><td class="num">${money(surcharge)}</td><td class="num">${money(surcharge)}</td></tr>` : ""}
      </tbody>
    </table>

    <div class="sn-totals">
      <table>
        <tr><td>Subtotal</td><td class="num">${money(subtotal)}</td></tr>
        ${shipping ? `<tr><td>Envío</td><td class="num">${money(shipping)}</td></tr>` : ""}
        ${surcharge ? `<tr><td>Recargo</td><td class="num">${money(surcharge)}</td></tr>` : ""}
        <tr><td>Forma de pago</td><td class="num">${esc(payment)}${esc(installments)}</td></tr>
        <tr class="total"><td>Monto total</td><td class="num">${money(inv.total)}</td></tr>
      </table>
    </div>

    <div class="sn-sign">
      <div style="font-size:12px;color:#555">Emitido por ${esc(SELLER.name)}</div>
      <div>
        ${signatureUrl && /^(data:image\/png;base64,|https:\/\/)/.test(signatureUrl) ? `<img class="sn-firma" src="${esc(signatureUrl)}" alt="Firma" />` : ""}
        <div class="line"><strong>${esc(sellerName)}</strong>Firma y aclaración</div>
      </div>
    </div>

    <div class="sn-legal">
      <strong>Aclaración:</strong> este documento es una constancia de la operación entre las partes. No es un comprobante fiscal.
    </div>
    <div class="sn-foot"><span>Documento generado por ${esc(SELLER.name)}</span><span>Página 1 de 1</span></div>
  </div>`;
}

// Abre el documento en una ventana lista para imprimir / guardar como PDF.
// La ventana se abre ANTES de cargar la firma: si se abre después de un await
// el navegador ya no lo considera un click del usuario y la bloquea.
export async function printSaleNote(inv, order) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8" /><title>${esc(inv.number)}</title></head><body style="font-family:Arial,sans-serif;padding:24px">Preparando la nota de venta…</body></html>`);
  await loadSignature();
  if (w.closed) return true;
  w.document.open();
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8" /><title>${esc(inv.number)}</title>
    <style>body{margin:0;padding:24px;background:#fff}@page{margin:16mm}</style></head>
    <body>${saleNoteHtml(inv, order)}</body></html>`);
  w.document.close();
  // La impresión la dispara esta página: la ventana nueva hereda la Content
  // Security Policy, que no permite <script> dentro del HTML
  const print = () => setTimeout(() => {
    w.focus();
    w.print();
  }, 400);
  if (w.document.readyState === "complete") print();
  else w.addEventListener("load", print, { once: true });
  return true;
}
