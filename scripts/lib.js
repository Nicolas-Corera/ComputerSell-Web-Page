// Helpers compartidos por los scripts: lectura del .env y llamadas a la
// Management API de Supabase (usa el access token SUPABASE del .env).
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function readEnv() {
  const file = path.join(ROOT, ".env");
  const env = { ...process.env };
  if (fs.existsSync(file)) {
    fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line) => {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
        if (!m || line.trim().startsWith("#")) return;
        env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      });
  }
  return env;
}

async function api(env, method, route, body) {
  const token = env.SUPABASE;
  if (!token) throw new Error("Falta SUPABASE (access token) en el .env");
  const res = await fetch("https://api.supabase.com/v1" + route, {
    method,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = text;
  }
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

function projectRef(env) {
  const ref = env.SUPABASE_PROJECT_REF || (env.SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (!ref) throw new Error("Falta SUPABASE_URL o SUPABASE_PROJECT_REF en el .env");
  return ref;
}

async function sql(env, query) {
  return api(env, "POST", `/projects/${projectRef(env)}/database/query`, { query });
}

module.exports = { ROOT, readEnv, api, projectRef, sql };
