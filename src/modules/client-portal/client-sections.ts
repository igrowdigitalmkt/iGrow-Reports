/**
 * Secoes do menu do cliente. Cada uma tem um endereco real (/clientes/ID/dashboard...), mas a troca entre elas e feita no
 * navegador (history.pushState), sem recarregar: a selecao de campanhas, o escopo e os rascunhos vivem no mesmo componente.
 */
export type ClientSection = "summary" | "overview" | "campaigns" | "metrics" | "reports";

/** Segmento de URL de cada secao ("" = Visao geral). `overview` e o Dashboard (todos os dados de campanhas). */
export const SECTION_SLUGS: Record<ClientSection, string> = {
  summary: "", overview: "dashboard", campaigns: "campanhas", metrics: "metricas", reports: "relatorios",
};
export const VALID_SECTION_SLUGS = Object.values(SECTION_SLUGS).filter(Boolean);

const CLIENT_PATH = /^((?:\/demo)?\/clientes\/[^/]+)(?:\/([^/]+))?\/?$/;

/** Secao e raiz do cliente a partir do endereco atual; null fora das paginas de cliente. */
export function parseClientPath(pathname: string): { base: string; section: ClientSection } | null {
  const match = CLIENT_PATH.exec(pathname);
  if (!match) return null;
  const slug = match[2] ?? "";
  const section = (Object.keys(SECTION_SLUGS) as ClientSection[]).find(key => SECTION_SLUGS[key] === slug);
  return section ? { base: match[1]!, section } : null;
}

export function clientSectionPath(base: string, section: ClientSection) {
  const slug = SECTION_SLUGS[section];
  return slug ? `${base}/${slug}` : base;
}

/**
 * Secoes com pagina propria (rota estatica, componentes de servidor proprios): Campanhas. Entrar nelas ou sair delas NAO usa
 * history.pushState, e sim a navegacao do Next.js, para que o conteudo do servidor seja realmente trocado.
 */
export const ROUTED_SECTIONS: readonly ClientSection[] = ["campaigns"];

const CLIENT_BASE = /^((?:\/demo)?\/clientes\/[^/]+)(?:\/([^/]+))?(?:\/.*)?$/;

/** Raiz do cliente e secao ativa, inclusive em paginas internas (ex.: /clientes/ID/campanhas/meta/...). */
export function activeClientSection(pathname: string): { base: string; section: ClientSection } | null {
  const match = CLIENT_BASE.exec(pathname);
  if (!match) return null;
  const slug = match[2] ?? "";
  const section = (Object.keys(SECTION_SLUGS) as ClientSection[]).find(key => SECTION_SLUGS[key] === slug);
  return section ? { base: match[1]!, section } : null;
}

/** Em qualquer pagina de cliente (inclusive secoes desconhecidas), a barra principal recolhe. */
export const isClientRoute = (pathname: string) => /^(?:\/demo)?\/clientes\/[^/]+/.test(pathname);
