// Plantillas de los correos de Supabase Auth (asunto + HTML), en castellano y
// con la marca de ComputerSell. Las sube `npm run auth:configure`.
//
// Los enlaces NO usan {{ .ConfirmationURL }}: llevan el token_hash a la página
// de acceso (tienda/acceso.html o dash/login.html, según {{ .RedirectTo }}) y
// auth.js lo verifica con verifyOtp. Así el enlace funciona aunque se abra en
// otro dispositivo o navegador (con PKCE el code_verifier queda en el que pidió
// el correo) y los antivirus de correo que "visitan" los links no lo consumen.
// auth.js siempre pide el redirect con un panel en el hash (#nueva, #login), así
// que el token se suma con "&"; si Supabase cae en la Site URL (redirect no
// permitido o flujo iniciado desde el dashboard) se usa /acceso#login.
//
// Variables de Supabase: https://supabase.com/docs/guides/auth/auth-email-templates

const BLUE = "#3b82f6";
const DARK = "#0d0f12";
const INK = "#1a1d21";
const SOFT = "#5b6068";
const FONT = "Montserrat, 'Segoe UI', Helvetica, Arial, sans-serif";

// Enlace a la página de acceso con el token para verifyOtp.
// El token va dentro de cada rama del if: después del {{ end }} el motor de
// plantillas de Supabase (Go html/template) no sabe si está antes o después
// del "#" y falla con "{{.TokenHash}} appears in an ambiguous context within
// a URL" (no se manda el correo y el alta responde 500).
const link = (type) => {
  const token = `&token_hash={{ .TokenHash }}&type=${type}`;
  return `{{ if eq .RedirectTo .SiteURL }}{{ .SiteURL }}/acceso#login${token}{{ else }}{{ .RedirectTo }}${token}{{ end }}`;
};

function layout({ preheader, title, intro, button, note }) {
  const cta = button
    ? `<tr><td style="padding:8px 0 24px">
          <a href="${button.href}" style="display:inline-block;background:${BLUE};color:#ffffff;font-family:${FONT};font-size:15px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:10px">${button.label}</a>
        </td></tr>
        <tr><td style="font-family:${FONT};font-size:12px;line-height:18px;color:${SOFT};padding-bottom:24px">
          Si el botón no funciona, copiá y pegá este enlace en tu navegador:<br />
          <a href="${button.href}" style="color:${BLUE};word-break:break-all">${button.href}</a>
        </td></tr>`
    : "";
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light" />
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f2f4f6">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f6">
  <tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden">
      <tr><td style="background:${DARK};padding:22px 32px;font-family:Inter, ${FONT};font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.2px">
        Computer<span style="color:${BLUE}">Sell</span>
      </td></tr>
      <tr><td style="padding:32px 32px 8px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="font-family:Inter, ${FONT};font-size:22px;line-height:30px;font-weight:700;color:${INK};padding-bottom:12px">${title}</td></tr>
          <tr><td style="font-family:${FONT};font-size:15px;line-height:24px;color:${INK};padding-bottom:24px">${intro}</td></tr>
          ${cta}
          <tr><td style="font-family:${FONT};font-size:13px;line-height:20px;color:${SOFT};border-top:1px solid #e6e8eb;padding:20px 0 28px">${note}</td></tr>
        </table>
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
      <tr><td align="center" style="font-family:${FONT};font-size:12px;line-height:18px;color:${SOFT};padding:20px 16px">
        ComputerSell · <a href="{{ .SiteURL }}" style="color:${SOFT}">{{ .SiteURL }}</a><br />
        Este es un correo automático, no hace falta responderlo.
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

const IGNORE = "Si no fuiste vos, ignorá este correo: tu cuenta sigue igual.";
const SECURITY_NOTE = `Si fuiste vos, no tenés que hacer nada. Si no, entrá a <a href="{{ .SiteURL }}/acceso#recuperar" style="color:${BLUE}">{{ .SiteURL }}/acceso</a>, pedí una contraseña nueva y escribinos.`;

// Clave = sufijo de mailer_subjects_* / mailer_templates_*_content en la Management API
const TEMPLATES = {
  confirmation: {
    subject: "Confirmá tu correo en ComputerSell",
    content: layout({
      preheader: "Confirmá tu correo para activar tu cuenta.",
      title: "Confirmá tu correo",
      intro: "¡Gracias por crear tu cuenta en ComputerSell! Tocá el botón para confirmar <strong>{{ .Email }}</strong> y empezar a comprar.",
      button: { label: "Confirmar correo", href: link("email") },
      note: `El enlace vence en 30 minutos. ${IGNORE}`,
    }),
  },
  recovery: {
    subject: "Restablecé tu contraseña de ComputerSell",
    content: layout({
      preheader: "Creá una contraseña nueva para tu cuenta.",
      title: "Restablecé tu contraseña",
      intro: "Recibimos un pedido para cambiar la contraseña de <strong>{{ .Email }}</strong>. Tocá el botón para elegir una nueva.",
      button: { label: "Crear contraseña nueva", href: link("recovery") },
      note: `El enlace vence en 30 minutos y sirve una sola vez. Si no pediste el cambio, ignorá este correo: tu contraseña actual sigue funcionando.`,
    }),
  },
  magic_link: {
    subject: "Tu enlace para ingresar a ComputerSell",
    content: layout({
      preheader: "Ingresá a tu cuenta con un toque.",
      title: "Ingresá a tu cuenta",
      intro: "Tocá el botón para ingresar a ComputerSell como <strong>{{ .Email }}</strong>.",
      button: { label: "Ingresar", href: link("email") },
      note: `El enlace vence en 30 minutos y sirve una sola vez. ${IGNORE}`,
    }),
  },
  email_change: {
    subject: "Confirmá el cambio de correo en ComputerSell",
    content: layout({
      preheader: "Confirmá tu nuevo correo.",
      title: "Confirmá el cambio de correo",
      intro: "Pediste cambiar el correo de tu cuenta de <strong>{{ .Email }}</strong> a <strong>{{ .NewEmail }}</strong>. Tocá el botón para confirmarlo.",
      button: { label: "Confirmar cambio", href: link("email_change") },
      note: `El enlace vence en 30 minutos. ${IGNORE}`,
    }),
  },
  invite: {
    subject: "Te invitaron a ComputerSell",
    content: layout({
      preheader: "Creá tu contraseña para activar la cuenta.",
      title: "Te invitaron a ComputerSell",
      intro: "Se creó una cuenta para <strong>{{ .Email }}</strong>. Tocá el botón para elegir tu contraseña y activarla.",
      button: { label: "Activar cuenta", href: link("invite") },
      note: "El enlace vence en 30 minutos. Si no esperabas esta invitación, ignorá este correo.",
    }),
  },
  reauthentication: {
    subject: "Tu código de verificación de ComputerSell",
    content: layout({
      preheader: "Tu código de verificación.",
      title: "Código de verificación",
      intro: `Usá este código para confirmar que sos vos:<br /><br /><span style="display:inline-block;font-family:Inter, ${FONT};font-size:28px;font-weight:700;letter-spacing:6px;color:${INK};background:#f2f4f6;border-radius:10px;padding:12px 20px">{{ .Token }}</span>`,
      note: `El código vence en 30 minutos. ${IGNORE}`,
    }),
  },
  password_changed_notification: {
    subject: "Cambiaste tu contraseña de ComputerSell",
    content: layout({
      preheader: "La contraseña de tu cuenta se cambió.",
      title: "Tu contraseña se cambió",
      intro: "La contraseña de <strong>{{ .Email }}</strong> se cambió recién.",
      note: SECURITY_NOTE,
    }),
  },
  // Avisos de seguridad (variables según internal/mailer/templatemailer de Supabase Auth)
  email_changed_notification: {
    subject: "Cambió el correo de tu cuenta de ComputerSell",
    content: layout({
      preheader: "El correo de tu cuenta se cambió.",
      title: "Cambió el correo de tu cuenta",
      intro: "El correo de tu cuenta pasó de <strong>{{ .OldEmail }}</strong> a <strong>{{ .Email }}</strong>.",
      note: SECURITY_NOTE,
    }),
  },
  identity_linked_notification: {
    subject: "Se vinculó un nuevo inicio de sesión a tu cuenta de ComputerSell",
    content: layout({
      preheader: "Ahora también podés entrar con otro método.",
      title: "Nuevo método para entrar",
      intro: "A tu cuenta <strong>{{ .Email }}</strong> se le vinculó el inicio de sesión con <strong>{{ .Provider }}</strong>. Desde ahora también podés entrar con ese método.",
      note: SECURITY_NOTE,
    }),
  },
  identity_unlinked_notification: {
    subject: "Se quitó un método para entrar a tu cuenta de ComputerSell",
    content: layout({
      preheader: "Se quitó un método de inicio de sesión de tu cuenta.",
      title: "Se quitó un método para entrar",
      intro: "Se quitó el inicio de sesión con <strong>{{ .Provider }}</strong> de tu cuenta <strong>{{ .Email }}</strong>.",
      note: SECURITY_NOTE,
    }),
  },
  mfa_factor_enrolled_notification: {
    subject: "Activaste la verificación en dos pasos en ComputerSell",
    content: layout({
      preheader: "Tu cuenta ahora pide un código además de la contraseña.",
      title: "Verificación en dos pasos activada",
      intro: "En tu cuenta <strong>{{ .Email }}</strong> se activó la verificación en dos pasos. Para entrar al panel vas a necesitar el código de tu app de autenticación.",
      note: SECURITY_NOTE,
    }),
  },
  mfa_factor_unenrolled_notification: {
    subject: "Se desactivó la verificación en dos pasos en ComputerSell",
    content: layout({
      preheader: "Tu cuenta ya no pide el código de la app.",
      title: "Verificación en dos pasos desactivada",
      intro: "En tu cuenta <strong>{{ .Email }}</strong> se quitó la verificación en dos pasos. La próxima vez que entres al panel vas a tener que configurarla de nuevo.",
      note: SECURITY_NOTE,
    }),
  },
};

// Avisos que se mandan al dueño de la cuenta (mailer_notifications_*_enabled)
const NOTIFICATIONS = ["password_changed", "email_changed", "identity_linked", "identity_unlinked", "mfa_factor_enrolled", "mfa_factor_unenrolled"];

// Campos para PATCH /projects/{ref}/config/auth
function authTemplateConfig() {
  const body = {};
  for (const [key, t] of Object.entries(TEMPLATES)) {
    body[`mailer_subjects_${key}`] = t.subject;
    body[`mailer_templates_${key}_content`] = t.content;
  }
  for (const n of NOTIFICATIONS) body[`mailer_notifications_${n}_enabled`] = true;
  return body;
}

module.exports = { TEMPLATES, NOTIFICATIONS, authTemplateConfig };
