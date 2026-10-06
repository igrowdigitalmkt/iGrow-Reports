// Workspace addresses → internal section. Entregas, Templates and PDFs are tabs of /relatorios.
export const SECTION_ROUTES: Record<string, string> = {
  "": "",
  clientes: "clientes",
  agendamentos: "agendamentos",
  relatorios: "relatorios-visao",
  "relatorios/entregas": "entregas",
  "relatorios/templates": "templates",
  "relatorios/pdfs": "relatorios",
  integracoes: "integracoes",
  configuracoes: "configuracoes",
};

// Former addresses keep working.
export const LEGACY_ROUTES: Record<string, string> = {
  "relatorios/agendamentos": "agendamentos",
  entregas: "relatorios/entregas",
  templates: "relatorios/templates",
};

export const SECTION_PATHS: Record<string, string> = Object.fromEntries(Object.entries(SECTION_ROUTES).map(([path, section]) => [section, path]));

/** Sections shown as tabs inside the Relatórios page, in order. */
export const REPORT_TABS = [
  { section: "relatorios-visao", label: "Dados gerais" },
  { section: "entregas", label: "Entregas" },
  { section: "templates", label: "Templates" },
  { section: "relatorios", label: "PDFs salvos" },
] as const;
export const isReportTab = (section: string) => REPORT_TABS.some(tab => tab.section === section);

export function legacyRedirect(base: string, path: string, query: Record<string, string | string[] | undefined>) {
  const target = LEGACY_ROUTES[path];
  if (target === undefined) return null;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) for (const item of [value].flat()) if (item != null) search.append(key, item);
  const suffix = search.toString();
  return `${base}/${target}${suffix ? `?${suffix}` : ""}`;
}
