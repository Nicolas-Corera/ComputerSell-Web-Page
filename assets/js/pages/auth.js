// Páginas de acceso (admin-login.html y acceso.html).
// Cambia entre "Crear cuenta", "Iniciar sesión" y "Recuperar contraseña",
// valida los campos y simula el envío (no hay backend todavía).
// La página indica con <body data-auth="admin|store"> a dónde redirigir.
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const body = document.body;
  const REDIRECT = body.dataset.auth === "admin" ? "/dashboard.html" : "/index.html";

  // Cuentas de demo aceptadas en "Iniciar sesión"
  const DEMO = {
    admin: [{ email: "nicolas.corera@gmail.com", pass: "admin1234", name: "Nicolás Corera" }],
    store: [{ email: "cliente@computersell.com.ar", pass: "cliente1234", name: "Cliente Demo" }],
  }[body.dataset.auth];

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {}
    },
  };

  // ---------- Paneles ----------
  const forms = $$(".auth-form");
  const switchBtns = $$(".auth-switch button");
  const title = $("#authTitle"), subtitle = $("#authSubtitle");

  const COPY = {
    registro: [body.dataset.titleRegistro, body.dataset.subRegistro],
    login: [body.dataset.titleLogin, body.dataset.subLogin],
    recuperar: ["Recuperar contraseña", "Ingresá tu correo y te enviamos un enlace para crear una contraseña nueva."],
  };

  // Orden de los paneles en el DOM: define hacia qué lado se desliza
  const ORDER = forms.map((f) => f.dataset.panel);
  let current = null;

  function showPanel(name, animate) {
    if (name === current) return;
    const next = forms.find((f) => f.dataset.panel === name);
    const prev = forms.find((f) => f.dataset.panel === current);
    const goingBack = prev && ORDER.indexOf(name) < ORDER.indexOf(current);
    current = name;

    forms.forEach((f) => f.classList.remove("is-leaving", "to-right", "from-left"));
    if (prev && animate !== false) {
      prev.classList.remove("is-active");
      prev.classList.add("is-leaving");
      if (goingBack) prev.classList.add("to-right");
      // Se limpia al terminar la animación; si no llega el evento (pestaña en
      // segundo plano, animaciones desactivadas) lo hace el timeout.
      let done = false;
      const finishLeave = () => {
        if (done) return;
        done = true;
        prev.classList.remove("is-leaving", "to-right");
        resetForm(prev);
      };
      prev.addEventListener("animationend", finishLeave, { once: true });
      setTimeout(finishLeave, 300);
    } else if (prev) {
      prev.classList.remove("is-active");
      resetForm(prev);
    }
    if (goingBack) next.classList.add("from-left");
    next.classList.add("is-active");

    switchBtns.forEach((b) => b.classList.toggle("is-active", b.dataset.panel === name));
    $(".auth-switch").hidden = name === "recuperar";
    if (COPY[name]) {
      title.textContent = COPY[name][0];
      subtitle.textContent = COPY[name][1];
    }
    history.replaceState(null, "", "#" + name);
    const first = $("input:not([type=checkbox])", next);
    first && setTimeout(() => first.focus({ preventScroll: true }), 80);
  }

  // Al salir de un panel se borra todo lo completado: valores, errores,
  // requisitos de contraseña, ojo de la contraseña y mensajes.
  function resetForm(form) {
    form.reset();
    form.classList.remove("is-submitted");
    $$(".is-error", form).forEach((el) => el.classList.remove("is-error"));
    $$(".pwRules li", form).forEach((li) => li.classList.remove("is-ok"));
    $$("input[data-pw]", form).forEach((input) => {
      input.type = "password";
      const btn = input.parentElement.querySelector(".pwToggle");
      if (btn) {
        $("use", btn).setAttribute("href", "#ic-visibility");
        btn.setAttribute("aria-label", "Mostrar contraseña");
      }
    });
    const alert = $(".auth-alert", form);
    alert && alert.classList.remove("is-visible");
    const recover = $(".auth-recover-form", form);
    if (recover) {
      recover.hidden = false;
      $(".auth-success", form).hidden = true;
    }
    $$(".auth-submit", form).forEach((b) => {
      b.classList.remove("is-loading");
      b.disabled = false;
    });
  }

  $$("[data-go]").forEach((b) => b.addEventListener("click", () => showPanel(b.dataset.go)));

  // ---------- Mostrar / ocultar contraseña ----------
  $$(".pwToggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = btn.parentElement.querySelector("input");
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      $("use", btn).setAttribute("href", show ? "#ic-visibility_off" : "#ic-visibility");
      btn.setAttribute("aria-label", show ? "Ocultar contraseña" : "Mostrar contraseña");
    });
  });

  // ---------- Requisitos de la contraseña ----------
  const RULES = {
    length: (v) => v.length >= 8,
    case: (v) => /[A-Z]/.test(v) && /[a-z]/.test(v),
    number: (v) => /\d/.test(v),
    symbol: (v) => /[^A-Za-z0-9]/.test(v),
  };

  function checkRules(input) {
    const list = $("#" + input.dataset.rules);
    let all = true;
    Object.keys(RULES).forEach((k) => {
      const ok = RULES[k](input.value);
      const li = $(`[data-rule="${k}"]`, list);
      li && li.classList.toggle("is-ok", ok);
      all = all && ok;
    });
    list.classList.toggle("is-error", !all);
    return all;
  }

  $$("[data-rules]").forEach((input) => {
    input.addEventListener("input", () => checkRules(input));
    checkRules(input);
  });

  // ---------- Validación ----------
  const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

  function markField(input, ok, message) {
    const field = input.closest(".field") || input.closest(".checkOption");
    if (!field) return ok;
    field.classList.toggle("is-error", !ok);
    const err = $(".field-error", field);
    if (err && message && !ok) err.textContent = message;
    return ok;
  }

  function validate(form) {
    let ok = true;
    $$("input", form).forEach((input) => {
      if (input.type === "checkbox") {
        if (input.required) ok = markField(input, input.checked) && ok;
        return;
      }
      const v = input.value.trim();
      if (input.required && !v) {
        ok = markField(input, false, "Este campo es obligatorio") && ok;
        return;
      }
      if (!v) return markField(input, true);
      if (input.type === "email") return (ok = markField(input, emailOk(v), "Ingresá un correo válido") && ok);
      if (input.dataset.rules) return (ok = markField(input, checkRules(input), "La contraseña no cumple los requisitos") && ok);
      if (input.dataset.confirm) {
        return (ok = markField(input, v === $("#" + input.dataset.confirm).value, "Las contraseñas no coinciden") && ok);
      }
      if (input.dataset.invite) {
        return (ok = markField(input, v.toUpperCase() === input.dataset.invite, "Código de invitación incorrecto") && ok);
      }
      if (input.pattern && !new RegExp("^(?:" + input.pattern + ")$").test(v)) {
        return (ok = markField(input, false, input.dataset.patternMsg || "Formato inválido") && ok);
      }
      markField(input, true);
    });
    return ok;
  }

  // Limpia el error del campo al corregirlo
  document.addEventListener("input", (e) => {
    const field = e.target.closest(".field.is-error, .checkOption.is-error");
    field && field.classList.remove("is-error");
  });

  // ---------- Envío ----------
  function setLoading(btn, v) {
    btn.classList.toggle("is-loading", v);
    btn.disabled = v;
  }

  function showAlert(form, text) {
    const alert = $(".auth-alert", form);
    if (!alert) return;
    $("span", alert).textContent = text;
    alert.classList.add("is-visible");
  }

  function hideAlert(form) {
    const alert = $(".auth-alert", form);
    alert && alert.classList.remove("is-visible");
  }

  function finish(name) {
    store.set("cs_session", { name, email: $(".auth-form.is-active input[type=email]").value.trim(), role: body.dataset.auth, at: Date.now() });
    window.location.href = REDIRECT;
  }

  // Crear cuenta
  const registro = $('.auth-form[data-panel="registro"]');
  registro.addEventListener("submit", (e) => {
    e.preventDefault();
    registro.classList.add("is-submitted");
    if (!validate(registro)) {
      const bad = $(".is-error input", registro);
      bad && bad.focus();
      return;
    }
    const btn = $(".auth-submit", registro);
    setLoading(btn, true);
    setTimeout(() => {
      setLoading(btn, false);
      const nameInput = $('input[name="nombre"]', registro);
      const name = nameInput ? nameInput.value.trim() : "";
      const apellido = $('input[name="apellido"]', registro);
      finish(apellido ? `${name} ${apellido.value.trim()}`.trim() : name);
    }, 900);
  });

  // Iniciar sesión
  const login = $('.auth-form[data-panel="login"]');
  login.addEventListener("submit", (e) => {
    e.preventDefault();
    login.classList.add("is-submitted");
    hideAlert(login);
    if (!validate(login)) return;
    const btn = $(".auth-submit", login);
    setLoading(btn, true);
    const email = $('input[type="email"]', login).value.trim().toLowerCase();
    const pass = $('input[type="password"], input[data-pw]', login).value;
    setTimeout(() => {
      setLoading(btn, false);
      const user = DEMO.find((u) => u.email === email && u.pass === pass);
      if (!user) return showAlert(login, "El correo o la contraseña no son correctos.");
      finish(user.name);
    }, 900);
  });

  // Recuperar contraseña
  const recuperar = $('.auth-form[data-panel="recuperar"]');
  recuperar.addEventListener("submit", (e) => {
    e.preventDefault();
    recuperar.classList.add("is-submitted");
    if (!validate(recuperar)) return;
    const btn = $(".auth-submit", recuperar);
    setLoading(btn, true);
    setTimeout(() => {
      setLoading(btn, false);
      $(".auth-recover-form", recuperar).hidden = true;
      const ok = $(".auth-success", recuperar);
      $("strong", ok).textContent = $('input[type="email"]', recuperar).value.trim();
      ok.hidden = false;
    }, 900);
  });

  // Proveedores externos (demo)
  $$(".auth-google").forEach((b) =>
    b.addEventListener("click", () => {
      const prov = b.dataset.provider;
      b.disabled = true;
      setTimeout(() => finish(`Usuario ${prov}`), 700);
    }),
  );

  // Formato de teléfono (solo en tienda): "11 2345-6789"
  const phone = $('input[name="telefono"]');
  if (phone) {
    phone.addEventListener("input", () => {
      const d = phone.value.replace(/\D/g, "").slice(0, 10);
      let out = d.slice(0, 2);
      if (d.length > 2) out += " " + d.slice(2, 6);
      if (d.length > 6) out += "-" + d.slice(6);
      phone.value = out;
    });
  }

  // ---------- Inicio ----------
  const hash = location.hash.replace("#", "");
  showPanel(["registro", "login", "recuperar"].includes(hash) ? hash : body.dataset.start || "registro", false);
})();
