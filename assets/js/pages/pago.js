// Página de pago (checkout): datos personales, envío, medio de pago con
// tarjeta animada y resumen lateral con envío + recargo + total.
// Requiere sesión.
//
// Envío (por peso y provincia), recargo por tarjeta y recargo por cuotas se
// calculan con window.CSPricing (assets/js/core/pricing.js, tarifas en
// assets/js/config/). El backend usa el mismo código para crear la orden, así
// que lo que se ve acá es lo que se cobra. Se recalcula al cambiar provincia,
// medio de pago o cuotas.
//
// Tarjeta (crédito/débito): Mercado Pago Checkout API. El número, vencimiento
// y CVV son Secure Fields del SDK (iframes de MP: los datos nunca pasan por
// acá). Al pagar se crea un token y se manda a /api/mp/pay, que crea la orden
// (place_order valida stock y precios en la base) y cobra con la API de Orders.
// Transferencia: /api/orders/transfer crea la orden y desde acá se sube el
// comprobante para que el panel lo revise.
import { sb, requireAuth, getProfile, getSellerPrivate, loading, toCard } from "../core/supabase.js";
import { refreshCart } from "../core/catalog.js";

loading(async function () {
  const { formatPrice, escapeHtml, toast } = window.CS;
  const store = window.CartStore;
  const ENV = window.CS_ENV || {};
  const Pricing = window.CSPricing;
  // Medios de pago y su recargo (assets/js/config/payment-rates.js)
  const PAYMENT = Pricing.PAYMENT;
  // Pago con tarjeta (Mercado Pago) desactivado: solo transferencia.
  // Para reactivarlo: true acá, api/_mp -> api/mp, el SDK en pago.html (con
  // versión fija) y sumar https://sdk.mercadopago.com (script-src) y los
  // dominios de Mercado Pago (connect-src, frame-src) a la CSP de vercel.json.
  const CARD_ENABLED = false;

  const user = await requireAuth();
  if (!user) return;
  const profile = await getProfile();

  // Cuenta para la transferencia: no está en el HTML público, se pide con sesión
  const bank = (await getSellerPrivate()).bank || {};
  document.querySelectorAll("#bankData [data-bank]").forEach((dd) => {
    dd.textContent = bank[dd.dataset.bank] || "—";
  });
  if (!bank.cbu && !bank.alias) toast("No pudimos cargar los datos de la cuenta. Recargá la página o escribinos por WhatsApp.", "bad");
  const cartRows = (await refreshCart()).map(toCard); // precio/stock del carrito al día (solo esos productos)
  // Entrega, peso, envío gratis y cuotas sin interés de cada producto (panel)
  const productInfo = (id) => cartRows.find((c) => c.id === id) || {};

  // Tiempo de entrega por producto (panel): el pedido llega con el más lento
  const DELIVERY = {
    "24-48hs": { rank: 0, label: "Llega en 24/48 hs hábiles" },
    "3-5": { rank: 1, label: "Llega en 3 a 5 días hábiles" },
    "7-10": { rank: 2, label: "Llega en 7 a 10 días hábiles" },
    "a-pedido": { rank: 3, label: "A pedido: te contactamos para coordinar la entrega" },
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
    const formats = { phone: CS.formatPhone, dni: CS.formatDni };
    Object.entries(fill).forEach(([k, v]) => {
      const el = form.elements[k];
      if (el && !el.value && v) el.value = formats[el.dataset.format] ? formats[el.dataset.format](v) : v;
    });
  }
  const countEl = document.getElementById("payCount");
  const shippingHint = document.getElementById("shippingHint");

  const summaryItems = document.getElementById("summaryItems");
  const sumSubtotal = document.getElementById("sumSubtotal");
  const sumShipping = document.getElementById("sumShipping");
  const sumCardLine = document.getElementById("sumCardLine");
  const sumCard = document.getElementById("sumCard");
  const sumTotal = document.getElementById("sumTotal");
  const sumCuotas = document.getElementById("sumCuotas");
  const payBtn = document.getElementById("payBtn");

  const tabs = Array.from(document.querySelectorAll(".payTab"));
  const panels = Array.from(document.querySelectorAll(".payPanel"));
  const cuotasField = document.getElementById("cuotasField");
  const cuotasSelect = document.getElementById("cuotas");
  const provinceSelect = document.getElementById("provincia");

  const state = {
    method: "transferencia",
    completed: false,
    // Tarjeta detectada por Mercado Pago a partir del BIN
    bin: "",
    paymentMethod: null, // {id, name, payment_type_id, settings...}
    installmentPlans: [], // payer_costs de MP para el BIN y el monto actual
    installmentsAmount: 0, // monto con el que se pidieron las cuotas
    fields: { number: false, expiry: false, cvv: false }, // validez de los secure fields
    processing: false, // pago en curso: el botón queda bloqueado hasta que termine
  };

  // Ítems del carrito con lo que necesita el cálculo: peso, envío gratis y
  // cuotas sin interés salen del catálogo al día
  function pricingItems() {
    return store.getItems().map((it) => {
      const p = productInfo(it.id);
      return {
        price: it.price,
        qty: it.qty,
        weight: p.weight ?? 0,
        weightUnit: p.weightUnit || "kg",
        freeShipping: p.freeShipping ?? it.freeShipping,
        installments: p.installments ?? it.installments ?? 0,
      };
    });
  }

  const selectedInstallments = () => (state.method === "credito" ? parseInt(cuotasSelect.value, 10) || 1 : 1);

  // Tiempo de entrega del pedido: el más lento de los productos
  function deliveryInfo() {
    const items = store.getItems();
    let slowest = DELIVERY["24-48hs"];
    items.forEach((it) => {
      const d = DELIVERY[productInfo(it.id).delivery || it.delivery];
      if (d && d.rank > slowest.rank) slowest = d;
    });
    return slowest;
  }

  // ---------- Resumen ----------
  // {subtotal, shipping (null = falta provincia), cardSurcharge, base, installments, total...}
  function totals() {
    return Pricing.quote({ items: pricingItems(), province: provinceSelect.value, method: state.method, installments: selectedInstallments() });
  }

  function bump(el) {
    el.classList.remove("is-bump");
    void el.offsetWidth;
    el.classList.add("is-bump");
  }

  function renderSummary() {
    setInstallmentOptions(); // los montos de cada cuota dependen del envío
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

    // Envío: según provincia y peso (falta la provincia / gratis / monto)
    const noProvince = t.shipping === null;
    const shippingText = noProvince ? "Elegí tu provincia" : t.shipping ? formatPrice(t.shipping) : "Gratis";
    sumShipping.classList.toggle("is-none", noProvince || t.shipping === 0);
    sumShipping.textContent = shippingText;
    shippingHint.textContent = `Envío a domicilio · ${deliveryInfo().label} · ${noProvince ? "Elegí tu provincia para calcular el costo" : t.shipping ? "$" + shippingText : "Gratis"}`;

    // Recargo por tarjeta (crédito y débito)
    sumCardLine.hidden = !PAYMENT[state.method].card;
    sumCard.textContent = formatPrice(t.cardSurcharge);

    // Total final: ya incluye el recargo por cuotas, que no se muestra aparte
    sumTotal.textContent = formatPrice(t.total);
    bump(sumTotal);

    if (t.installments > 1) {
      const plan = Pricing.installmentPlan(t.base, t.installments, t.freeInstallments);
      sumCuotas.hidden = false;
      sumCuotas.textContent = `${t.installments}x $${formatPrice(plan.each)}${plan.free ? " sin interés" : ""}`;
    } else {
      sumCuotas.hidden = true;
    }

    if (!state.processing) payBtn.textContent = noProvince ? "Pagar" : `Pagar $${formatPrice(t.total)}`;
    updatePayButton();
    syncSummarySheet();
    if (state.method === "credito" && state.bin && state.installmentsAmount !== t.base) refreshInstallments();
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

  // ---------- Tabs de medio de pago ----------
  // Los campos seguros de MP conservan lo escrito al cambiar entre crédito y
  // débito (misma tarjeta, distinto recargo); solo se reinician las cuotas.
  function setMethod(method) {
    if (method === state.method) return;
    if (!CARD_ENABLED && PAYMENT[method].card) return;
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
  provinceSelect.addEventListener("change", renderSummary);

  // Bajada de cada pestaña según la configuración de recargos y las cuotas del carrito
  function renderTabs() {
    const maxCuotas = Math.max(...Pricing.installmentOptions(Pricing.freeInstallments(pricingItems())));
    tabs.forEach((tab) => {
      const pay = PAYMENT[tab.dataset.method];
      const text = pay.surcharge ? `+${Math.round(pay.surcharge * 100)}%` : "Sin recargo";
      tab.querySelector("small").textContent = tab.dataset.method === "credito" && maxCuotas > 1 ? `${text} · hasta ${maxCuotas} cuotas` : text;
    });
  }

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
        state.installmentPlans = [];
        setInstallmentOptions();
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

  // Opciones de cuotas (estilo Mercado Libre): valor de cada cuota y total,
  // con el recargo ya incluido; nunca el porcentaje. Hasta las cuotas sin
  // interés de los productos del carrito van sin recargo; el resto con el de
  // assets/js/config/installment-rates.js.
  // Si ya se conoce la tarjeta, quedan solo las cuotas que Mercado Pago admite
  // para ese BIN sin sumarle interés propio al comprador (si no, pagaría más
  // de lo que se le muestra acá).
  function setInstallmentOptions() {
    const current = parseInt(cuotasSelect.value, 10) || 1;
    const items = pricingItems();
    const base = Pricing.quote({ items, province: provinceSelect.value, method: "credito", installments: 1 }).base;
    const freeMax = Pricing.freeInstallments(items);
    const supported = state.installmentPlans.filter((p) => !p.installment_rate).map((p) => p.installments);
    const list = Pricing.installmentOptions(freeMax).filter((n) => n === 1 || !supported.length || supported.includes(n));
    cuotasSelect.innerHTML = "";
    list.forEach((n) => {
      const plan = Pricing.installmentPlan(base, n, freeMax);
      const opt = document.createElement("option");
      opt.value = String(n);
      opt.textContent =
        n === 1
          ? `1x $${formatPrice(plan.total)}`
          : plan.free
            ? `${n}x $${formatPrice(plan.each)} sin interés`
            : `${n}x $${formatPrice(plan.each)} → Total $${formatPrice(plan.total)}`;
      cuotasSelect.appendChild(opt);
    });
    cuotasSelect.value = list.includes(current) ? String(current) : "1";
    cuotasHint.textContent =
      supported.length && list.length === 1 ? "Tu tarjeta no admite cuotas para este pedido" : freeMax > 1 ? `Hasta ${freeMax} cuotas sin interés` : "";
    cuotasHint.hidden = !cuotasHint.textContent;
  }

  // Planes de la tarjeta (BIN) para el monto a financiar: filtran las cuotas que no admite
  let installmentsSeq = 0;
  async function refreshInstallments() {
    const t = totals();
    state.installmentsAmount = t.base;
    if (!mp || !state.bin || state.method !== "credito") return;
    const seq = ++installmentsSeq;
    try {
      const res = await mp.getInstallments({ amount: String(t.base), bin: state.bin, paymentTypeId: "credit_card", locale: "es-AR" });
      if (seq !== installmentsSeq) return; // llegó una consulta más nueva
      state.installmentPlans = (res && res[0] && res[0].payer_costs) || [];
    } catch (e) {
      console.error("[mp] getInstallments", e);
      if (seq === installmentsSeq) state.installmentPlans = [];
    }
    setInstallmentOptions();
    renderSummary();
  }

  function initMercadoPago() {
    if (!CARD_ENABLED) return false;
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
  const receiptPreview = document.getElementById("receiptPreview");
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

  // Abre el comprobante elegido en otra pestaña para revisarlo antes de pagar
  receiptPreview.addEventListener("click", () => {
    const file = receiptInput.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });

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
  // Mientras se procesa el pago se bloquea todo el formulario: inputs, selects,
  // pestañas, comprobante y los campos seguros de MP (no tienen disabled:
  // se tapan con CSS). Al desbloquear se respeta lo que ya estaba deshabilitado.
  let lockedEls = [];
  function setFormLocked(locked) {
    form.classList.toggle("is-processing", locked);
    if (locked) {
      lockedEls = Array.from(form.querySelectorAll("input, select, textarea, button")).filter((el) => el !== payBtn && !el.disabled);
      lockedEls.forEach((el) => (el.disabled = true));
      if (mp && mp.fields && mp.fields.blur) mp.fields.blur();
    } else {
      lockedEls.forEach((el) => (el.disabled = false));
      lockedEls = [];
    }
  }

  function updatePayButton() {
    if (state.processing) return payBtn.disabled = true;
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

  // Pago aprobado: el círculo se dibuja, después el tilde, pulso y sonido.
  // Resuelve cuando termina (~1.8 s) y recién ahí se muestra el pedido.
  const approvedEl = document.getElementById("payApproved");
  function playApproval() {
    return new Promise((resolve) => {
      checkout.hidden = true;
      approvedEl.hidden = false;
      approvedEl.classList.remove("is-play");
      void approvedEl.offsetWidth;
      approvedEl.classList.add("is-play");
      window.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(approvalSound, 1150); // junto con el pulso
      setTimeout(() => {
        approvedEl.hidden = true;
        approvedEl.classList.remove("is-play");
        resolve();
      }, 2100);
    });
  }

  // Dos notas cortas (sin archivos de audio): se genera con Web Audio
  function approvalSound() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const master = ctx.createGain();
      master.gain.value = 0.18;
      master.connect(ctx.destination);
      [[659.25, 0], [987.77, 0.13]].forEach(([freq, at]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const t0 = ctx.currentTime + at;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(1, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45);
        osc.connect(gain).connect(master);
        osc.start(t0);
        osc.stop(t0 + 0.5);
      });
      setTimeout(() => ctx.close(), 1200);
    } catch (e) {
      /* sin audio: la animación alcanza */
    }
  }

  function showSuccess(order, { methodLabel, note }) {
    document.getElementById("orderNumber").textContent = "CS-" + order.number;
    // (transferencia y pago pendiente reemplazan el texto y estos spans ya no están)
    const methodEl = document.getElementById("orderMethod");
    const totalEl = document.getElementById("orderTotal");
    if (methodEl) methodEl.textContent = methodLabel;
    if (totalEl) totalEl.textContent = formatPrice(order.total);
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

  // POST a /api/* con la sesión de Supabase -> {res, out}
  async function postApi(path, body) {
    const { data: sess } = await sb.auth.getSession();
    if (!sess || !sess.session) throw new Error("Tu sesión venció. Volvé a ingresar.");
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + sess.session.access_token },
      body: JSON.stringify(body),
    });
    let out = {};
    try {
      out = await res.json();
    } catch (e) {
      out = {};
    }
    return { res, out };
  }

  const cartItems = () => store.getItems().map((it) => ({ product_id: it.id, qty: it.qty }));

  // Transferencia: orden en el backend (calcula el envío) + comprobante al storage privado
  async function payWithTransfer(data) {
    const { res, out } = await postApi("/api/orders/transfer", { items: cartItems(), customer: data.customer, address: data.address });
    if (!res.ok || !out.order) throw new Error(out.error || "No pudimos crear el pedido");
    const order = out.order;

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
    return () => {
      document.getElementById("orderSuccessText").innerHTML = `Recibimos tu comprobante. El pedido queda <strong>pendiente</strong> hasta que verifiquemos la transferencia de <strong>${formatPrice(order.total)}</strong>.`;
      showSuccess(order, { methodLabel: "transferencia" });
    };
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

    const pm = state.paymentMethod;
    const { res, out } = await postApi("/api/mp/pay", {
      method: state.method,
      items: cartItems(),
      customer: data.customer,
      address: data.address,
      installments: selectedInstallments(),
      card: {
        token: token.id,
        payment_method_id: pm.id,
        bin: state.bin, // el backend verifica que MP no le sume interés en cuotas
        brand: pm.name,
        last_four: token.last_four_digits || "",
      },
    });
    if (!res.ok) {
      const err = new Error(out.error || "No pudimos procesar el pago");
      err.rejected = res.status === 402;
      throw err;
    }

    saveProfile(data);
    const card = out.payment || {};
    const label = `${PAYMENT[state.method].label.toLowerCase()}${card.brand ? ` ${card.brand}` : ""}${card.last_four ? ` •••• ${card.last_four}` : ""}${card.installments > 1 ? ` en ${card.installments} cuotas` : ""}`;
    if (out.result === "pending") {
      return () => {
        document.getElementById("orderSuccessText").innerHTML = `Mercado Pago está procesando tu pago con <strong>${escapeHtml(label)}</strong> por <strong>$${formatPrice(out.order.total)}</strong>.`;
        showSuccess(out.order, { methodLabel: label, note: "El pedido queda pendiente hasta que se acredite. Te avisamos por acá y por notificación cuando esté confirmado." });
      };
    }
    return async () => {
      await playApproval();
      showSuccess(out.order, { methodLabel: label });
    };
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
    // El botón queda bloqueado (mínimo 3 s) hasta que el pago termine, y
    // recién después se muestra la confirmación
    state.processing = true;
    const prevLabel = payBtn.textContent;
    payBtn.textContent = "Procesando pago…";
    updatePayButton();
    setFormLocked(true);
    const minWait = new Promise((r) => setTimeout(r, 3000));
    try {
      const [finish] = await Promise.all([state.method === "transferencia" ? payWithTransfer(data) : payWithCard(data), minWait]);
      await finish();
    } catch (err) {
      console.error(err);
      await minWait;
      toast(err.message || "No pudimos procesar el pedido", "bad");
      state.processing = false;
      setFormLocked(false);
      payBtn.textContent = prevLabel;
      updatePayButton();
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
    if (items.length) {
      renderTabs();
      renderSummary();
    }
  }

  store.onChange(render);
  // Estado inicial: transferencia (activa panel y deshabilita los campos del resto)
  state.method = "";
  setMethod(CARD_ENABLED ? "credito" : "transferencia");
  render();
});
