// Configura la autenticación del proyecto de Supabase desde el .env:
//  - Site URL y URLs de redirección permitidas (local + producción)
//  - Plantillas de correo en castellano (scripts/email-templates.js)
//  - SMTP propio con Resend (si RESEND y RESEND_FROM están cargados)
//  - Google OAuth (si GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET están cargados)
// Uso: node scripts/configure-auth.js
const { readEnv, api, projectRef } = require("./lib");
const { authTemplateConfig } = require("./email-templates");

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
    // Los enlaces de los correos vencen a los 30 minutos (lo dicen las plantillas)
    mailer_otp_exp: 1800,
  };

  // SMTP propio con Resend. Sin esto Supabase solo manda correos a los miembros
  // del equipo del proyecto y como mucho 2 por hora: los clientes no reciben
  // el "olvidé mi contraseña" ni la confirmación de cuenta.
  const smtp = Boolean(env.RESEND && env.RESEND_FROM);
  if (smtp) {
    Object.assign(body, authTemplateConfig(), {
      smtp_host: "smtp.resend.com",
      smtp_port: "465",
      smtp_user: "resend",
      smtp_pass: env.RESEND,
      smtp_admin_email: env.RESEND_FROM,
      smtp_sender_name: env.RESEND_SENDER_NAME || "ComputerSell",
      rate_limit_email_sent: 100,
      mailer_notifications_password_changed_enabled: true,
    });
  } else {
    // En el plan gratis Supabase no deja cambiar las plantillas sin SMTP propio
    console.log("[auth] RESEND / RESEND_FROM vacíos: SMTP de prueba de Supabase (solo miembros del equipo, 2 correos/hora) y plantillas en inglés.");
  }

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
  console.log("[auth] Plantillas de correo:", smtp ? "ComputerSell (castellano)" : "las de Supabase (hace falta Resend)");
  console.log("[auth] SMTP:", smtp ? `Resend (${env.RESEND_FROM})` : "Supabase (pruebas)");
  console.log("[auth] Google:", body.external_google_enabled ? "habilitado" : "deshabilitado");
  console.log("[auth] Callback para Google Cloud: https://" + ref + ".supabase.co/auth/v1/callback");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
