// Configura la autenticación del proyecto de Supabase desde el .env:
//  - Site URL y URLs de redirección permitidas (local + producción)
//  - Google OAuth (si GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET están cargados)
// Uso: node scripts/configure-auth.js
const { readEnv, api, projectRef } = require("./lib");

(async () => {
  const env = readEnv();
  const ref = projectRef(env);
  const site = (env.SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  const extra = (env.EXTRA_REDIRECT_URLS || "").split(/[,\s]+/).filter(Boolean);
  const redirects = Array.from(
    new Set([site + "/**", "http://localhost:3000/**", "http://127.0.0.1:3000/**", ...extra.map((u) => u.replace(/\/$/, "") + "/**")]),
  );

  const body = {
    site_url: site,
    uri_allow_list: redirects.join(","),
    // Sin confirmación por correo mientras se desarrolla (el SMTP gratuito de
    // Supabase permite muy pocos envíos por hora). Poner MAILER_AUTOCONFIRM=false
    // en el .env cuando quieras exigir verificación de correo.
    mailer_autoconfirm: env.MAILER_AUTOCONFIRM !== "false",
  };
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    body.external_google_enabled = true;
    body.external_google_client_id = env.GOOGLE_CLIENT_ID;
    body.external_google_secret = env.GOOGLE_CLIENT_SECRET;
    body.external_google_skip_nonce_check = true;
  } else {
    console.log("[auth] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET vacíos: Google queda deshabilitado.");
  }
  await api(env, "PATCH", `/projects/${ref}/config/auth`, body);
  console.log("[auth] Site URL:", site);
  console.log("[auth] Redirects:", redirects.join(", "));
  console.log("[auth] Google:", body.external_google_enabled ? "habilitado" : "deshabilitado");
  console.log("[auth] Callback para Google Cloud: https://" + ref + ".supabase.co/auth/v1/callback");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
