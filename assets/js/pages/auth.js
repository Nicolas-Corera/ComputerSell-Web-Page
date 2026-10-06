// Páginas de acceso (tienda/acceso.html = tienda, dash/login.html = panel).
// Cambia entre "Crear cuenta", "Iniciar sesión", "Recuperar contraseña" y
// "Nueva contraseña", valida los campos y habla con Supabase Auth
// (email + contraseña y Google). El panel solo admite correos de la allowlist.
// La página indica con <body data-auth="admin|store"> a dónde redirigir.
import { sb, getProfile, signOut, applyStoreLinks } from "../core/supabase.js";

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

const body = document.body;
const IS_ADMIN = body.dataset.auth === "admin";
const params = new URLSearchParams(location.search);
// ?next solo acepta rutas de este mismo sitio: "//host" o "/\host" el
// navegador los trata como otro dominio (open redirect).
function safeNext(value) {
  if (!value || !/^\/(?![\/\\])/.test(value)) return null;
  try {
    const u = new URL(value, location.origin);
    return u.origin === location.origin ? u.pathname + u.search + u.hash : null;
  } catch (e) {
    return null;
  }
}
const NEXT = safeNext(params.get("next"));
// Enlaces de los correos (scripts/email-templates.js): llegan con
// #panel&token_hash=…&type=… y se verifican acá con verifyOtp, así funcionan
// aunque se abran en otro navegador o dispositivo. Van en el hash para que el
// token no llegue a ningún servidor; showPanel lo saca de la barra al iniciar.
const hashParams = new URLSearchParams(location.hash.slice(1));
const LINK_TYPES = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];
const TOKEN_HASH = LINK_TYPES.includes(hashParams.get("type")) ? hashParams.get("token_hash") : null;
const LINK_TYPE = TOKEN_HASH ? hashParams.get("type") : null;
const REDIRECT = NEXT || (IS_ADMIN ? "./" : "/index.html"); // el panel queda junto a login.html
const THIS_PAGE = location.origin + location.pathname;
if (IS_ADMIN) applyStoreLinks();

// ---------- Paneles ----------
const forms = $$(".auth-form");
const switchBtns = $$(".auth-switch button");
const title = $("#authTitle"),
  subtitle = $("#authSubtitle");

const COPY = {
  registro: [body.dataset.titleRegistro, body.dataset.subRegistro],
  login: [body.dataset.titleLogin, body.dataset.subLogin],
  recuperar: ["Recuperar contraseña", "Ingresá tu correo y te enviamos un enlace para crear una contraseña nueva."],
  nueva: ["Nueva contraseña", "Elegí una contraseña nueva para tu cuenta."],
};

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
  $(".auth-switch").hidden = name === "recuperar" || name === "nueva";
  if (COPY[name]) {
    title.textContent = COPY[name][0];
    subtitle.textContent = COPY[name][1];
  }
  history.replaceState(null, "", "#" + name);
  const first = $("input:not([type=checkbox])", next);
  first && setTimeout(() => first.focus({ preventScroll: true }), 80);
}

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
  hideAlert(form);
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
    if (input.pattern && !new RegExp("^(?:" + input.pattern + ")$").test(v)) {
      return (ok = markField(input, false, input.dataset.patternMsg || "Formato inválido") && ok);
    }
    markField(input, true);
  });
  return ok;
}

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

// Mensajes de Supabase en castellano
function friendly(error) {
  const m = (error && error.message) || "";
  if (/Invalid login credentials/i.test(m)) return "El correo o la contraseña no son correctos.";
  if (/Email not confirmed/i.test(m)) return "Tenés que confirmar tu correo antes de ingresar. Revisá tu casilla.";
  if (/already registered|already been registered/i.test(m)) return "Ya existe una cuenta con ese correo. Iniciá sesión.";
  if (/rate limit|too many/i.test(m)) return "Demasiados intentos. Esperá unos minutos y volvé a probar.";
  if (/for security purposes|after \d+ seconds/i.test(m)) return "Por seguridad, esperá un minuto antes de pedir otro correo.";
  if (/session missing|session_not_found|JWT expired/i.test(m)) return "El enlace para cambiar la contraseña venció. Pedí uno nuevo.";
  if (/expired|invalid.*(token|link|otp)/i.test(m)) return "El enlace venció o ya se usó. Pedí uno nuevo.";
  if (/different from the old password/i.test(m)) return "La contraseña nueva tiene que ser distinta de la anterior.";
  if (/error sending/i.test(m)) return "No pudimos enviar el correo. Probá de nuevo en unos minutos.";
  if (/Password should be/i.test(m)) return "La contraseña no cumple los requisitos.";
  if (/provider is not enabled|Unsupported provider/i.test(m)) return "Google todavía no está configurado. Usá correo y contraseña.";
  if (/network|fetch/i.test(m)) return "No hay conexión con el servidor. Probá de nuevo.";
  return m || "Ocurrió un error. Probá de nuevo.";
}

// Con sesión válida, ¿puede entrar acá? (el panel exige rol admin)
async function finish() {
  if (IS_ADMIN) {
    const profile = await getProfile(true);
    if (!profile || profile.role !== "admin") {
      await signOut();
      return "Ese correo no está habilitado para el panel de control.";
    }
  }
  window.location.href = REDIRECT;
  return null;
}

// ¿El correo está habilitado para ser admin? (RPC: la tabla admin_allowlist no es pública)
async function isAllowedAdmin(email) {
  const { data } = await sb.rpc("is_admin_email", { p_email: email });
  return data === true;
}

// Crear cuenta
const registro = $('.auth-form[data-panel="registro"]');
registro.addEventListener("submit", async (e) => {
  e.preventDefault();
  registro.classList.add("is-submitted");
  hideAlert(registro);
  if (!validate(registro)) {
    const bad = $(".is-error input", registro);
    bad && bad.focus();
    return;
  }
  const btn = $(".auth-submit", registro);
  setLoading(btn, true);
  const email = $('input[type="email"]', registro).value.trim().toLowerCase();
  const password = $("#regPass", registro).value;
  const nombre = ($('input[name="nombre"]', registro) || {}).value || "";
  const apellido = ($('input[name="apellido"]', registro) || {}).value || "";
  const phone = ($('input[name="telefono"]', registro) || {}).value || "";
  const marketing = ($('input[name="ofertas"]', registro) || { checked: false }).checked;

  try {
    if (IS_ADMIN && !(await isAllowedAdmin(email))) {
      throw new Error("Ese correo no está habilitado para crear una cuenta de administrador.");
    }
    const first_name = IS_ADMIN ? nombre.trim().split(/\s+/)[0] : nombre.trim();
    const last_name = IS_ADMIN ? nombre.trim().split(/\s+/).slice(1).join(" ") : apellido.trim();
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { first_name, last_name, full_name: `${first_name} ${last_name}`.trim(), phone: phone.trim(), marketing },
        emailRedirectTo: THIS_PAGE + "#login",
      },
    });
    if (error) throw error;
    if (data.session) {
      const msg = await finish();
      if (msg) showAlert(registro, msg);
    } else {
      // Confirmación por correo habilitada
      showPanel("login");
      const login = $('.auth-form[data-panel="login"]');
      setTimeout(() => showAlert(login, `Te enviamos un correo a ${email} para confirmar la cuenta. Después iniciá sesión.`), 350);
    }
  } catch (err) {
    showAlert(registro, friendly(err));
  } finally {
    setLoading(btn, false);
  }
});

// Iniciar sesión
const login = $('.auth-form[data-panel="login"]');
login.addEventListener("submit", async (e) => {
  e.preventDefault();
  login.classList.add("is-submitted");
  hideAlert(login);
  if (!validate(login)) return;
  const btn = $(".auth-submit", login);
  setLoading(btn, true);
  const email = $('input[type="email"]', login).value.trim().toLowerCase();
  const password = $("input[data-pw]", login).value;
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const msg = await finish();
    if (msg) showAlert(login, msg);
  } catch (err) {
    showAlert(login, friendly(err));
  } finally {
    setLoading(btn, false);
  }
});

// Recuperar contraseña
const recuperar = $('.auth-form[data-panel="recuperar"]');
recuperar.addEventListener("submit", async (e) => {
  e.preventDefault();
  recuperar.classList.add("is-submitted");
  hideAlert(recuperar);
  if (!validate(recuperar)) return;
  const btn = $(".auth-submit", recuperar);
  setLoading(btn, true);
  const email = $('input[type="email"]', recuperar).value.trim();
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: THIS_PAGE + "#nueva" });
  setLoading(btn, false);
  if (error) return showAlert(recuperar, friendly(error));
  $(".auth-recover-form", recuperar).hidden = true;
  const ok = $(".auth-success", recuperar);
  $("strong", ok).textContent = email;
  ok.hidden = false;
});

// Nueva contraseña (después del enlace de recuperación)
const nueva = $('.auth-form[data-panel="nueva"]');
nueva.addEventListener("submit", async (e) => {
  e.preventDefault();
  nueva.classList.add("is-submitted");
  hideAlert(nueva);
  if (!validate(nueva)) return;
  const btn = $(".auth-submit", nueva);
  setLoading(btn, true);
  const { error } = await sb.auth.updateUser({ password: $("#newPass").value });
  setLoading(btn, false);
  if (error) return showAlert(nueva, friendly(error));
  const msg = await finish();
  if (msg) showAlert(nueva, msg);
});

// Google
$$(".auth-google").forEach((b) =>
  b.addEventListener("click", async () => {
    b.disabled = true;
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: THIS_PAGE + (NEXT ? "?next=" + encodeURIComponent(NEXT) : "") },
    });
    if (error) {
      b.disabled = false;
      showAlert(b.closest("form"), friendly(error));
    }
  }),
);

// ---------- Inicio ----------
const hash = location.hash.replace("#", "").split("&")[0];
const recovering = /type=recovery/.test(location.hash) || hash === "nueva" || LINK_TYPE === "recovery" || LINK_TYPE === "invite";
showPanel(recovering ? "nueva" : ["registro", "login", "recuperar"].includes(hash) ? hash : body.dataset.start || "registro", false);

// Enlace de un correo: recuperación/invitación -> se queda en "Nueva
// contraseña" con la sesión ya iniciada; confirmación o ingreso -> entra.
async function verifyLink() {
  const { error } = await sb.auth.verifyOtp({ token_hash: TOKEN_HASH, type: LINK_TYPE });
  if (error) {
    const panel = recovering ? "recuperar" : "login";
    showPanel(panel, false);
    const form = $(`.auth-form[data-panel="${panel}"]`);
    return showAlert(form, recovering ? "El enlace venció o ya se usó. Pedí uno nuevo." : "El enlace venció o ya se usó. Iniciá sesión o pedí uno nuevo.");
  }
  if (recovering) return;
  const msg = await finish();
  if (msg) {
    showPanel("login", false);
    showAlert(login, msg);
  }
}
if (TOKEN_HASH) verifyLink();

// Volviendo de Google (o ya con sesión): entra directo. Si es recuperación,
// se queda en el panel de nueva contraseña.
sb.auth.onAuthStateChange(async (event, session) => {
  if (event === "PASSWORD_RECOVERY") return showPanel("nueva", false);
  if (!session || recovering || TOKEN_HASH) return;
  if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
    const msg = await finish();
    if (msg) {
      showPanel("login", false);
      showAlert(login, msg);
    }
  }
});
