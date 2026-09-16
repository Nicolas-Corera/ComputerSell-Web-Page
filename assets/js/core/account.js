// Botón de cuenta del navbar (#accountBtn): sin sesión lleva al login; con
// sesión muestra la foto (la de Google si entró con Google) y lleva al perfil.
import { getProfile, onAuth, fullName, initials } from "./supabase.js";

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

if (btn) {
  btn.addEventListener("click", () => {
    location.href = btn.dataset.state === "in" ? "/perfil.html" : "/acceso.html#login";
  });
  getProfile().then(render);
  onAuth(async (u) => render(u ? await getProfile(true) : null));
}
