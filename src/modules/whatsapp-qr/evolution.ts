import "server-only";

export class EvolutionError extends Error {
  constructor(message: string, readonly status = 0, readonly code?: string) { super(message); }
}

export type EvolutionState = "open" | "connecting" | "close";
export type EvolutionInstance = { name: string; connectionStatus: string; ownerJid: string | null; profileName: string | null; profilePicUrl: string | null };
export type EvolutionGroup = { id: string; subject: string; size: number | null };
export type EvolutionLabelSnapshot = {
  labels: Array<{ id: string; name: string; color: string }>;
  chats: Array<{ remoteJid: string; remoteJidAlt?: string; labels: string[] }>;
};

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
    if (!response.ok) {
      const details = body as { message?: unknown; response?: { message?: unknown } } | null;
      const message = details?.response?.message ?? details?.message;
      const messages = Array.isArray(message) ? message : [message];
      const code = messages.includes("IGROW_LABEL_STATE_UNAVAILABLE") ? "IGROW_LABEL_STATE_UNAVAILABLE"
        : messages.includes("Cannot block the connected account") ? "IGROW_CONTACT_SELF" : undefined;
      throw new EvolutionError(`O servidor do WhatsApp recusou o pedido (${response.status}).`, response.status, code);
    }
    return body as T;
  }

  async instance(name: string): Promise<EvolutionInstance | null> {
    try {
      const list = await this.request<EvolutionInstance[]>(`/instance/fetchInstances?instanceName=${encodeURIComponent(name)}`);
      return Array.isArray(list) ? list.find(row => row.name === name) ?? null : null;
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
    // WhatsApp is a recent-conversation inbox, not a historical archive. Never request full history.
    return this.request(`/instance/create`, { method: "POST", body: { instanceName: name, integration: "WHATSAPP-BAILEYS", qrcode: false, syncFullHistory: false, ...(number ? { number } : {}) } });
  }

  async connect(name: string, number?: string) {
    const result = await this.request<{ base64?: string; code?: string; pairingCode?: string | null }>(`/instance/connect/${encodeURIComponent(name)}${number ? `?number=${number}` : ""}`);
    return { qr: result?.base64 ?? null, pairingCode: result?.pairingCode ?? null };
  }

  // Messages, receipts and chat state are forwarded to the iGrow, signed by a header.
  // Only live UPDATE/UPSERT chat states are needed for archive/unread sync.
  setWebhook(name: string, url: string, token: string) {
    return this.request(`/webhook/set/${encodeURIComponent(name)}`, { method: "POST", body: { webhook: { enabled: true, url, headers: { "x-igrow-token": token }, byEvents: false, base64: false, events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "SEND_MESSAGE", "CHATS_UPDATE", "CHATS_SET", "CHATS_UPSERT", "CONNECTION_UPDATE", "MESSAGES_SET"] } } });
  }

  logout(name: string) {
    return this.request(`/instance/logout/${encodeURIComponent(name)}`, { method: "DELETE" });
  }

  labelSnapshot(name: string) {
    return this.request<EvolutionLabelSnapshot>(`/label/igrowSnapshot/${encodeURIComponent(name)}`, { timeoutMs: 45_000 });
  }

  async contactBlock(name: string, peer: string, blocked?: boolean) {
    const result = await this.request<{ blocked: boolean }>(`/label/igrowContactBlock/${encodeURIComponent(name)}`, {
      method: "POST", body: { peer, ...(blocked !== undefined ? { blocked } : {}) },
    });
    if (typeof result?.blocked !== "boolean" || (blocked !== undefined && result.blocked !== blocked))
      throw new EvolutionError("O WhatsApp não confirmou o bloqueio.");
    return result;
  }

  editLabel(name: string, data: { id?: string; name?: string; color?: number; deleted?: boolean }) {
    return this.request<{ id: string }>(`/label/igrowEdit/${encodeURIComponent(name)}`, { method: "POST", body: data, timeoutMs: 45_000 });
  }

  setChatLabel(name: string, jid: string, labelId: string, member: boolean) {
    return this.request(`/label/handleLabel/${encodeURIComponent(name)}`, {
      method: "POST", body: { number: jid, labelId, action: member ? "add" : "remove" },
    });
  }

  remove(name: string) {
    return this.request(`/instance/delete/${encodeURIComponent(name)}`, { method: "DELETE" });
  }

  /** Subject of one group (names the conversation in the inbox). */
  async groupSubject(name: string, groupJid: string, timeoutMs = 15_000) {
    const result = await this.request<{ subject?: string }>(`/group/findGroupInfos/${encodeURIComponent(name)}?groupJid=${encodeURIComponent(groupJid)}`, { timeoutMs });
    return result?.subject?.trim() || null;
  }

  async groupInfo(name: string, groupJid: string) {
    const result = await this.request<{ subject?: string; desc?: string; size?: number; participants?: Array<{ id?: string; admin?: string | null }> }>(
      `/group/findGroupInfos/${encodeURIComponent(name)}?groupJid=${encodeURIComponent(groupJid)}`, { timeoutMs: 12_000 });
    return {
      subject: typeof result?.subject === "string" ? result.subject.slice(0, 200) : null,
      description: typeof result?.desc === "string" ? result.desc.slice(0, 1500) : null,
      members: typeof result?.size === "number" ? result.size : result?.participants?.length ?? null,
      participants: (result?.participants ?? []).slice(0, 40).flatMap(item =>
        typeof item.id === "string" && item.id.length < 120
          ? [{ id: item.id, admin: !!item.admin }] : []),
    };
  }

  async resolvePeerLinks(name: string, lids: string[]): Promise<Array<{ lid: string; phone: string }>> {
    return this.request<Array<{ lid: string; phone: string }>>(`/chat/resolvePeerLinks/${encodeURIComponent(name)}`, {
      method: "POST", body: { lids: lids.slice(0, 60) }, timeoutMs: 25_000,
    });
  }

  async groups(name: string): Promise<EvolutionGroup[]> {
    const list = await this.request<Array<{ id: string; subject?: string; size?: number }>>(`/group/fetchAllGroups/${encodeURIComponent(name)}?getParticipants=false`, { timeoutMs: 40_000 });
    return (list ?? []).filter(group => group.id?.endsWith("@g.us")).map(group => ({ id: group.id, subject: group.subject?.trim() || "Grupo sem nome", size: group.size ?? null }));
  }

  async commonGroups(name: string, peer: string) {
    const groups = await this.request<Array<{ id: string; subject?: string; participants?: Array<{ id?: string; phoneNumber?: string; lid?: string }> }>>(
      `/group/fetchAllGroups/${encodeURIComponent(name)}?getParticipants=true`, { timeoutMs: 40_000 });
    const key = (jid: string) => jid.replace(/:\d+(?=@)/g, "").replace(/@s\.whatsapp\.net$/, "");
    const target = key(peer);
    let incomplete = false;
    const confirmed = (groups ?? []).filter(group => {
      if (!group.id?.endsWith("@g.us")) return false;
      if (!group.participants) { incomplete = true; return false; }
      const found = group.participants.some(person => [person.id, person.phoneNumber, person.lid].some(jid => typeof jid === "string" && key(jid) === target));
      if (!found && group.participants.some(person => target.endsWith("@lid")
        ? !person.id?.endsWith("@lid") && !person.lid
        : person.id?.endsWith("@lid") && !person.phoneNumber)) incomplete = true;
      return found;
    }).map(group => ({ id: group.id, subject: group.subject?.trim().slice(0, 200) || "Grupo sem nome" }));
    return { groups: confirmed, incomplete };
  }

  /** Marks received messages as read on WhatsApp (the contact sees the blue ticks, as when opening the chat). */
  async markRead(name: string, keys: Array<{ remoteJid: string; fromMe: boolean; id: string }>, chat: string) {
    await this.request(`/chat/markMessageAsRead/${encodeURIComponent(name)}`, { method: "POST", body: { readMessages: keys, chat } });
  }

  /** Archives or unarchives a chat on WhatsApp. */
  async archive(name: string, chat: string, lastMessage: { key: { remoteJid: string; fromMe: boolean; id: string }; messageTimestamp: number } | undefined, archive: boolean) {
    await this.request(`/chat/archiveChat/${encodeURIComponent(name)}`, { method: "POST", body: { chat, ...(lastMessage ? { lastMessage } : {}), archive } });
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

  /** React to a real WhatsApp message (including removal via empty emoji). */
  async reactToMessage(name: string, key: { id: string; remoteJid: string; fromMe: boolean; participant?: string }, emoji: string) {
    return this.request<unknown>(`/message/sendReaction/${encodeURIComponent(name)}`, {
      method: "POST", timeoutMs: 30_000, body: { key, reaction: emoji },
    });
  }

  /** WhatsApp revocation command. Only our own sent-message keys are accepted
   * by the caller; this is not deletion of a chat or an incoming message. */
  async revokeSentMessage(name: string, remoteJid: string, id: string) {
    const result = await this.request<{ key?: { id?: string }; message?: unknown }>(
      `/chat/deleteMessageForEveryone/${encodeURIComponent(name)}`, {
        method: "DELETE", timeoutMs: 30_000,
        body: { id, remoteJid, fromMe: true },
      });
    // Evolution's HTTP response means a request was accepted by the linked
    // WhatsApp session, not a read receipt or proof every phone removed it.
    if (!result || typeof result !== "object")
      throw new EvolutionError("O WhatsApp não confirmou a solicitação de exclusão.");
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
  async sendText(name: string, number: string, text: string, replyTo?: {
    id: string; fromMe: boolean; remoteJid: string; text: string;
  }) {
    const quoted = replyTo ? {
      key: { id: replyTo.id, remoteJid: replyTo.remoteJid, fromMe: replyTo.fromMe },
      message: { conversation: replyTo.text || "Mensagem" },
    } : undefined;
    const result = await this.request<{ key?: { id?: string } }>(`/message/sendText/${encodeURIComponent(name)}`,
      { method: "POST", body: { number, text, delay: 1200, ...(quoted ? { quoted } : {}) }, timeoutMs: 40_000 });
    return { messageId: result?.key?.id ?? null };
  }
}
