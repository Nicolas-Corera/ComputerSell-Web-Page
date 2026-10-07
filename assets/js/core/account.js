// Botón de cuenta del navbar (#accountBtn): sin sesión lleva al login; con
// sesión muestra la foto (la de Google si entró con Google) y lleva al perfil.
import { sb, getProfile, onAuth, fullName, initials, loading } from "./supabase.js";

const btn = document.getElementById("accountBtn");

function render(profile) {
  if (!btn) return;
  const label = btn.querySelector(".actLabel");
  const old = btn.querySelector(".accountAvatar, .accountInitials, svg");
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
  else btn.prepend(el);
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
    location.href = btn.dataset.state === "in" ? "/perfil.html" : "/acceso.html#login";
  });
  loading(
    getProfile().then((p) => {
      render(p);
      checkPassword(p);
    }),
  );
  onAuth(async (u) => render(u ? await getProfile(true) : null));
}
