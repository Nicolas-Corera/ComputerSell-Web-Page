const STORAGE_KEY = "cs_profile_data";
const AVATAR_KEY = "cs_profile_avatar";

const defaults = {
  nombre: "Juan",
  apellido: "Pérez",
  email: "juan.perez@email.com",
  telefono: "+54 9 11 0000-0000",
  calle: "",
  piso: "",
  cp: "",
  ciudad: "",
  provincia: "",
  pais: "Argentina",
};

const fieldIds = Object.keys(defaults);
const form = document.getElementById("profileForm");
const avatarPhoto = document.getElementById("avatarPhoto");
const avatarName = document.getElementById("avatarName");
const avatarEmail = document.getElementById("avatarEmail");
const saveToast = document.getElementById("saveToast");

function loadProfile() {
  let data = { ...defaults };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) data = { ...data, ...saved };
  } catch (e) {}

  fieldIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = data[id] ?? "";
  });

  updateAvatarHeader(data);

  try {
    const avatarData = localStorage.getItem(AVATAR_KEY);
    if (avatarData) setAvatarImage(avatarData);
  } catch (e) {}
}

function updateAvatarHeader(data) {
  const fullName = `${data.nombre || ""} ${data.apellido || ""}`.trim();
  avatarName.textContent = fullName || "Nombre Apellido";
  avatarEmail.textContent = data.email || "tu@email.com";
}

function currentFormData() {
  const data = {};
  fieldIds.forEach((id) => {
    const el = document.getElementById(id);
    data[id] = el ? el.value.trim() : "";
  });
  return data;
}

function setAvatarImage(src) {
  avatarPhoto.innerHTML = `<img src="${src}" alt="Foto de perfil" />`;
}

function clearAvatarImage() {
  avatarPhoto.innerHTML = '<svg class="ic-lg"><use href="#ic-person" /></svg>';
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const data = currentFormData();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {}
  updateAvatarHeader(data);
  saveToast.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    saveToast.classList.remove("show");
  }, 2200);
});

document.getElementById("cancelBtn").addEventListener("click", () => {
  setTimeout(loadProfile, 0);
});

const avatarInput = document.getElementById("avatarInput");
document
  .getElementById("avatarEditBtn")
  .addEventListener("click", () => avatarInput.click());

avatarInput.addEventListener("change", () => {
  const file = avatarInput.files && avatarInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    setAvatarImage(reader.result);
    try {
      localStorage.setItem(AVATAR_KEY, reader.result);
    } catch (e) {}
  };
  reader.readAsDataURL(file);
});

document.getElementById("avatarRemoveBtn").addEventListener("click", () => {
  clearAvatarImage();
  try {
    localStorage.removeItem(AVATAR_KEY);
  } catch (e) {}
  avatarInput.value = "";
});

// Tabs
const tabButtons = document.querySelectorAll(".tab-btn[data-tab]");
tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.remove("is-active"));
    document
      .querySelectorAll(".tab-panel")
      .forEach((p) => p.classList.remove("is-active"));
    btn.classList.add("is-active");
    document
      .getElementById(`panel-${btn.dataset.tab}`)
      .classList.add("is-active");
  });
});

document.getElementById("footerYear").textContent = new Date().getFullYear();

loadProfile();
