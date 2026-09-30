// Pure validation: never return environment values or credentials in diagnostics.
export function validateDeployment(env) {
  const errors = [];
  for (const name of ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SUPABASE_URL"]) {
    try {
      const url = new URL(env[name]);
      if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password || url.search || url.hash || url.pathname !== "/" || /^(localhost|127\.|0\.|\[::1\])/.test(url.hostname)) throw new Error();
    } catch { errors.push(`${name}: informe uma origem HTTPS pública, sem caminho ou credenciais.`); }
  }
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  let validKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (!validKey) {
    try { validKey = key.split(".").length === 3 && JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role === "anon"; } catch { /* Invalid public key. */ }
  }
  if (!validKey) errors.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: use uma chave publishable ou anon, nunca service_role.");
  if (!["production", "staging"].includes(env.APP_ENV)) errors.push("APP_ENV: use production ou staging.");
  if (env.ENABLE_DEMO !== "false") errors.push("ENABLE_DEMO: defina false para publicação operacional.");
  if (env.EXTERNAL_DELIVERIES_ENABLED !== "false") errors.push("EXTERNAL_DELIVERIES_ENABLED: mantenha false; envios ainda não foram implementados.");
  for (const name of Object.keys(env)) {
    if (name.startsWith("NEXT_PUBLIC_") && /(SECRET|PASSWORD|SERVICE_ROLE|PRIVATE|SIGNING)/i.test(name) && env[name]) errors.push(`${name}: segredo não pode ser público.`);
  }
  return errors;
}
