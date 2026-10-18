const WORKSPACE_PATHS = ["/clientes", "/agendamentos", "/relatorios", "/integracoes", "/equipe", "/configuracoes", "/whatsapp", "/assinatura", "/entregas", "/templates"];

/** Only destinations belonging to authenticated application flows are accepted. */
export function safeRedirect(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (/[\\\u0000-\u0020\u007f]/.test(decoded) || decoded.startsWith("//")) return fallback;
  try {
    const target = new URL(value, "https://igrow.invalid");
    const path = target.pathname === "/dashboard" ? "/" : target.pathname.startsWith("/dashboard/") ? target.pathname.slice("/dashboard".length) : target.pathname;
    const allowed = path === "/" || WORKSPACE_PATHS.some(prefix => path === prefix || path.startsWith(`${prefix}/`)) ||
      path === "/cliente" || path.startsWith("/cliente/") ||
      path === "/admin" || path.startsWith("/admin/") ||
      ["/convite", "/selecionar-espaco", "/selecionar-agencia", "/auth/definir-senha", "/criar-espaco"].includes(path);
    return target.origin === "https://igrow.invalid" && !path.startsWith("//") && allowed ? `${path}${target.search}` : fallback;
  } catch {
    return fallback;
  }
}

