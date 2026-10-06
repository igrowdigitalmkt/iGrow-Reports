import type { WhatsAppTemplate } from "./templates";

export class WhatsAppApiError extends Error {
  constructor(message: string, readonly code: string | null = null, readonly status = 502) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

const id = (value: string) => {
  if (!/^\d{5,30}$/.test(value)) throw new WhatsAppApiError("Identificador do WhatsApp inválido.", null, 400);
  return value;
};

// Minimal WhatsApp Cloud API client (Graph API) for the calls the platform needs.
export class WhatsAppGraph {
  constructor(private readonly options: { accessToken: string; apiVersion: string }) {}

  private url(path: string) {
    return `https://graph.facebook.com/${this.options.apiVersion}/${path}`;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(this.url(path), {
      ...init,
      headers: { Authorization: `Bearer ${this.options.accessToken}`, ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...init.headers },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => ({})) as T & { error?: { message?: string; code?: number; error_subcode?: number } };
    if (!response.ok || body.error) {
      throw new WhatsAppApiError(body.error?.message ?? `Falha ${response.status} na API do WhatsApp.`, body.error?.code != null ? String(body.error.code) : null, response.status);
    }
    return body;
  }

  phoneNumber(phoneNumberId: string) {
    return this.request<{ id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string }>(
      `${id(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`);
  }

  async templates(wabaId: string): Promise<WhatsAppTemplate[]> {
    const result = await this.request<{ data?: WhatsAppTemplate[] }>(`${id(wabaId)}/message_templates?fields=name,language,status,category,components&limit=200`);
    return result.data ?? [];
  }

  async uploadPdf(phoneNumberId: string, file: Blob, filename: string) {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", "application/pdf");
    form.append("file", file, filename);
    const result = await this.request<{ id: string }>(`${id(phoneNumberId)}/media`, { method: "POST", body: form });
    return result.id;
  }

  async sendTemplate(phoneNumberId: string, to: string, template: { name: string; language: string; components: unknown[] }) {
    const result = await this.request<{ messages?: Array<{ id: string }> }>(`${id(phoneNumberId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: to.replace(/^\+/, ""), type: "template",
        template: { name: template.name, language: { code: template.language }, components: template.components } }),
    });
    const wamid = result.messages?.[0]?.id;
    if (!wamid) throw new WhatsAppApiError("O WhatsApp não confirmou o envio da mensagem.");
    return wamid;
  }
}
