// Página de pago (checkout): datos personales, envío, medio de pago con
// tarjeta animada y resumen lateral con envío + recargo + total.
// Requiere sesión. La orden se crea con la RPC place_order (valida stock y
// precios en la base y los descuenta). El pago con tarjeta es una simulación
// (Mercado Pago llega después); con transferencia se sube el comprobante.
import { sb, requireAuth, getProfile } from "../core/supabase.js";
import { createCatalog } from "../core/catalog.js";

(async function () {
  const { formatPrice, escapeHtml, toast } = window.CS;
  const store = window.CartStore;

  const user = await requireAuth();
  if (!user) return;
  const profile = await getProfile();
  createCatalog(); // precio/stock del carrito al día

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

    // Cuotas (solo crédito): valor informativo por cuota
    const n = state.method === "credito" ? parseInt(cuotasSelect.value, 10) : 1;
    if (n > 1) {
      sumCuotas.hidden = false;
      sumCuotas.textContent = `${n} cuotas de $${formatPrice(Math.round(t.total / n))}`;
    } else {
      sumCuotas.hidden = true;
    }

    payBtn.textContent = `Pagar $${formatPrice(t.total)}`;
    updatePayButton();
    syncSummarySheet();
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
  // Limpia los campos y la tarjeta al cambiar de medio de pago
  function resetCardFields() {
    [inNumber, inName, inExpiry, inCvv].forEach((input) => {
      input.value = "";
      input.setCustomValidity("");
    });
    cuotasSelect.value = "1";
    preview.classList.remove("is-flipped", "is-shine");
    delete preview.dataset.focus;
    renderNumber();
    renderName();
    renderExpiry();
    renderCvv();
  }

  function setMethod(method) {
    if (method === state.method) return;
    state.method = method;
    const isCard = PAYMENT[method].card;
    resetCardFields();

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
    renderSummary();
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => setMethod(tab.dataset.method));
  });
  cuotasSelect.addEventListener("change", renderSummary);

  // ---------- Tarjeta animada ----------
  const preview = document.getElementById("cardPreview");
  const brandEl = document.getElementById("cardBrand");
  const numberEl = document.getElementById("cardNumberPreview");
  const nameEl = document.getElementById("cardNamePreview");
  const expiryEl = document.getElementById("cardExpiryPreview");
  const cvvEl = document.getElementById("cardCvvPreview");

  const inNumber = document.getElementById("cardNumber");
  const inName = document.getElementById("cardName");
  const inExpiry = document.getElementById("cardExpiry");
  const inCvv = document.getElementById("cardCvv");

  const BRANDS = [
    { key: "visa", test: /^4/ },
    { key: "mastercard", test: /^(5[1-5]|2[2-7])/ },
    { key: "amex", test: /^3[47]/ },
  ];

  function detectBrand(digits) {
    const found = BRANDS.find((b) => b.test.test(digits));
    return found ? found.key : "";
  }

  function digitsOnly(value) {
    return value.replace(/\D/g, "");
  }

  // Amex: 15 dígitos en grupos 4-6-5; resto: 16 en grupos de 4
  function groupNumber(digits, brand) {
    if (brand === "amex") {
      return [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15)].filter(Boolean);
    }
    return digits.match(/.{1,4}/g) || [];
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

  function renderNumber() {
    const brand = detectBrand(digitsOnly(inNumber.value));
    const max = brand === "amex" ? 15 : 16;
    const digits = digitsOnly(inNumber.value).slice(0, max);
    const groups = groupNumber(digits, brand);

    inNumber.value = groups.join(" ");
    inCvv.maxLength = brand === "amex" ? 4 : 3;

    brandEl.className = "cardPreview-brand" + (brand ? ` is-visible brand-${brand}` : "");
    document.getElementById("cardBackBrand").textContent = brand ? brand.toUpperCase() : "";

    // Preview: dígitos escritos + placeholders "#" hasta completar
    const template = brand === "amex" ? [4, 6, 5] : [4, 4, 4, 4];
    const prev = numberEl.dataset.value || "";
    numberEl.innerHTML = "";
    let idx = 0;
    template.forEach((len, g) => {
      const group = document.createElement("span");
      group.className = "cardPreview-group";
      for (let i = 0; i < len; i++) {
        const span = document.createElement("span");
        const ch = digits[idx];
        span.textContent = ch || "#";
        if (!ch) span.classList.add("is-placeholder");
        else if (prev[idx] !== ch) span.classList.add("is-new");
        group.appendChild(span);
        idx++;
      }
      numberEl.appendChild(group);
    });
    numberEl.dataset.value = digits;

    if (digits.length === 1 && !prev) preview.classList.add("is-shine");
    if (!digits.length) preview.classList.remove("is-shine");
  }

  function renderName() {
    const caret = inName.selectionStart;
    const clean = inName.value.replace(/[^a-zA-ZÀ-ÿ\s'.-]/g, "").slice(0, 26);
    inName.value = titleCase(clean);
    if (caret !== null) inName.setSelectionRange(caret, caret);
    setAnimatedText(nameEl, inName.value.trim().toUpperCase(), "NOMBRE APELLIDO");
  }

  function renderExpiry() {
    let d = digitsOnly(inExpiry.value).slice(0, 4);
    // Mes válido: 01-12
    if (d.length >= 1 && d[0] > "1") d = "0" + d;
    if (d.length >= 2 && parseInt(d.slice(0, 2), 10) > 12) d = "12" + d.slice(2);
    inExpiry.value = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
    setAnimatedText(expiryEl, inExpiry.value, "MM/AA");
  }

  function renderCvv() {
    inCvv.value = digitsOnly(inCvv.value).slice(0, inCvv.maxLength);
    setAnimatedText(cvvEl, inCvv.value, "•••");
  }

  inNumber.addEventListener("input", renderNumber);
  inName.addEventListener("input", renderName);
  inExpiry.addEventListener("input", renderExpiry);
  inCvv.addEventListener("input", renderCvv);

  // Resalta en la tarjeta el campo activo; el CVV da vuelta la tarjeta
  [
    [inNumber, "number"],
    [inName, "name"],
    [inExpiry, "expiry"],
    [inCvv, "cvv"],
  ].forEach(([input, key]) => {
    input.addEventListener("focus", () => {
      preview.dataset.focus = key;
      preview.classList.toggle("is-flipped", key === "cvv");
    });
    input.addEventListener("blur", () => {
      delete preview.dataset.focus;
      preview.classList.remove("is-flipped");
    });
  });

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

  // Con transferencia, "Pagar" queda deshabilitado hasta subir el comprobante
  function updatePayButton() {
    payBtn.disabled = state.method === "transferencia" && !receiptOk;
  }

  // ---------- Validación de tarjeta ----------
  function luhnValid(digits) {
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = parseInt(digits[i], 10);
      if (alt) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  function validateCard() {
    const digits = digitsOnly(inNumber.value);
    const brand = detectBrand(digits);
    const len = brand === "amex" ? 15 : 16;
    inNumber.setCustomValidity(
      digits.length === len && luhnValid(digits) ? "" : "Ingresá un número de tarjeta válido",
    );

    const m = inExpiry.value.match(/^(\d{2})\/(\d{2})$/);
    let expiryOk = false;
    if (m) {
      const month = parseInt(m[1], 10);
      const year = 2000 + parseInt(m[2], 10);
      const now = new Date();
      expiryOk =
        month >= 1 &&
        month <= 12 &&
        (year > now.getFullYear() ||
          (year === now.getFullYear() && month >= now.getMonth() + 1));
    }
    inExpiry.setCustomValidity(expiryOk ? "" : "Ingresá un vencimiento válido (MM/AA)");

    inCvv.setCustomValidity(
      inCvv.value.length === inCvv.maxLength ? "" : "Ingresá el código de seguridad",
    );
  }

  [inNumber, inExpiry, inCvv].forEach((input) => {
    input.addEventListener("input", () => input.setCustomValidity(""));
  });

  // ---------- Envío del formulario ----------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    form.classList.add("is-submitted");
    if (PAYMENT[state.method].card) validateCard();
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

    const items = store.getItems().map((it) => ({ product_id: it.id, qty: it.qty }));
    const f = form.elements;
    const customer = {
      name: `${f.nombre.value.trim()} ${f.apellido.value.trim()}`.trim(),
      email: f.email.value.trim(),
      phone: f.telefono.value.trim(),
      dni: f.dni.value.trim(),
      address: [`${f.calle.value.trim()} ${f.numero.value.trim()}`.trim(), f.piso.value.trim(), f.cp.value.trim(), f.ciudad.value.trim(), f.provincia.value].filter(Boolean).join(", "),
    };
    const installments = state.method === "credito" ? parseInt(cuotasSelect.value, 10) || 1 : 1;

    payBtn.disabled = true;
    const prevLabel = payBtn.textContent;
    payBtn.textContent = "Procesando…";
    try {
      const { data, error } = await sb.rpc("place_order", {
        p_items: items,
        p_payment_method: state.method,
        p_shipping_method: "domicilio",
        p_customer: customer,
        p_installments: installments,
        p_note: "",
      });
      if (error) throw error;
      const order = Array.isArray(data) ? data[0] : data;

      // Transferencia: comprobante al storage privado + registro para revisar en el panel
      if (state.method === "transferencia" && receiptInput.files[0]) {
        const file = receiptInput.files[0];
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${user.id}/${order.id}.${ext}`;
        const up = await sb.storage.from("receipts").upload(path, file, { upsert: true, contentType: file.type });
        if (up.error) throw up.error;
        const ins = await sb.from("payment_receipts").insert({ order_id: order.id, user_id: user.id, file_path: path, amount: order.total });
        if (ins.error) throw ins.error;
      }

      // Guarda la dirección en el perfil para la próxima compra
      sb.from("profiles")
        .update({ phone: customer.phone, address: { dni: customer.dni, calle: f.calle.value.trim(), numero: f.numero.value.trim(), piso: f.piso.value.trim(), cp: f.cp.value.trim(), ciudad: f.ciudad.value.trim(), provincia: f.provincia.value } })
        .eq("id", user.id)
        .then(() => {});

      document.getElementById("orderNumber").textContent = "CS-" + order.number;
      document.getElementById("orderMethod").textContent = PAYMENT[state.method].label.toLowerCase();
      document.getElementById("orderTotal").textContent = formatPrice(order.total);
      document.getElementById("orderDetailLink").href = "/compra-detalle.html?id=" + order.id;
      if (state.method === "transferencia") {
        document.getElementById("orderSuccessText").innerHTML = `Recibimos tu comprobante. El pedido queda <strong>pendiente</strong> hasta que verifiquemos la transferencia de <strong>${formatPrice(order.total)}</strong>.`;
      }

      state.completed = true;
      store.clear();
      countEl.textContent = "";
      checkout.hidden = true;
      success.hidden = false;
      window.scrollTo({ top: 0, behavior: "smooth" });
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
})();
