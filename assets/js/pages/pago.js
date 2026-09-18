// Página de pago (checkout): datos personales, envío, medio de pago con
// tarjeta animada y resumen lateral con envío + recargo + total.
// Requiere sesión.
//
// Tarjeta (crédito/débito): Mercado Pago Checkout API. El número, vencimiento
// y CVV son Secure Fields del SDK (iframes de MP: los datos nunca pasan por
// acá). Al pagar se crea un token y se manda a /api/mp/pay, que crea la orden
// (place_order valida stock y precios en la base) y cobra con la API de Orders.
// Transferencia: la orden se crea desde acá con place_order y se sube el
// comprobante para que el panel lo revise.
import { sb, requireAuth, getProfile, loading } from "../core/supabase.js";
import { createCatalog } from "../core/catalog.js";

loading(async function () {
  const { formatPrice, escapeHtml, toast } = window.CS;
  const store = window.CartStore;
  const ENV = window.CS_ENV || {};

  const user = await requireAuth();
  if (!user) return;
  const profile = await getProfile();
  await createCatalog().ready; // precio/stock del carrito al día

  // ---------- Configuración (valores de la demo) ----------
  // Envío a domicilio: se cobra siempre
  const SHIPPING = { label: "Envío a domicilio", cost: 15000 };

  // Recargo sobre el subtotal según el medio de pago
  const PAYMENT = {
    credito: { label: "Tarjeta de crédito", surcharge: 0.1, card: true },
    debito: { label: "Tarjeta de débito", surcharge: 0.03, card: true },
    transferencia: { label: "Transferencia", surcharge: 0, card: false },
  };

  // ---------- DOM ----------
  const checkout = document.getElementById("checkout");
  const empty = document.getElementById("checkoutEmpty");
  const success = document.getElementById("checkoutSuccess");
  const form = document.getElementById("checkoutForm");

  // Datos del perfil precargados (solo los campos vacíos)
  if (profile) {
    const addr = profile.address || {};
    const fill = { nombre: profile.first_name, apellido: profile.last_name, email: profile.email, telefono: profile.phone, dni: addr.dni, calle: addr.calle, numero: addr.numero, piso: addr.piso, cp: addr.cp, ciudad: addr.ciudad, provincia: addr.provincia };
    Object.entries(fill).forEach(([k, v]) => {
      const el = form.elements[k];
      if (el && !el.value && v) el.value = v;
    });
  }
  const countEl = document.getElementById("payCount");

  const summaryItems = document.getElementById("summaryItems");
  const sumSubtotal = document.getElementById("sumSubtotal");
  const sumShipping = document.getElementById("sumShipping");
  const sumShippingLabel = document.getElementById("sumShippingLabel");
  const sumPayment = document.getElementById("sumPayment");
  const sumPaymentLabel = document.getElementById("sumPaymentLabel");
  const sumTotal = document.getElementById("sumTotal");
  const sumCuotas = document.getElementById("sumCuotas");
  const payBtn = document.getElementById("payBtn");

  const tabs = Array.from(document.querySelectorAll(".payTab"));
  const panels = Array.from(document.querySelectorAll(".payPanel"));
  const cuotasField = document.getElementById("cuotasField");
  const cuotasSelect = document.getElementById("cuotas");

  const state = {
    method: "credito",
    completed: false,
    // Tarjeta detectada por Mercado Pago a partir del BIN
    bin: "",
    paymentMethod: null, // {id, name, payment_type_id, settings...}
    installmentPlans: [], // payer_costs de MP para el BIN y el monto actual
    installmentsAmount: 0, // monto con el que se pidieron las cuotas
    fields: { number: false, expiry: false, cvv: false }, // validez de los secure fields
  };

  // ---------- Resumen ----------
  function totals() {
    const subtotal = store.totalPrice();
    const items = store.getItems();
    const allFree = items.length > 0 && items.every((it) => it.freeShipping);
    const shipping = allFree ? 0 : SHIPPING.cost;
    const rate = PAYMENT[state.method].surcharge;
    const surcharge = Math.round(subtotal * rate);
    return { subtotal, shipping, surcharge, rate, total: subtotal + shipping + surcharge };
  }

  function bump(el) {
    el.classList.remove("is-bump");
    void el.offsetWidth;
    el.classList.add("is-bump");
  }

  function renderSummary() {
    const items = store.getItems();
    const t = totals();

    summaryItems.innerHTML = items
      .map(
        (it) => `
        <li class="summaryItem">
          <div class="summaryItem-img">
            ${it.image ? `<img src="${escapeHtml(it.image)}" alt="" />` : ""}
          </div>
          <div class="summaryItem-body">
            <span class="summaryItem-name">${escapeHtml(it.name)}</span>
            <span class="summaryItem-qty">x${it.qty}</span>
          </div>
          <span class="summaryItem-price">${formatPrice(it.price * it.qty)}</span>
        </li>`,
      )
      .join("");

    sumSubtotal.textContent = formatPrice(t.subtotal);

    sumShippingLabel.textContent = SHIPPING.label;
    sumShipping.textContent = t.shipping ? formatPrice(t.shipping) : "Gratis";

    const pct = Math.round(t.rate * 100);
    sumPaymentLabel.textContent = PAYMENT[state.method].label;
    sumPayment.classList.toggle("is-none", t.surcharge === 0);
    sumPayment.textContent =
      t.surcharge === 0 ? "Sin recargo" : `${formatPrice(t.surcharge)} (+${pct}%)`;

    sumTotal.textContent = formatPrice(t.total);
    bump(sumTotal);

    // Cuotas (solo crédito): con el plan real de Mercado Pago si ya se conoce
    // la tarjeta (puede tener interés); si no, valor informativo
    const n = state.method === "credito" ? parseInt(cuotasSelect.value, 10) || 1 : 1;
    const plan = state.installmentPlans.find((p) => p.installments === n);
    if (n > 1) {
      sumCuotas.hidden = false;
      if (plan) {
        const withInterest = Math.round(plan.total_amount) > t.total;
        sumCuotas.textContent = `${n} cuotas de $${formatPrice(Math.round(plan.installment_amount))}${withInterest ? ` · Total financiado $${formatPrice(Math.round(plan.total_amount))}` : " sin interés"}`;
      } else {
        sumCuotas.textContent = `${n} cuotas de $${formatPrice(Math.round(t.total / n))}`;
      }
    } else {
      sumCuotas.hidden = true;
    }

    payBtn.textContent = `Pagar $${formatPrice(t.total)}`;
    updatePayButton();
    syncSummarySheet();
    if (state.method === "credito" && state.bin && state.installmentsAmount !== t.total) refreshInstallments();
  }

  // ---------- Resumen desplegable desde abajo (móvil/tablet) ----------
  // En < 992px el resumen queda arriba del formulario y desaparece al scrollear.
  // Cuando sale de la vista se muestra una barra fija abajo con el total; la
  // flecha despliega hacia arriba una copia del resumen (se mantiene en sync
  // en cada renderSummary).
  const summaryEl = document.querySelector(".checkout-summary");
  const sheet = document.getElementById("summarySheet");
  const sheetBody = document.getElementById("summarySheetBody");
  const sheetToggle = document.getElementById("summarySheetToggle");
  const sheetTotal = document.getElementById("summarySheetTotal");
  const sheetBackdrop = document.getElementById("summarySheetBackdrop");

  function syncSummarySheet() {
    if (!sheet || !summaryEl) return;
    // Copia sin ids para no duplicarlos en el documento
    sheetBody.innerHTML = summaryEl.innerHTML.replace(/\sid="[^"]*"/g, "");
    sheetTotal.textContent = sumTotal.textContent;
  }

  function setSheetExpanded(expanded) {
    if (!sheet) return;
    sheet.classList.toggle("is-expanded", expanded);
    sheetToggle.setAttribute("aria-expanded", String(expanded));
    sheetBackdrop.classList.toggle("is-visible", expanded);
  }

  function setSheetVisible(visible) {
    if (!sheet) return;
    sheet.classList.toggle("is-visible", visible);
    sheet.setAttribute("aria-hidden", String(!visible));
    document.body.classList.toggle("summary-sheet-visible", visible);
    if (!visible) setSheetExpanded(false);
  }

  if (sheet && summaryEl) {
    sheetToggle.addEventListener("click", () => {
      setSheetExpanded(!sheet.classList.contains("is-expanded"));
    });
    sheetBackdrop.addEventListener("click", () => setSheetExpanded(false));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setSheetExpanded(false);
    });

    // Se muestra solo cuando el resumen quedó por encima del viewport
    // (y el checkout sigue visible: no en el estado vacío ni en el de éxito)
    function updateSheetVisibility() {
      const scrolledPast = summaryEl.getBoundingClientRect().bottom < 0;
      setSheetVisible(scrolledPast && !checkout.hidden);
    }
    window.addEventListener("scroll", updateSheetVisibility, { passive: true });
    window.addEventListener("resize", updateSheetVisibility);
    updateSheetVisibility();
  }

  // ---------- Mayúscula inicial en cada palabra ----------
  // "juan perez" -> "Juan Perez" (también después de ' y -)
  function titleCase(str) {
    return str
      .toLowerCase()
      .replace(/(^|[\s'-])([a-zà-ÿ])/g, (m, sep, ch) => sep + ch.toUpperCase());
  }

  // Nombre, apellido, calle y ciudad (inputs con data-titlecase)
  form.querySelectorAll("input[data-titlecase]").forEach((input) => {
    input.addEventListener("input", () => {
      const caret = input.selectionStart;
      input.value = titleCase(input.value);
      if (caret !== null) input.setSelectionRange(caret, caret);
    });
  });

  // ---------- Teléfono y DNI ----------
  const inPhone = document.getElementById("telefono");
  const inDni = document.getElementById("dni");

  // 10 dígitos -> "11 2345-6789"
  function formatPhone(value) {
    const d = value.replace(/\D/g, "").slice(0, 10);
    if (d.length <= 2) return d;
    if (d.length <= 6) return `${d.slice(0, 2)} ${d.slice(2)}`;
    return `${d.slice(0, 2)} ${d.slice(2, 6)}-${d.slice(6)}`;
  }

  // 7/8 dígitos -> "30.123.456"
  function formatDni(value) {
    const d = value.replace(/\D/g, "").slice(0, 8);
    return d.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  inPhone.addEventListener("input", () => {
    inPhone.value = formatPhone(inPhone.value);
  });
  inDni.addEventListener("input", () => {
    inDni.value = formatDni(inDni.value);
  });

  // ---------- Tabs de medio de pago ----------
  // Los campos seguros de MP conservan lo escrito al cambiar entre crédito y
  // débito (misma tarjeta, distinto recargo); solo se reinician las cuotas.
  function setMethod(method) {
    if (method === state.method) return;
    state.method = method;
    const isCard = PAYMENT[method].card;
    cuotasSelect.value = "1";
    preview.classList.remove("is-flipped");
    delete preview.dataset.focus;

    tabs.forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.method === method);
    });
    panels.forEach((panel) => {
      const active = panel.dataset.panel === (isCard ? "card" : method);
      panel.classList.toggle("is-active", active);
      panel.querySelectorAll("input, select").forEach((el) => {
        el.disabled = !active;
      });
    });

    cuotasField.hidden = method !== "credito";
    cuotasSelect.disabled = method !== "credito";
    setReceipt(null);
    checkCardType();
    if (method === "credito" && state.bin) refreshInstallments();
    renderSummary();
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => setMethod(tab.dataset.method));
  });
  cuotasSelect.addEventListener("change", renderSummary);

  // ---------- Tarjeta animada ----------
  const preview = document.getElementById("cardPreview");
  const brandEl = document.getElementById("cardBrand");
  const backBrandEl = document.getElementById("cardBackBrand");
  const numberEl = document.getElementById("cardNumberPreview");
  const nameEl = document.getElementById("cardNamePreview");
  const expiryEl = document.getElementById("cardExpiryPreview");
  const cvvEl = document.getElementById("cardCvvPreview");
  const inName = document.getElementById("cardName");

  // Marca (id de medio de pago de MP) -> estilo del logo en la tarjeta
  function brandKey(id) {
    if (/visa/.test(id)) return "visa";
    if (/master|maestro/.test(id)) return "mastercard";
    if (/amex/.test(id)) return "amex";
    return id ? "other" : "";
  }

  // Reemplaza el texto marcando como "nuevos" los caracteres que cambiaron
  function setAnimatedText(el, text, placeholder) {
    const prev = el.dataset.value || "";
    const value = text || placeholder;
    el.classList.toggle("is-placeholder", !text);
    el.innerHTML = "";
    value.split("").forEach((ch, i) => {
      const span = document.createElement("span");
      span.textContent = ch;
      if (text && prev[i] !== ch) span.classList.add("is-new");
      el.appendChild(span);
    });
    el.dataset.value = text || "";
  }

  // Preview del número: el SDK solo expone el BIN (primeros dígitos); el
  // resto se muestra como "#" hasta que el campo es válido y ahí como "•"
  function renderNumber() {
    const pm = state.paymentMethod;
    const key = brandKey(pm ? pm.id : "");
    brandEl.className = "cardPreview-brand" + (key ? ` is-visible brand-${key}` : "");
    brandEl.textContent = key === "other" ? pm.name : "";
    backBrandEl.textContent = pm ? pm.name.toUpperCase() : "";

    const setting = pm && pm.settings && pm.settings[0];
    const length = (setting && setting.card_number && setting.card_number.length) || 16;
    const template = length === 15 ? [4, 6, 5] : [4, 4, 4, 4];
    const digits = state.bin;
    const prev = numberEl.dataset.value || "";
    numberEl.innerHTML = "";
    let idx = 0;
    template.forEach((len) => {
      const group = document.createElement("span");
      group.className = "cardPreview-group";
      for (let i = 0; i < len; i++) {
        const span = document.createElement("span");
        const ch = digits[idx];
        span.textContent = ch || (state.fields.number ? "•" : "#");
        if (!ch) span.classList.add("is-placeholder");
        else if (prev[idx] !== ch) span.classList.add("is-new");
        group.appendChild(span);
        idx++;
      }
      numberEl.appendChild(group);
    });
    numberEl.dataset.value = digits;

    if (digits && !prev) preview.classList.add("is-shine");
    if (!digits) preview.classList.remove("is-shine");
  }

  function renderName() {
    const caret = inName.selectionStart;
    const clean = inName.value.replace(/[^a-zA-ZÀ-ÿ\s'.-]/g, "").slice(0, 26);
    inName.value = titleCase(clean);
    if (caret !== null) inName.setSelectionRange(caret, caret);
    setAnimatedText(nameEl, inName.value.trim().toUpperCase(), "NOMBRE APELLIDO");
  }

  // Vencimiento y CVV viven en iframes de MP: se muestran enmascarados cuando son válidos
  function renderExpiry() {
    setAnimatedText(expiryEl, state.fields.expiry ? "••/••" : "", "MM/AA");
  }

  function renderCvv() {
    const setting = state.paymentMethod && state.paymentMethod.settings && state.paymentMethod.settings[0];
    const len = (setting && setting.security_code && setting.security_code.length) || 3;
    setAnimatedText(cvvEl, state.fields.cvv ? "•".repeat(len) : "", "•".repeat(len));
  }

  inName.addEventListener("input", renderName);
  inName.addEventListener("focus", () => {
    preview.dataset.focus = "name";
    preview.classList.remove("is-flipped");
  });
  inName.addEventListener("blur", () => delete preview.dataset.focus);

  // ---------- Mercado Pago: Secure Fields + medios de pago + cuotas ----------
  const secureEls = {
    number: document.getElementById("mpCardNumber"),
    expiry: document.getElementById("mpCardExpiry"),
    cvv: document.getElementById("mpCardCvv"),
  };
  const cuotasHint = document.getElementById("cuotasHint");
  const typeWarn = document.getElementById("cardTypeWarn");
  const typeWarnText = document.getElementById("cardTypeWarnText");
  const typeSwitch = document.getElementById("cardTypeSwitch");
  const mpErrorEl = document.getElementById("mpError");

  let mp = null;
  const secure = {};

  const FIELD_STYLE = {
    color: "#f2f4f6",
    placeholderColor: "rgba(160, 165, 172, 0.55)",
    fontFamily: "Montserrat",
    fontSize: "14px",
    height: "46px",
    padding: "0",
  };
  const FIELD_FONTS = [{ src: "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600&display=swap" }];

  function mountSecureFields() {
    const defs = [
      ["number", "cardNumber", "0000 0000 0000 0000"],
      ["expiry", "expirationDate", "MM/AA"],
      ["cvv", "securityCode", "CVV"],
    ];
    defs.forEach(([key, type, placeholder]) => {
      const opts = { placeholder, style: FIELD_STYLE, customFonts: FIELD_FONTS, ariaRequired: true };
      if (type === "expirationDate") opts.mode = "short";
      if (type === "cardNumber") opts.enableLuhnValidation = true;
      const field = mp.fields.create(type, opts).mount(secureEls[key].id);
      secure[key] = field;

      field.on("focus", () => {
        secureEls[key].classList.add("is-focus");
        preview.dataset.focus = key;
        preview.classList.toggle("is-flipped", key === "cvv");
      });
      field.on("blur", () => {
        secureEls[key].classList.remove("is-focus");
        delete preview.dataset.focus;
        preview.classList.remove("is-flipped");
      });
      field.on("validityChange", (ev) => {
        const valid = !ev.errorMessages || ev.errorMessages.length === 0;
        state.fields[key] = valid;
        secureEls[key].classList.toggle("is-valid", valid);
        secureEls[key].classList.toggle("is-invalid", !valid && form.classList.contains("is-submitted"));
        if (key === "number") renderNumber();
        if (key === "expiry") renderExpiry();
        if (key === "cvv") renderCvv();
      });
      field.on("error", (ev) => console.warn("[mp field]", key, ev));
    });

    // BIN válido -> medio de pago (marca, tipo crédito/débito, largo del CVV) y cuotas
    secure.number.on("binChange", async ({ bin }) => {
      state.bin = bin || "";
      if (!bin) {
        state.paymentMethod = null;
        setInstallmentOptions([]);
        renderNumber();
        renderCvv();
        checkCardType();
        renderSummary();
        return;
      }
      try {
        const { results } = await mp.getPaymentMethods({ bin });
        const pm = results && results[0];
        state.paymentMethod = pm || null;
        if (pm && pm.settings && pm.settings[0]) {
          secure.number.update({ settings: pm.settings[0].card_number });
          secure.cvv.update({ settings: pm.settings[0].security_code });
        }
      } catch (e) {
        console.error("[mp] getPaymentMethods", e);
        state.paymentMethod = null;
      }
      renderNumber();
      renderCvv();
      checkCardType();
      await refreshInstallments();
      renderSummary();
    });
  }

  // Si la tarjeta es de otro tipo que la pestaña elegida (crédito/débito) se avisa
  function checkCardType() {
    const pm = state.paymentMethod;
    const want = state.method === "credito" ? "credit_card" : state.method === "debito" ? "debit_card" : "";
    const mismatch = !!(pm && want && pm.payment_type_id && pm.payment_type_id !== want);
    typeWarn.hidden = !mismatch;
    if (mismatch) {
      const isCredit = pm.payment_type_id === "credit_card";
      typeWarnText.textContent = `${pm.name} es una tarjeta de ${isCredit ? "crédito" : "débito"}. Elegí "Tarjeta de ${isCredit ? "crédito" : "débito"}" para pagar con ella.`;
      typeSwitch.textContent = `Cambiar a ${isCredit ? "crédito" : "débito"}`;
      typeSwitch.onclick = () => setMethod(isCredit ? "credito" : "debito");
    }
    updatePayButton();
    return !mismatch;
  }

  function setInstallmentOptions(plans) {
    const current = parseInt(cuotasSelect.value, 10) || 1;
    state.installmentPlans = plans;
    cuotasSelect.innerHTML = "";
    const list = plans.length ? plans : [{ installments: 1, recommended_message: "1 cuota" }];
    list.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = String(p.installments);
      opt.textContent = p.recommended_message || `${p.installments} cuota${p.installments > 1 ? "s" : ""}`;
      cuotasSelect.appendChild(opt);
    });
    cuotasSelect.value = list.some((p) => p.installments === current) ? String(current) : String(list[0].installments);
    cuotasHint.hidden = !!plans.length;
  }

  // Cuotas reales para el BIN y el total actual (solo crédito, hasta 12)
  let installmentsSeq = 0;
  async function refreshInstallments() {
    const t = totals();
    state.installmentsAmount = t.total;
    if (!mp || !state.bin || state.method !== "credito") return;
    const seq = ++installmentsSeq;
    try {
      const res = await mp.getInstallments({ amount: String(t.total), bin: state.bin, paymentTypeId: "credit_card", locale: "es-AR" });
      if (seq !== installmentsSeq) return; // llegó una consulta más nueva
      const costs = ((res && res[0] && res[0].payer_costs) || []).filter((p) => p.installments <= 12);
      setInstallmentOptions(costs);
    } catch (e) {
      console.error("[mp] getInstallments", e);
      if (seq === installmentsSeq) setInstallmentOptions([]);
    }
    renderSummary();
  }

  function initMercadoPago() {
    if (!window.MercadoPago || !ENV.MP_PUBLIC_KEY) {
      console.error("[mp] SDK no cargado o falta MP_PUBLIC_KEY (corré npm run env)");
      mpErrorEl.hidden = false;
      return false;
    }
    try {
      mp = new MercadoPago(ENV.MP_PUBLIC_KEY, { locale: "es-AR" });
      mountSecureFields();
      return true;
    } catch (e) {
      console.error("[mp] init", e);
      mpErrorEl.hidden = false;
      return false;
    }
  }
  const mpReady = initMercadoPago();
  renderNumber();
  renderExpiry();
  renderCvv();

  // ---------- Comprobante de transferencia ----------
  const receiptInput = document.getElementById("receiptInput");
  const receiptDrop = document.getElementById("receiptDrop");
  const receiptFile = document.getElementById("receiptFile");
  const receiptName = document.getElementById("receiptName");
  const receiptRemove = document.getElementById("receiptRemove");
  const receiptError = document.getElementById("receiptError");

  const RECEIPT_TYPES = ["application/pdf", "image/jpeg", "image/png"];
  const RECEIPT_EXT = /\.(pdf|jpe?g|png)$/i;
  const RECEIPT_MAX = 5 * 1024 * 1024;
  let receiptOk = false;

  function receiptProblem(file) {
    if (!file) return "";
    if (!RECEIPT_TYPES.includes(file.type) || !RECEIPT_EXT.test(file.name)) {
      return "Solo se aceptan archivos PDF, JPG o PNG.";
    }
    if (file.size > RECEIPT_MAX) return "El archivo supera los 5 MB.";
    return "";
  }

  function setReceipt(file) {
    const problem = receiptProblem(file);
    receiptOk = !!file && !problem;

    receiptError.hidden = !problem;
    receiptError.textContent = problem;
    receiptFile.hidden = !receiptOk;
    receiptDrop.hidden = receiptOk;
    if (receiptOk) receiptName.textContent = file.name;
    if (!receiptOk) receiptInput.value = "";
    receiptInput.setCustomValidity(receiptOk ? "" : "Subí el comprobante de la transferencia");
    updatePayButton();
  }

  receiptInput.addEventListener("change", () => setReceipt(receiptInput.files[0]));
  receiptRemove.addEventListener("click", () => setReceipt(null));

  // Arrastrar y soltar sobre la zona
  ["dragenter", "dragover"].forEach((ev) =>
    receiptDrop.addEventListener(ev, (e) => {
      e.preventDefault();
      receiptDrop.classList.add("is-dragover");
    }),
  );
  ["dragleave", "drop"].forEach((ev) =>
    receiptDrop.addEventListener(ev, (e) => {
      e.preventDefault();
      receiptDrop.classList.remove("is-dragover");
    }),
  );
  receiptDrop.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!receiptProblem(file)) {
      const dt = new DataTransfer();
      dt.items.add(file);
      receiptInput.files = dt.files;
    }
    setReceipt(file);
  });

  // "Pagar" se deshabilita: transferencia sin comprobante, tarjeta sin SDK de
  // MP o cuando la tarjeta no coincide con la pestaña (crédito/débito)
  function updatePayButton() {
    if (state.method === "transferencia") payBtn.disabled = !receiptOk;
    else payBtn.disabled = !mpReady || !typeWarn.hidden;
  }

  // ---------- Validación de tarjeta ----------
  // La hace el SDK de MP en cada campo (validityChange); acá solo se marca
  // lo que falta y se lleva la vista al primero inválido.
  function validateCard() {
    const missing = ["number", "expiry", "cvv"].filter((k) => !state.fields[k]);
    missing.forEach((k) => secureEls[k].classList.add("is-invalid"));
    if (missing.length) {
      toast("Revisá los datos de la tarjeta", "bad");
      secureEls[missing[0]].scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    if (!state.paymentMethod) {
      toast("No pudimos identificar la tarjeta. Revisá el número.", "bad");
      return false;
    }
    return checkCardType();
  }

  // ---------- Envío del formulario ----------
  function readForm() {
    const f = form.elements;
    return {
      customer: {
        name: `${f.nombre.value.trim()} ${f.apellido.value.trim()}`.trim(),
        email: f.email.value.trim(),
        phone: f.telefono.value.trim(),
        dni: f.dni.value.trim(),
        address: [`${f.calle.value.trim()} ${f.numero.value.trim()}`.trim(), f.piso.value.trim(), f.cp.value.trim(), f.ciudad.value.trim(), f.provincia.value].filter(Boolean).join(", "),
      },
      address: { calle: f.calle.value.trim(), numero: f.numero.value.trim(), piso: f.piso.value.trim(), cp: f.cp.value.trim(), ciudad: f.ciudad.value.trim(), provincia: f.provincia.value },
    };
  }

  // Guarda teléfono y dirección en el perfil para la próxima compra
  function saveProfile({ customer, address }) {
    sb.from("profiles")
      .update({ phone: customer.phone, address: { dni: customer.dni, ...address } })
      .eq("id", user.id)
      .then(() => {});
  }

  function showSuccess(order, { methodLabel, note }) {
    document.getElementById("orderNumber").textContent = "CS-" + order.number;
    document.getElementById("orderMethod").textContent = methodLabel;
    document.getElementById("orderTotal").textContent = formatPrice(order.total);
    document.getElementById("orderDetailLink").href = "/compra-detalle.html?id=" + order.id;
    const noteEl = document.getElementById("orderSuccessNote");
    noteEl.hidden = !note;
    noteEl.textContent = note || "";

    state.completed = true;
    store.clear();
    countEl.textContent = "";
    checkout.hidden = true;
    success.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Transferencia: orden desde acá + comprobante al storage privado
  async function payWithTransfer(data) {
    const items = store.getItems().map((it) => ({ product_id: it.id, qty: it.qty }));
    const { data: rows, error } = await sb.rpc("place_order", {
      p_items: items,
      p_payment_method: "transferencia",
      p_shipping_method: "domicilio",
      p_customer: data.customer,
      p_installments: 1,
      p_note: "",
    });
    if (error) throw error;
    const order = Array.isArray(rows) ? rows[0] : rows;

    const file = receiptInput.files[0];
    if (file) {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${user.id}/${order.id}.${ext}`;
      const up = await sb.storage.from("receipts").upload(path, file, { upsert: true, contentType: file.type });
      if (up.error) throw up.error;
      const ins = await sb.from("payment_receipts").insert({ order_id: order.id, user_id: user.id, file_path: path, amount: order.total });
      if (ins.error) throw ins.error;
    }

    saveProfile(data);
    document.getElementById("orderSuccessText").innerHTML = `Recibimos tu comprobante. El pedido queda <strong>pendiente</strong> hasta que verifiquemos la transferencia de <strong>${formatPrice(order.total)}</strong>.`;
    showSuccess(order, { methodLabel: "transferencia" });
  }

  // Tarjeta: token con el SDK de MP -> /api/mp/pay (orden + cobro en el servidor)
  async function payWithCard(data) {
    const dni = data.customer.dni.replace(/\D/g, "");
    let token;
    try {
      token = await mp.fields.createCardToken({
        cardholderName: inName.value.trim(),
        identificationType: "DNI",
        identificationNumber: dni,
      });
    } catch (e) {
      console.error("[mp] createCardToken", e);
      const msg = Array.isArray(e) ? e.map((x) => x.message).join(". ") : e && e.message;
      throw new Error(msg && /card|security|expir|number/i.test(msg) ? "Revisá los datos de la tarjeta." : "No pudimos validar la tarjeta. Revisá los datos e intentá de nuevo.");
    }
    if (!token || !token.id) throw new Error("No pudimos validar la tarjeta. Intentá de nuevo.");

    const { data: sess } = await sb.auth.getSession();
    if (!sess || !sess.session) throw new Error("Tu sesión venció. Volvé a ingresar.");

    const items = store.getItems();
    const pm = state.paymentMethod;
    const res = await fetch("/api/mp/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + sess.session.access_token },
      body: JSON.stringify({
        method: state.method,
        items: items.map((it) => ({ product_id: it.id, qty: it.qty })),
        customer: data.customer,
        address: data.address,
        installments: state.method === "credito" ? parseInt(cuotasSelect.value, 10) || 1 : 1,
        card: {
          token: token.id,
          payment_method_id: pm.id,
          brand: pm.name,
          last_four: token.last_four_digits || "",
        },
      }),
    });
    let out = {};
    try {
      out = await res.json();
    } catch (e) {
      out = {};
    }
    if (!res.ok) {
      const err = new Error(out.error || "No pudimos procesar el pago");
      err.rejected = res.status === 402;
      throw err;
    }

    saveProfile(data);
    const card = out.payment || {};
    const label = `${PAYMENT[state.method].label.toLowerCase()}${card.brand ? ` ${card.brand}` : ""}${card.last_four ? ` •••• ${card.last_four}` : ""}${card.installments > 1 ? ` en ${card.installments} cuotas` : ""}`;
    if (out.result === "pending") {
      document.getElementById("orderSuccessText").innerHTML = `Mercado Pago está procesando tu pago con <strong>${escapeHtml(label)}</strong> por <strong>$${formatPrice(out.order.total)}</strong>.`;
      showSuccess(out.order, { methodLabel: label, note: "El pedido queda pendiente hasta que se acredite. Te avisamos por acá y por notificación cuando esté confirmado." });
    } else {
      showSuccess(out.order, { methodLabel: label });
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    form.classList.add("is-submitted");
    if (state.method === "transferencia" && !receiptOk) {
      setReceipt(null);
      receiptError.hidden = false;
      receiptError.textContent = "Subí el comprobante para continuar.";
      return;
    }
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (PAYMENT[state.method].card && (!mpReady || !validateCard())) return;

    const data = readForm();
    payBtn.disabled = true;
    const prevLabel = payBtn.textContent;
    payBtn.textContent = "Procesando…";
    try {
      if (state.method === "transferencia") await payWithTransfer(data);
      else await payWithCard(data);
    } catch (err) {
      console.error(err);
      toast(err.message || "No pudimos procesar el pedido", "bad");
      payBtn.disabled = false;
      payBtn.textContent = prevLabel;
    }
  });

  // ---------- Estado general ----------
  function render() {
    if (state.completed) return;
    const items = store.getItems();
    const qty = store.totalQty();

    countEl.textContent =
      qty === 0 ? "" : `${qty} ${qty === 1 ? "producto" : "productos"}`;
    checkout.hidden = items.length === 0;
    empty.hidden = items.length !== 0;
    if (items.length) renderSummary();
  }

  store.onChange(render);
  // Estado inicial: crédito (activa panel y deshabilita los campos del resto)
  state.method = "";
  setMethod("credito");
  render();
});
