import "server-only";

export class EvolutionError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

export type EvolutionState = "open" | "connecting" | "close";
export type EvolutionInstance = { name: string; connectionStatus: string; ownerJid: string | null; profileName: string | null; profilePicUrl: string | null };
export type EvolutionGroup = { id: string; subject: string; size: number | null };

export function evolutionConfig() {
  const url = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
  const key = process.env.EVOLUTION_API_KEY?.trim();
  return url && key && /^https:\/\//.test(url) ? { url, key } : null;
}

// Thin client for the agency's own Evolution API server (WhatsApp Web sessions by QR Code).
export class EvolutionClient {
  constructor(private readonly config: { url: string; key: string }, private readonly fetcher: typeof fetch = fetch) {}

  private async request<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
    const response = await this.fetcher(`${this.config.url}${path}`, {
      method: init.method ?? "GET",
      headers: { apikey: this.config.key, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
      cache: "no-store",
    }).catch(() => { throw new EvolutionError("O servidor do WhatsApp não respondeu."); });
    const body = await response.json().catch(() => null) as T | null;
    if (!response.ok) throw new EvolutionError(`O servidor do WhatsApp recusou o pedido (${response.status}).`, response.status);
    return body as T;
  }

  async instance(name: string): Promise<EvolutionInstance | null> {
    try {
      const list = await this.request<EvolutionInstance[]>(`/instance/fetchInstances?instanceName=${encodeURIComponent(name)}`);
      return list?.[0] ?? null;
    } catch (error) {
      if (error instanceof EvolutionError && error.status === 404) return null;
      throw error;
    }
  }

  async state(name: string): Promise<EvolutionState | null> {
    try {
      const result = await this.request<{ instance?: { state?: string } }>(`/instance/connectionState/${encodeURIComponent(name)}`);
      const state = result?.instance?.state;
      return state === "open" || state === "connecting" ? state : "close";
    } catch (error) {
      if (error instanceof EvolutionError && error.status === 404) return null;
      throw error;
    }
  }

  create(name: string, number?: string) {
    return this.request(`/instance/create`, { method: "POST", body: { instanceName: name, integration: "WHATSAPP-BAILEYS", qrcode: false, ...(number ? { number } : {}) } });
  }

  async connect(name: string, number?: string) {
    const result = await this.request<{ base64?: string; code?: string; pairingCode?: string | null }>(`/instance/connect/${encodeURIComponent(name)}${number ? `?number=${number}` : ""}`);
    return { qr: result?.base64 ?? null, pairingCode: result?.pairingCode ?? null };
  }

  logout(name: string) {
    return this.request(`/instance/logout/${encodeURIComponent(name)}`, { method: "DELETE" });
  }

  remove(name: string) {
    return this.request(`/instance/delete/${encodeURIComponent(name)}`, { method: "DELETE" });
  }

  async groups(name: string): Promise<EvolutionGroup[]> {
    const list = await this.request<Array<{ id: string; subject?: string; size?: number }>>(`/group/fetchAllGroups/${encodeURIComponent(name)}?getParticipants=false`, { timeoutMs: 40_000 });
    return (list ?? []).filter(group => group.id?.endsWith("@g.us")).map(group => ({ id: group.id, subject: group.subject?.trim() || "Grupo sem nome", size: group.size ?? null }));
  }

  // "delay" shows "typing…" before the message, like a person would.
  sendText(name: string, number: string, text: string) {
    return this.request(`/message/sendText/${encodeURIComponent(name)}`, { method: "POST", body: { number, text, delay: 1200 }, timeoutMs: 40_000 });
  }
}
