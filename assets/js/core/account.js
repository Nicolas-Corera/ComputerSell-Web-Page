// Botón de cuenta del navbar (#accountBtn): sin sesión lleva al login; con
// sesión muestra la foto (la de Google si entró con Google) y lleva al perfil.
// Arriba de la foto va la burbuja con los avisos sin leer (notifications.js):
// con avisos nuevos el botón lleva directo a Mi perfil > Avisos.
import { sb, getProfile, getUser, onAuth, fullName, initials, loading } from "./supabase.js";
import { startNotifications } from "./notifications.js";

const btn = document.getElementById("accountBtn");

// Ícono/foto + burbuja dentro de un mismo contenedor (la burbuja va pegada a la foto)
const wrap = document.createElement("span");
wrap.className = "cartIconWrap accountIconWrap";
if (btn) {
  const icon = btn.querySelector("svg");
  if (icon) wrap.appendChild(icon);
  const badge = document.createElement("span");
  badge.className = "favBadge accountBadge";
  badge.id = "accountBadge";
  badge.addEventListener("animationend", () => badge.classList.remove("is-bump"));
  wrap.appendChild(badge);
  btn.prepend(wrap);
}

function render(profile) {
  if (!btn) return;
  const label = btn.querySelector(".actLabel");
  const old = wrap.querySelector(".accountAvatar, .accountInitials, svg");
  if (!profile) {
    btn.dataset.state = "out";
    if (old && !old.matches("svg")) old.replaceWith(iconEl());
    if (label) label.textContent = "ACCEDER";
    return;
  }
  btn.dataset.state = "in";
  const name = fullName(profile);
  let el;
  if (profile.avatar_url) {
    el = document.createElement("img");
    el.className = "accountAvatar";
    el.src = profile.avatar_url;
    el.alt = name;
    el.referrerPolicy = "no-referrer";
  } else {
    el = document.createElement("span");
    el.className = "accountInitials";
    el.textContent = initials(name);
  }
  if (old) old.replaceWith(el);
  else wrap.prepend(el);
  if (label) label.textContent = (profile.first_name || "MI CUENTA").toUpperCase();
}

function iconEl() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ic-md");
  svg.innerHTML = '<use href="#ic-person" />';
  return svg;
}

// Cuenta con sesión pero sin contraseña (confirmó el correo y cerró antes de
// elegirla, migración 0025): se la manda a elegirla. Una consulta por sesión.
async function checkPassword(profile) {
  if (!profile) return;
  const key = "cs_pw_ok_" + profile.id;
  try {
    if (sessionStorage.getItem(key)) return;
  } catch (e) {}
  const { data } = await sb.rpc("account_security");
  if (data && data.provider === "email" && !data.has_password) {
    location.href = "/acceso.html?next=" + encodeURIComponent(location.pathname + location.search) + "#login";
    return;
  }
  try {
    sessionStorage.setItem(key, "1");
  } catch (e) {}
}

if (btn) {
  btn.addEventListener("click", () => {
    if (btn.dataset.state !== "in") return (location.href = "/acceso.html#login");
    location.href = btn.dataset.unread ? "/perfil.html#avisos" : "/perfil.html";
  });
  loading(
    getProfile().then((p) => {
      render(p);
      checkPassword(p);
    }),
  );
  getUser().then(startNotifications);
  // El perfil cambió el nombre o la foto (perfil.js): se ve sin recargar
  window.addEventListener("cs:profile", (e) => render(e.detail));
  onAuth(async (u) => {
    render(u ? await getProfile(true) : null);
    startNotifications(u);
  });
}
