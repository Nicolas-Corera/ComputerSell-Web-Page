// Nota de venta / nota de crédito: documento propio (no es factura fiscal).
// Lo usan el panel (vista previa + imprimir) y el detalle de pedido del cliente.
// Completá los datos del vendedor en SELLER.

export const SELLER = {
  name: "ComputerSell",
  owner: "", // nombre completo de quien vende (aparece en "Vendedor" y en la firma)
  doc: "", // DNI o CUIT de quien vende, ej. "CUIT 20-12345678-9"
  address: "",
  phone: "+54 9 11 2358-9249",
  email: "contacto@computersell.com.ar",
};

const PAYMENT = { credito: "Tarjeta de crédito", debito: "Tarjeta de débito", transferencia: "Transferencia", mercadopago: "Mercado Pago" };
const money = (n) => "$" + Number(n || 0).toLocaleString("es-AR");
const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const fmtDate = (d) => new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

export const NOTE_STYLE = `
.saleNote{background:#fff;color:#111;font-family:Inter,Arial,sans-serif;font-size:13px;line-height:1.45;padding:36px 40px;border-radius:12px;max-width:820px;margin:0 auto}
.saleNote *{box-sizing:border-box}
.saleNote .sn-head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:2px solid #111;padding-bottom:14px}
.saleNote .sn-brand{display:flex;align-items:center;gap:12px}
.saleNote .sn-brand img{width:42px;height:42px}
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
.saleNote .sn-sign .line{width:260px;border-top:1px solid #111;padding-top:6px;text-align:center;font-size:12px;color:#333}
.saleNote .sn-sign .line strong{display:block;font-size:13px}
.saleNote .sn-legal{margin-top:26px;padding:10px 12px;border:1px solid #f0c36d;background:#fff8e6;border-radius:8px;font-size:11.5px;color:#5a4500}
.saleNote .sn-foot{margin-top:14px;display:flex;justify-content:space-between;font-size:11px;color:#777}
@media print{.saleNote{padding:0;border-radius:0;max-width:none}}
`;

// inv: { number, type ('NV'|'NC'), total, issued_at } · order: fila de orders con order_items
export function saleNoteHtml(inv, order) {
  const o = order || {};
  const c = o.customer || {};
  const isNC = inv.type === "NC";
  const items = (o.order_items || o.items || []).map((it) => ({
    title: it.title || (it.product && it.product.name) || "",
    sku: it.sku || (it.product && it.product.sku) || "",
    qty: it.qty,
    price: it.unit_price != null ? it.unit_price : it.price,
  }));
  const shipping = o.shipping_cost != null ? o.shipping_cost : o.shipping || 0;
  const surcharge = o.surcharge || 0;
  const subtotal = o.subtotal || items.reduce((s, it) => s + it.price * it.qty, 0);
  const payment = PAYMENT[o.payment_method || o.payment] || o.payment_method || o.payment || "";
  const installments = o.installments > 1 ? ` · ${o.installments} cuotas sin interés` : "";
  const number = o.number || (o.id && String(o.id).replace(/^CS-/, "")) || "";
  const sellerName = SELLER.owner || SELLER.name;

  return `
  <style>${NOTE_STYLE}</style>
  <div class="saleNote" id="saleNoteDoc">
    <div class="sn-head">
      <div class="sn-brand">
        <img src="${location.origin}/assets/images/isotipo.png" alt="" />
        <div>
          <strong>${esc(SELLER.name)}</strong>
          <small>${esc([SELLER.address, SELLER.phone, SELLER.email].filter(Boolean).join(" · "))}</small>
        </div>
      </div>
      <div class="sn-title">
        <h2>${isNC ? "NOTA DE CRÉDITO" : "NOTA DE VENTA"}</h2>
        <div class="sn-num">N° ${esc(inv.number)}</div>
        <small>Fecha de la operación: ${fmtDate(inv.issued_at || inv.date || o.created_at)}</small>
        <small>Pedido: CS-${esc(number)}</small>
      </div>
    </div>

    <div class="sn-parties">
      <div class="sn-box">
        <small>Vendedor</small>
        <strong>${esc(sellerName)}</strong><br />
        ${SELLER.doc ? esc(SELLER.doc) : '<span style="color:#999">DNI / CUIT sin cargar</span>'}
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
        <tr class="total"><td>${isNC ? "Total a acreditar" : "Monto total"}</td><td class="num">${money(inv.total)}</td></tr>
      </table>
    </div>

    <div class="sn-sign">
      <div style="font-size:12px;color:#555">Emitido por ${esc(SELLER.name)}</div>
      <div class="line"><strong>${esc(sellerName)}</strong>Firma y aclaración</div>
    </div>

    <div class="sn-legal">
      <strong>Aclaración:</strong> este documento no constituye factura ni comprobante fiscal válido ante ARCA. No habilita el cómputo de IVA ni de gasto deducible; es una constancia interna de la operación entre las partes.
    </div>
    <div class="sn-foot"><span>Documento generado por ${esc(SELLER.name)}</span><span>Página 1 de 1</span></div>
  </div>`;
}

// Abre el documento en una ventana lista para imprimir / guardar como PDF
export function printSaleNote(inv, order) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8" /><title>${esc(inv.number)}</title>
    <style>body{margin:0;padding:24px;background:#fff}@page{margin:16mm}</style></head>
    <body>${saleNoteHtml(inv, order)}<script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>`);
  w.document.close();
  return true;
}
