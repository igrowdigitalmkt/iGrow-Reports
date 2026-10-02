export type MetaFetch = typeof fetch;

type MetaGraphErrorPayload = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    is_transient?: boolean;
    fbtrace_id?: string;
  };
};

type MetaPage<T> = MetaGraphErrorPayload & {
  data?: T[];
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
    next?: string;
  };
};

export type MetaIdentity = {
  id: string;
  name?: string;
};

export type MetaPermission = {
  permission: string;
  status: string;
};

export function hasMetaAdsReadPermission(scopes: string[]) {
  return scopes.includes("ads_read");
}

export type MetaAdAccount = {
  id: string;
  account_id?: string;
  name: string;
  currency: string;
  timezone_name: string;
  account_status?: number;
  business?: { id?: string; name?: string };
};

export function hasBusinessPortfolio(account: MetaAdAccount) {
  return /^\d+$/.test(account.business?.id ?? "");
}

export type MetaCampaign = {
  id: string;
  name: string;
  objective?: string;
  status?: string;
  effective_status?: string;
};

export type MetaAdSet = {
  id: string;
  name: string;
  campaign_id?: string;
  status?: string;
  effective_status?: string;
};

export type MetaAd = {
  id: string;
  name: string;
  adset_id?: string;
  campaign_id?: string;
  status?: string;
  effective_status?: string;
  creative?: { id?: string; thumbnail_url?: string };
};

export type MetaCreative = {
  id: string;
  name?: string;
  object_story_spec?: unknown;
  thumbnail_url?: string;
};

export type MetaAction = {
  action_type: string;
  value: string;
};

export type MetaInsight = {
  [key: string]: unknown;
  date_start: string;
  date_stop: string;
  account_id?: string;
  account_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  objective?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  clicks?: string;
  unique_clicks?: string;
  inline_link_clicks?: string;
  inline_post_engagement?: string;
  outbound_clicks?: MetaAction[];
  unique_outbound_clicks?: MetaAction[];
  video_play_actions?: MetaAction[];
  video_p25_watched_actions?: MetaAction[];
  video_p50_watched_actions?: MetaAction[];
  video_p75_watched_actions?: MetaAction[];
  video_p95_watched_actions?: MetaAction[];
  video_p100_watched_actions?: MetaAction[];
  actions?: MetaAction[];
  action_values?: MetaAction[];
};

export class MetaApiError extends Error {
  readonly httpStatus: number;
  readonly code: number | null;
  readonly subcode: number | null;
  readonly transient: boolean;

  constructor(input: {
    httpStatus: number;
    code?: number;
    subcode?: number;
    transient?: boolean;
  }) {
    super("A Meta Marketing API rejeitou a solicitação.");
    this.name = "MetaApiError";
    this.httpStatus = input.httpStatus;
    this.code = input.code ?? null;
    this.subcode = input.subcode ?? null;
    this.transient = input.transient ?? false;
  }
}

export type MetaClientOptions = {
  accessToken: string;
  apiVersion: string;
  timeoutMs?: number;
  fetchImpl?: MetaFetch;
  retryDelayMs?: number;
};

function validateVersion(version: string) {
  if (!/^v\d+\.\d+$/.test(version)) {
    throw new Error("Versão da Graph API inválida.");
  }
}

function validateAccountId(adAccountId: string) {
  if (!/^act_\d+$/.test(adAccountId)) {
    throw new Error("ID de conta de anúncios inválido.");
  }
}

function validateDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error("Data da consulta Meta inválida.");
  }
}

export class MetaClient {
  private readonly accessToken: string;
  private readonly apiVersion: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: MetaFetch;
  private readonly retryDelayMs: number;
  private readonly baseUrl = "https://graph.facebook.com";

  constructor(options: MetaClientOptions) {
    if (!options.accessToken.trim()) throw new Error("Token Meta obrigatório.");
    validateVersion(options.apiVersion);
    this.accessToken = options.accessToken;
    this.apiVersion = options.apiVersion;
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.retryDelayMs = options.retryDelayMs ?? 500;
  }

  private async getPage<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<MetaPage<T>> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.requestPage<T>(path, params);
      } catch (error) {
        const retryable = error instanceof MetaApiError && (error.transient
          || error.httpStatus === 429 || error.httpStatus >= 500
          || [1, 2, 4, 17, 32, 613].includes(error.code ?? 0));
        if (!retryable || attempt >= 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * 2 ** attempt));
      }
    }
  }

  private async requestPage<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<MetaPage<T>> {
    const url = new URL(
      `${this.baseUrl}/${this.apiVersion}/${path.replace(/^\/+/, "")}`,
    );
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/json",
        },
        signal: controller.signal,
        cache: "no-store",
      });

      let payload: MetaPage<T>;
      try {
        payload = await response.json() as MetaPage<T>;
      } catch {
        throw new MetaApiError({ httpStatus: response.status });
      }

      if (!response.ok || payload.error) {
        throw new MetaApiError({
          httpStatus: response.status,
          code: payload.error?.code,
          subcode: payload.error?.error_subcode,
          transient: payload.error?.is_transient,
        });
      }
      return payload;
    } catch (error) {
      if (error instanceof MetaApiError) throw error;
      // Network and abort errors never expose request URLs or credentials.
      throw new MetaApiError({ httpStatus: 504, transient: true });
    } finally {
      clearTimeout(timer);
    }
  }

  private async getAll<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T[]> {
    const result: T[] = [];
    let after: string | undefined;
    const seenCursors = new Set<string>();

    for (let page = 0; page < 1000; page += 1) {
      const payload = await this.getPage<T>(path, {
        ...params,
        ...(after ? { after } : {}),
      });
      if (!Array.isArray(payload.data)) throw new MetaApiError({ httpStatus: 502 });
      result.push(...(payload.data ?? []));
      if (!payload.paging?.next) return result;
      let nextAfter = payload.paging.cursors?.after;
      if (!nextAfter) {
        try {
          const nextUrl = new URL(payload.paging.next);
          if (nextUrl.origin !== this.baseUrl) throw new Error("invalid origin");
          nextAfter = nextUrl.searchParams.get("after") ?? undefined;
        } catch {
          throw new Error("Paginação Meta inválida.");
        }
      }
      if (!nextAfter || seenCursors.has(nextAfter)) {
        // A partial response must never be persisted as complete.
        throw new Error("Paginação Meta não avançou.");
      }
      seenCursors.add(nextAfter);
      after = nextAfter;
    }

    throw new Error("Paginação Meta excedeu o limite de segurança.");
  }

  async validateConnection(): Promise<MetaIdentity> {
    const payload = await this.getPage<never>("me", { fields: "id,name" });
    const identity = payload as unknown as MetaIdentity & MetaGraphErrorPayload;
    if (!identity.id) throw new MetaApiError({ httpStatus: 502 });
    return { id: identity.id, name: identity.name };
  }

  async listPermissions(): Promise<MetaPermission[]> {
    return this.getAll<MetaPermission>("me/permissions", { limit: "200" });
  }

  async getAdAccount(adAccountId: string): Promise<MetaAdAccount> {
    validateAccountId(adAccountId);
    const account = await this.getPage<never>(adAccountId, {
      fields: "id,account_id,name,currency,timezone_name,account_status,business{id,name}",
    }) as unknown as MetaAdAccount;
    if (account.id !== adAccountId) throw new MetaApiError({ httpStatus: 502 });
    return account;
  }

  async listAdAccounts(systemUserId?: string): Promise<MetaAdAccount[]> {
    const params = {
      fields: "id,account_id,name,currency,timezone_name,account_status,business{id,name}",
      limit: "200",
    };
    const accounts = await this.getAll<MetaAdAccount>("me/adaccounts", params);
    if (accounts.length || !systemUserId) return accounts;
    if (!/^\d+$/.test(systemUserId)) {
      throw new Error("ID de usuário do sistema Meta inválido.");
    }
    return this.getAll<MetaAdAccount>(`${systemUserId}/assigned_ad_accounts`, params);
  }

  async listCampaigns(adAccountId: string): Promise<MetaCampaign[]> {
    validateAccountId(adAccountId);
    return this.getAll<MetaCampaign>(`${adAccountId}/campaigns`, {
      filtering: JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED", "WITH_ISSUES", "IN_PROCESS"] }]),
      fields: "id,name,objective,status,effective_status",
      limit: "500",
    });
  }

  async listAdSets(adAccountId: string): Promise<MetaAdSet[]> {
    validateAccountId(adAccountId);
    return this.getAll<MetaAdSet>(`${adAccountId}/adsets`, {
      filtering: JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED", "CAMPAIGN_PAUSED", "WITH_ISSUES", "IN_PROCESS"] }]),
      fields: "id,name,campaign_id,status,effective_status",
      limit: "500",
    });
  }

  async listAds(adAccountId: string): Promise<MetaAd[]> {
    validateAccountId(adAccountId);
    return this.getAll<MetaAd>(`${adAccountId}/ads`, {
      filtering: JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "DISAPPROVED", "PENDING_REVIEW", "WITH_ISSUES", "IN_PROCESS"] }]),
      fields: "id,name,adset_id,campaign_id,status,effective_status,creative{id,thumbnail_url}",
      limit: "500",
    });
  }

  async listCreatives(adAccountId: string): Promise<MetaCreative[]> {
    validateAccountId(adAccountId);
    return this.getAll<MetaCreative>(`${adAccountId}/adcreatives`, {
      fields: "id,name,object_story_spec,thumbnail_url",
      limit: "200",
    });
  }

  async getDailyInsights(input: {
    adAccountId: string;
    since: string;
    until: string;
    level?: "account" | "campaign" | "adset" | "ad";
  }): Promise<MetaInsight[]> {
    validateAccountId(input.adAccountId);
    validateDate(input.since);
    validateDate(input.until);
    if (input.until < input.since) throw new Error("Período Meta inválido.");

    return this.getAll<MetaInsight>(`${input.adAccountId}/insights`, {
      level: input.level ?? "account",
      time_increment: "1",
      filtering: JSON.stringify([{ field: "ad.effective_status", operator: "IN", value: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "DISAPPROVED", "PENDING_REVIEW", "WITH_ISSUES", "IN_PROCESS"] }]),
      time_range: JSON.stringify({ since: input.since, until: input.until }),
      fields: [
        "date_start",
        "date_stop",
        "account_id",
        "account_name",
        "campaign_id",
        "campaign_name",
        "adset_id",
        "adset_name",
        "ad_id",
        "ad_name",
        "objective",
        "spend",
        "impressions",
        "reach",
        "frequency",
        "clicks",
        "unique_clicks",
        "inline_link_clicks",
        "inline_post_engagement",
        "outbound_clicks",
        "unique_outbound_clicks",
        "video_play_actions",
        "video_p25_watched_actions",
        "video_p50_watched_actions",
        "video_p75_watched_actions",
        "video_p95_watched_actions",
        "video_p100_watched_actions",
        "actions",
        "action_values",
      ].join(","),
      limit: "500",
    });
  }

  async getPeriodInsights(input: {
    adAccountId: string;
    since: string;
    until: string;
    adIds?: string[];
    level?: "account" | "campaign" | "adset" | "ad";
  }): Promise<MetaInsight[]> {
    validateAccountId(input.adAccountId);
    validateDate(input.since);
    validateDate(input.until);
    if (input.until < input.since) throw new Error("Período Meta inválido.");
    return this.getAll<MetaInsight>(`${input.adAccountId}/insights`, {
      level: input.level ?? "account",
      time_increment: "all_days",
      time_range: JSON.stringify({ since: input.since, until: input.until }),
      fields: "date_start,date_stop,account_id,campaign_id,adset_id,ad_id,spend,impressions,reach,frequency,clicks,unique_clicks,inline_link_clicks,inline_post_engagement,unique_inline_link_clicks,unique_inline_link_click_ctr,unique_ctr,outbound_clicks,unique_outbound_clicks,outbound_clicks_ctr,unique_outbound_clicks_ctr,actions,action_values,video_play_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p95_watched_actions,video_p100_watched_actions,social_spend",
      filtering: JSON.stringify([
        { field: "ad.effective_status", operator: "IN", value: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "DISAPPROVED", "PENDING_REVIEW", "WITH_ISSUES", "IN_PROCESS", "PENDING_BILLING_INFO", "PREAPPROVED"] },
        ...(input.adIds?.length ? [{ field: "ad.id", operator: "IN", value: input.adIds }] : []),
      ]),
      limit: "500",
    });
  }
}
