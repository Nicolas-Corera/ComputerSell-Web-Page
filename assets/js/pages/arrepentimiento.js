// Botón de arrepentimiento (tienda/arrepentimiento.html)
//
// Formulario que llama a request_revocation (supabase/migrations/0008).
// No exige iniciar sesión: alcanza con el número de pedido y el email de la
// compra (Disp. 954/2025). Con sesión, precarga los datos, sugiere los pedidos
// del cliente y muestra sus solicitudes anteriores.
// ?pedido=CS-10480 precarga el número (lo usa el detalle del pedido).
import { sb, getUser, getProfile, fullName } from "../core/supabase.js";

const form = document.getElementById("revocationForm");
const result = document.getElementById("revocationResult");
const errorBox = document.getElementById("revocationError");
const mine = document.getElementById("revocationMine");
const { escapeHtml } = window.CS || { escapeHtml: (s) => String(s) };

const STATUS = {
  recibida: "Recibida",
  en_curso: "En curso",
  reintegrada: "Reintegrada",
  rechazada: "Rechazada",
  desistida: "Desistida",
};
const fmtDate = (d) =>
  new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" });
const fmtDateTime = (d) => new Date(d).toLocaleString("es-AR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
let userId = null; // con sesión: id del cliente
// "CS-10486" -> 10486 (dentro del rango de la base; si no, null)
const orderNumber = (v) => {
  const n = parseInt(String(v || "").replace(/\D/g, "").slice(0, 10), 10);
  return n > 0 && n <= 2147483647 ? n : null;
};

async function prefill() {
  const params = new URLSearchParams(location.search);
  if (params.get("pedido")) form.pedido.value = params.get("pedido");

  const user = await getUser();
  if (!user) return;
  userId = user.id;
  const profile = await getProfile();
  if (profile) {
    if (!form.email.value) form.email.value = profile.email || user.email || "";
    if (!form.nombre.value) form.nombre.value = fullName(profile);
  }
  form.email.required = false;
  form.querySelector("[data-email-hint]").hidden = false;

  const { data: orders } = await sb
    .from("orders")
    .select("number, created_at, status")
    .eq("user_id", user.id)
    .neq("status", "cancelado")
    .order("created_at", { ascending: false })
    .limit(20);
  const list = document.getElementById("revocationOrders");
  list.innerHTML = (orders || []).map((o) => `<option value="CS-${o.number}">${fmtDate(o.created_at)}</option>`).join("");

  renderMine();
}

async function renderMine() {
  const { data } = await sb
    .from("revocation_requests")
    .select("code, status, created_at, deadline, orders(number)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (!data || !data.length) return (mine.hidden = true);
  mine.hidden = false;
  mine.querySelector("tbody").innerHTML = data
    .map(
      (r) => `<tr>
        <td data-label="Código"><code>${escapeHtml(r.code)}</code></td>
        <td data-label="Pedido">CS-${r.orders ? r.orders.number : "—"}</td>
        <td data-label="Fecha">${fmtDateTime(r.created_at)}</td>
        <td data-label="Estado"><span class="legal-tag">${STATUS[r.status] || r.status}</span></td>
      </tr>`,
    )
    .join("");
}

function showResult(r) {
  form.hidden = true;
  errorBox.hidden = true;
  result.hidden = false;
  result.querySelector("[data-r=code]").textContent = r.request_code;
  result.querySelector("[data-r=order]").textContent = "CS-" + r.order_number;
  result.querySelector("[data-r=date]").textContent = fmtDateTime(r.requested_at);
  result.querySelector("[data-r=deadline]").textContent = fmtDate(r.deadline_date);
  result.querySelector("[data-r=existing]").hidden = !r.already_existed;
  result.focus();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  form.classList.add("is-submitted");
  errorBox.hidden = true;
  const number = orderNumber(form.pedido.value);
  form.pedido.setCustomValidity(number ? "" : "Ingresá el número de pedido (por ejemplo, CS-10480)");
  if (!form.checkValidity()) return form.reportValidity();

  const btn = form.querySelector("[type=submit]");
  btn.disabled = true;
  btn.textContent = "Enviando…";
  const { data, error } = await sb.rpc("request_revocation", {
    p_order_number: number,
    p_email: form.email.value.trim(),
    p_name: form.nombre.value.trim(),
    p_dni: form.dni.value.trim(),
    p_received_on: form.recibido.value || null,
    p_reason: form.motivo.value.trim(),
  });
  btn.disabled = false;
  btn.textContent = "Enviar solicitud de arrepentimiento";

  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) {
    // Los mensajes de la base para el cliente están en castellano; un error
    // técnico (en inglés) no se muestra tal cual
    const msg = error && error.message;
    errorBox.textContent = msg && /[áéíóúñ]|^(No |El |La |Hiciste )/.test(msg) ? msg : "No pudimos registrar la solicitud. Revisá los datos o escribinos.";
    errorBox.hidden = false;
    errorBox.focus();
    return;
  }
  showResult(row);
  if (userId) renderMine();
});

// Imprime solo la constancia (ver @media print en legal.css)
document.getElementById("revocationPrint").addEventListener("click", () => {
  document.body.classList.add("print-result");
  window.print();
  document.body.classList.remove("print-result");
});

// La fecha de recepción no puede ser futura
form.recibido.max = new Date().toLocaleDateString("en-CA");

prefill();
