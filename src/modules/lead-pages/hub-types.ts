/** Tipos e regras puras do menu Leads (sem acesso a banco): usados pelo servidor e pela tela. */

export const LEAD_STATUSES = ["new", "contacted", "visit", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const STATUS_LABEL: Record<LeadStatus, string> = { new: "Novo", contacted: "Contatado", visit: "Agendado", won: "Fechado", lost: "Perdido" };
export const isLeadStatus = (value: unknown): value is LeadStatus => typeof value === "string" && (LEAD_STATUSES as readonly string[]).includes(value);

export const LEAD_PERIODS = ["all", "today", "7d", "30d"] as const;
export type LeadPeriod = (typeof LEAD_PERIODS)[number];
export const PERIOD_LABEL: Record<LeadPeriod, string> = { all: "Todo o período", today: "Hoje", "7d": "Últimos 7 dias", "30d": "Últimos 30 dias" };

export const LEAD_CHANNELS = ["form", "whatsapp", "instagram"] as const;
export type LeadChannel = (typeof LEAD_CHANNELS)[number];
export const CHANNEL_LABEL: Record<LeadChannel, string> = { form: "Formulários", whatsapp: "WhatsApp", instagram: "Instagram Direct" };
export const isLeadChannel = (value: unknown): value is LeadChannel => typeof value === "string" && (LEAD_CHANNELS as readonly string[]).includes(value);

export type LeadFilters = { forms: string[]; campaigns: string[]; status: LeadStatus[]; q: string; period: LeadPeriod; channel: LeadChannel | "" };
export const EMPTY_FILTERS: LeadFilters = { forms: [], campaigns: [], status: [], q: "", period: "all", channel: "" };

export type BoardLead = {
  id: string; name: string | null; phone: string | null; email: string | null; status: LeadStatus; statusChangedAt: string | null;
  formId: string | null; formName: string; channel: "form" | "whatsapp" | "instagram";
  /** Origem do anúncio, quando a Meta informou (nomes) e a plataforma ("fb", "ig"…). */
  campaignId: string | null; campaignName: string | null; adsetName: string | null; adName: string | null; platform: string | null;
  answers: { question: string; answer: string }[]; createdTime: string;
};
export type BoardForm = { id: string; name: string; count: number };
export type BoardChannel = { channel: LeadChannel; count: number };
export type BoardCampaign = { id: string; name: string; count: number };
export type LeadsBoardData = {
  serverTime: string; total: number; today: number; statusCounts: Record<LeadStatus, number>; forms: BoardForm[]; campaigns: BoardCampaign[]; channels: BoardChannel[];
  /** Leads que atendem aos filtros (a lista mostra no máximo `shown`). */
  matching: number; leads: BoardLead[];
};

export type LeadEvent = { id: string; kind: "status" | "note"; status: LeadStatus | null; body: string | null; actor: string; createdAt: string };

const ID = /^[0-9]{5,30}$/;

/** Lê filtros de uma query string / objeto, descartando qualquer valor fora do esperado. */
export function parseFilters(input: URLSearchParams | Record<string, string | string[] | undefined>): LeadFilters {
  const get = (key: string): string[] => {
    const value = input instanceof URLSearchParams ? input.getAll(key) : input[key];
    return (Array.isArray(value) ? value : value ? [value] : []).flatMap(item => item.split(",")).map(item => item.trim()).filter(Boolean);
  };
  const period = get("periodo")[0];
  return {
    forms: [...new Set(get("formulario").filter(id => ID.test(id)))].slice(0, 50),
    campaigns: [...new Set(get("campanha").filter(id => ID.test(id)))].slice(0, 50),
    status: [...new Set(get("status").filter(isLeadStatus))],
    q: (get("busca").join(",")).slice(0, 60),
    period: (LEAD_PERIODS as readonly string[]).includes(period ?? "") ? (period as LeadPeriod) : "all",
    channel: isLeadChannel(get("canal")[0]) ? (get("canal")[0] as LeadChannel) : "",
  };
}

export function filtersToQuery(filters: LeadFilters): string {
  const params = new URLSearchParams();
  if (filters.forms.length) params.set("formulario", filters.forms.join(","));
  if (filters.campaigns.length) params.set("campanha", filters.campaigns.join(","));
  if (filters.status.length) params.set("status", filters.status.join(","));
  if (filters.q.trim()) params.set("busca", filters.q.trim());
  if (filters.period !== "all") params.set("periodo", filters.period);
  if (filters.channel) params.set("canal", filters.channel);
  return params.toString();
}

/** Texto de busca seguro para o filtro `or` do banco (sem vírgula, parênteses, curingas nem aspas). */
export const safeSearch = (q: string) => q.replace(/[,()*%\\"'`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

/** Início do período (ISO UTC) no horário de Brasília (UTC−3, sem horário de verão); null = sem limite. */
export function periodStart(period: LeadPeriod, now: Date): string | null {
  if (period === "all") return null;
  const shifted = new Date(now.getTime() - 3 * 3_600_000);
  const today = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), 3);
  const days = period === "today" ? 0 : period === "7d" ? 6 : 29;
  return new Date(today - days * 86_400_000).toISOString();
}

/** "fb" → Facebook, "ig" → Instagram; outras plataformas aparecem como a Meta informou (primeira letra maiúscula). */
export function platformLabel(platform: string | null): string | null {
  if (!platform) return null;
  const key = platform.toLowerCase();
  if (key === "fb" || key === "facebook") return "Facebook";
  if (key === "ig" || key === "instagram") return "Instagram";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** +5586999990001 → (86) 99999-0001; outros formatos aparecem como chegaram. */
export function formatPhone(phone: string): string {
  const match = /^\+55(\d{2})(9?\d{4})(\d{4})$/.exec(phone);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : phone;
}

export const fallbackFormName = (formId: string | null) => formId ? `Formulário …${formId.slice(-4)}` : "Sem formulário";
