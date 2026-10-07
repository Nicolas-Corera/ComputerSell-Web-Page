// Regresión de las plantillas de Supabase Auth: Go html/template falla con
// "{{.TokenHash}} appears in an ambiguous context within a URL" si el token
// queda después de un {{ end }} dentro de un href (el if puede terminar antes
// o después del "#"). Supabase no manda el correo y el alta responde 500.
// Uso: node --test tests/js/
const { test } = require("node:test");
const assert = require("node:assert");
const { TEMPLATES } = require("../../scripts/email-templates");

test("[HIGH] ningún href de las plantillas pone una variable después de un {{ end }}", () => {
  for (const [key, t] of Object.entries(TEMPLATES)) {
    for (const [, href] of t.content.matchAll(/href="([^"]*)"/g)) {
      const after = href.split("{{ end }}").slice(1).join("");
      assert.ok(!/\{\{/.test(after), `${key}: variable después de {{ end }} en ${href}`);
    }
  }
});

test("los enlaces con token llevan token_hash y type en las dos ramas", () => {
  const { content } = TEMPLATES.confirmation;
  const href = content.match(/href="([^"]*TokenHash[^"]*)"/)[1];
  const [ifBranch, elseBranch] = href.split("{{ else }}");
  for (const b of [ifBranch, elseBranch]) assert.match(b, /&token_hash=\{\{ \.TokenHash \}\}&type=email/);
});
