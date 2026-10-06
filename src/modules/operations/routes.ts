// Workspace addresses → internal section. Report pages live under /relatorios.
export const SECTION_ROUTES: Record<string, string> = {
  "": "",
  clientes: "clientes",
  integracoes: "integracoes",
  configuracoes: "configuracoes",
  "relatorios/agendamentos": "agendamentos",
  "relatorios/entregas": "entregas",
  "relatorios/templates": "templates",
  "relatorios/pdfs": "relatorios",
};

// Former addresses keep working.
export const LEGACY_ROUTES: Record<string, string> = {
  relatorios: "relatorios/agendamentos",
  agendamentos: "relatorios/agendamentos",
  entregas: "relatorios/entregas",
  templates: "relatorios/templates",
};

export const SECTION_PATHS: Record<string, string> = Object.fromEntries(Object.entries(SECTION_ROUTES).map(([path, section]) => [section, path]));

export function legacyRedirect(base: string, path: string, query: Record<string, string | string[] | undefined>) {
  const target = LEGACY_ROUTES[path];
  if (!target) return null;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) for (const item of [value].flat()) if (item != null) search.append(key, item);
  const suffix = search.toString();
  return `${base}/${target}${suffix ? `?${suffix}` : ""}`;
}
