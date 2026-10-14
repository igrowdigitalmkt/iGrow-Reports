// Cliente mínimo da Google Ads API (REST). Só leitura: renovação do token OAuth, GAQL e listagem de contas.
// Nenhum segredo é registrado em log ou em mensagens de erro.

export type GoogleAdsCredentials = {
  // Opcional: desde 9/9/2026 o Google não usa mais o token de desenvolvedor (o acesso vem do projeto do Google Cloud).
  developerToken?: string | null;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  // Conta de gerente (MCC) por onde as contas dos clientes são acessadas.
  loginCustomerId?: string | null;
};

export class GoogleAdsApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null) {
    super(message);
    this.name = "GoogleAdsApiError";
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const TOKEN_URL = "https://oauth2.googleapis.com/token";
// Versões antigas da API são desligadas pelo Google com o tempo; o padrão acompanha uma versão vigente (ajustável por GOOGLE_ADS_API_VERSION).
export const DEFAULT_API_VERSION = "v25";
// Conta do Google Ads: 10 dígitos, com ou sem hífens.
export const normalizeCustomerId = (value: string) => value.replace(/-/g, "");
export const isCustomerId = (value: string) => /^\d{10}$/.test(normalizeCustomerId(value));

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function describe(status: number, body: unknown) {
  const error = object(object(body).error);
  const details = Array.isArray(error.details) ? error.details.map(object) : [];
  const first = details.flatMap(detail => Array.isArray(detail.errors) ? detail.errors.map(object) : [])[0];
  const code = first ? Object.values(object(first.errorCode))[0] : null;
  return { code: typeof code === "string" ? code : typeof error.status === "string" ? error.status : null, status };
}

export class GoogleAdsClient {
  private accessToken: { value: string; expiresAt: number } | null = null;
  private readonly fetcher: FetchLike;
  private readonly version: string;

  constructor(private readonly credentials: GoogleAdsCredentials, options: { fetcher?: FetchLike; version?: string; now?: () => number } = {}) {
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init) as ReturnType<FetchLike>);
    this.version = options.version ?? process.env.GOOGLE_ADS_API_VERSION ?? DEFAULT_API_VERSION;
    this.now = options.now ?? Date.now;
  }
  private readonly now: () => number;

  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt - 60_000 > this.now()) return this.accessToken.value;
    const body = new URLSearchParams({
      grant_type: "refresh_token", client_id: this.credentials.clientId, client_secret: this.credentials.clientSecret, refresh_token: this.credentials.refreshToken,
    }).toString();
    const response = await this.fetcher(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    const payload = object(await response.json().catch(() => ({})));
    if (!response.ok || typeof payload.access_token !== "string") {
      // invalid_grant: o acesso foi revogado ou expirou; o cliente precisa reconectar.
      throw new GoogleAdsApiError("Não foi possível renovar o acesso ao Google Ads. Reconecte a conta.", response.status, typeof payload.error === "string" ? payload.error : null);
    }
    this.accessToken = { value: payload.access_token, expiresAt: this.now() + (typeof payload.expires_in === "number" ? payload.expires_in : 3600) * 1000 };
    return this.accessToken.value;
  }

  private async request(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { authorization: `Bearer ${await this.token()}`, "content-type": "application/json" };
    if (this.credentials.developerToken) headers["developer-token"] = this.credentials.developerToken;
    if (this.credentials.loginCustomerId) headers["login-customer-id"] = normalizeCustomerId(this.credentials.loginCustomerId);
    const response = await this.fetcher(`https://googleads.googleapis.com/${this.version}/${path}`, {
      method: init.method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const info = describe(response.status, payload);
      throw new GoogleAdsApiError(`O Google Ads recusou a consulta (${info.code ?? response.status}).`, response.status, info.code);
    }
    return object(payload);
  }

  /** GAQL com paginação. Devolve todas as linhas. */
  async search(customerId: string, query: string, maxPages = 50): Promise<Array<Record<string, unknown>>> {
    const rows: Array<Record<string, unknown>> = [];
    let pageToken: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const body = await this.request(`customers/${normalizeCustomerId(customerId)}/googleAds:search`, { method: "POST", body: { query, ...(pageToken ? { pageToken } : {}) } });
      if (Array.isArray(body.results)) rows.push(...body.results.map(object));
      pageToken = typeof body.nextPageToken === "string" && body.nextPageToken ? body.nextPageToken : undefined;
      if (!pageToken) return rows;
    }
    throw new GoogleAdsApiError("A consulta ao Google Ads passou do limite de páginas.", 0, "PAGE_LIMIT");
  }

  /** Contas de anúncios sob a conta de gerente informada (ou sob o login atual). */
  async listManagedAccounts(managerCustomerId: string) {
    const rows = await this.search(managerCustomerId,
      "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.status FROM customer_client WHERE customer_client.level <= 1");
    return rows.flatMap(row => {
      const client = object(row.customerClient);
      const id = typeof client.id === "string" || typeof client.id === "number" ? String(client.id) : "";
      if (!id || client.manager === true) return [];
      return [{
        customerId: id, name: typeof client.descriptiveName === "string" && client.descriptiveName ? client.descriptiveName : `Conta ${id}`,
        currency: typeof client.currencyCode === "string" ? client.currencyCode : "BRL",
        timezone: typeof client.timeZone === "string" ? client.timeZone : "America/Sao_Paulo",
        status: typeof client.status === "string" ? client.status : "UNKNOWN",
      }];
    });
  }
}
