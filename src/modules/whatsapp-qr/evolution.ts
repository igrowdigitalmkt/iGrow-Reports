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
    // Required before first linking: WhatsApp only sends the initial full history during bootstrap.
    return this.request(`/instance/create`, { method: "POST", body: { instanceName: name, integration: "WHATSAPP-BAILEYS", qrcode: false, syncFullHistory: true, ...(number ? { number } : {}) } });
  }

  async connect(name: string, number?: string) {
    const result = await this.request<{ base64?: string; code?: string; pairingCode?: string | null }>(`/instance/connect/${encodeURIComponent(name)}${number ? `?number=${number}` : ""}`);
    return { qr: result?.base64 ?? null, pairingCode: result?.pairingCode ?? null };
  }

  // Messages, receipts and chat state are forwarded to the iGrow, signed by a header.
  // CHATS_SET backfills state after a WhatsApp history sync; UPDATE/UPSERT keep archive/unread live.
  setWebhook(name: string, url: string, token: string) {
    return this.request(`/webhook/set/${encodeURIComponent(name)}`, { method: "POST", body: { webhook: { enabled: true, url, headers: { "x-igrow-token": token }, byEvents: false, base64: false, events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "SEND_MESSAGE", "CHATS_SET", "CHATS_UPSERT", "CHATS_UPDATE"] } } });
  }

  logout(name: string) {
    return this.request(`/instance/logout/${encodeURIComponent(name)}`, { method: "DELETE" });
  }

  remove(name: string) {
    return this.request(`/instance/delete/${encodeURIComponent(name)}`, { method: "DELETE" });
  }

  /** Subject of one group (names the conversation in the inbox). */
  async groupSubject(name: string, groupJid: string) {
    const result = await this.request<{ subject?: string }>(`/group/findGroupInfos/${encodeURIComponent(name)}?groupJid=${encodeURIComponent(groupJid)}`, { timeoutMs: 15_000 });
    return result?.subject?.trim() || null;
  }

  async groups(name: string): Promise<EvolutionGroup[]> {
    const list = await this.request<Array<{ id: string; subject?: string; size?: number }>>(`/group/fetchAllGroups/${encodeURIComponent(name)}?getParticipants=false`, { timeoutMs: 40_000 });
    return (list ?? []).filter(group => group.id?.endsWith("@g.us")).map(group => ({ id: group.id, subject: group.subject?.trim() || "Grupo sem nome", size: group.size ?? null }));
  }

  /** Marks received messages as read on WhatsApp (the contact sees the blue ticks, as when opening the chat). */
  async markRead(name: string, keys: Array<{ remoteJid: string; fromMe: boolean; id: string }>) {
    await this.request(`/chat/markMessageAsRead/${encodeURIComponent(name)}`, { method: "POST", body: { readMessages: keys } });
  }

  /** Archives or unarchives a chat on WhatsApp (needs its last message). */
  async archive(name: string, chat: string, lastMessage: { key: { remoteJid: string; fromMe: boolean; id: string }; messageTimestamp: number }, archive: boolean) {
    await this.request(`/chat/archiveChat/${encodeURIComponent(name)}`, { method: "POST", body: { chat, lastMessage, archive } });
  }

  /** Public profile photo URL of a contact or group (null when hidden or absent). */
  async profilePictureUrl(name: string, number: string) {
    const result = await this.request<{ profilePictureUrl?: string | null }>(`/chat/fetchProfilePictureUrl/${encodeURIComponent(name)}`, { method: "POST", timeoutMs: 15_000, body: { number } });
    return result?.profilePictureUrl || null;
  }

  /** File of a message the session saw (received or sent), as base64. */
  async mediaOfMessage(name: string, key: { id: string; remoteJid: string; fromMe: boolean }, ref?: { type: string; data: Record<string, unknown> } | null) {
    // With the file reference the server downloads straight from WhatsApp (it does not keep messages).
    const message = ref ? { key, message: { [ref.type]: ref.data } } : { key };
    const result = await this.request<{ base64?: string; mimetype?: string; fileName?: string }>(`/chat/getBase64FromMediaMessage/${encodeURIComponent(name)}`, {
      method: "POST", timeoutMs: 45_000, body: { message, convertToMp4: false },
    });
    if (!result?.base64) throw new EvolutionError("Arquivo indisponível.", 404);
    return { base64: result.base64, mime: result.mimetype ?? "application/octet-stream", fileName: result.fileName ?? null };
  }

  /** Voice message (the server converts the recording to WhatsApp's voice format). */
  async sendVoice(name: string, number: string, base64: string) {
    const result = await this.request<{ key?: { id?: string } }>(`/message/sendWhatsAppAudio/${encodeURIComponent(name)}`, { method: "POST", timeoutMs: 60_000, body: { number, audio: base64, encoding: true } });
    return { messageId: result?.key?.id ?? null };
  }

  /** Photo, video, audio or document, sent as base64 with an optional caption. */
  async sendMedia(name: string, number: string, media: { mediatype: "image" | "video" | "audio" | "document"; mimetype: string; base64: string; fileName: string; caption?: string }) {
    const result = await this.request<{ key?: { id?: string } }>(`/message/sendMedia/${encodeURIComponent(name)}`, {
      method: "POST", timeoutMs: 60_000,
      body: { number, mediatype: media.mediatype, mimetype: media.mimetype, media: media.base64, fileName: media.fileName, ...(media.caption ? { caption: media.caption } : {}) },
    });
    return { messageId: result?.key?.id ?? null };
  }

  // "delay" shows "typing…" before the message, like a person would.
  async sendText(name: string, number: string, text: string) {
    const result = await this.request<{ key?: { id?: string } }>(`/message/sendText/${encodeURIComponent(name)}`, { method: "POST", body: { number, text, delay: 1200 }, timeoutMs: 40_000 });
    return { messageId: result?.key?.id ?? null };
  }
}
