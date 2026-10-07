/** Only destinations belonging to authenticated application flows are accepted. */
export function safeRedirect(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (/[\\\u0000-\u0020\u007f]/.test(decoded) || decoded.startsWith("//")) return fallback;
  const target = new URL(value, "https://igrow.invalid");
  const allowed = target.pathname === "/dashboard" || target.pathname.startsWith("/dashboard/") ||
    target.pathname === "/cliente" || target.pathname.startsWith("/cliente/") ||
    ["/convite", "/selecionar-espaco", "/selecionar-agencia", "/auth/definir-senha", "/criar-espaco"].includes(target.pathname);
  return target.origin === "https://igrow.invalid" && allowed ? `${target.pathname}${target.search}` : fallback;
}

