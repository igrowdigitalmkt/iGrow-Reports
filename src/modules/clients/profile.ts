import { z } from "zod";

// Perfil opcional do cliente: contexto de negócio usado pela IA. Nenhum campo é obrigatório.
export const PROFILE_FIELDS = [
  { key: "segment", label: "Segmento", placeholder: "Ex.: imobiliária, clínica odontológica, escola", max: 120, multiline: false, prompt: "segmento" },
  { key: "offering", label: "O que vende", placeholder: "Produtos ou serviços principais", max: 500, multiline: true, prompt: "o_que_vende" },
  { key: "location", label: "Onde atua", placeholder: "Cidade, região ou área de atendimento", max: 200, multiline: false, prompt: "onde_atua" },
  { key: "audience", label: "Público-alvo", placeholder: "Quem costuma comprar", max: 500, multiline: true, prompt: "publico_alvo" },
  { key: "ticket_range", label: "Faixa de ticket médio", placeholder: "Ex.: R$ 300 a R$ 800 (opcional)", max: 120, multiline: false, prompt: "faixa_de_ticket_medio" },
  { key: "contact_flow", label: "Como atende os contatos", placeholder: "Ex.: WhatsApp da loja, ligação, visita", max: 300, multiline: false, prompt: "como_atende_os_contatos" },
  { key: "goal", label: "O que quer com os anúncios", placeholder: "Ex.: mais visitas aos imóveis (texto livre)", max: 500, multiline: true, prompt: "objetivo_com_os_anuncios" },
] as const;

export type ProfileKey = typeof PROFILE_FIELDS[number]["key"];
export type ClientProfile = Record<ProfileKey, string | null>;

export const EMPTY_PROFILE: ClientProfile = {
  segment: null, offering: null, location: null, audience: null, ticket_range: null, contact_flow: null, goal: null,
};

const field = (max: number) => z.string().trim().max(max, `Use até ${max} caracteres.`).optional().nullable()
  .transform(value => value && value.length > 0 ? value : null);

export const profileInputSchema = z.object({
  segment: field(120), offering: field(500), location: field(200), audience: field(500),
  ticket_range: field(120), contact_flow: field(300), goal: field(500),
});

export function profileCompleteness(profile: Partial<ClientProfile> | null | undefined) {
  const filled = PROFILE_FIELDS.filter(item => (profile?.[item.key] ?? "").trim().length > 0).length;
  return { filled, total: PROFILE_FIELDS.length, complete: filled === PROFILE_FIELDS.length };
}

// Só o texto de negócio vai para a IA, e só os campos preenchidos.
export function profileForPrompt(profile: Partial<ClientProfile> | null | undefined): Record<string, string> | null {
  const entries = PROFILE_FIELDS.flatMap(item => {
    const value = profile?.[item.key]?.trim();
    return value ? [[item.prompt, value] as const] : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

export const PROFILE_NUDGE = "Complete o perfil do cliente para receber comentários mais precisos.";
