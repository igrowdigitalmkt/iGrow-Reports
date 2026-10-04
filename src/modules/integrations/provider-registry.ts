import type { ProviderConcurrency } from "./scheduler-policy";
import { providerConcurrency } from "./scheduler-policy";

export type ProviderDefinition = {
  id: string;
  displayName: string;
  hierarchyLevels: readonly ("account" | "campaign" | "adset" | "ad")[];
  supportsAsyncReports: boolean;
  expectedLatencyMinutes: number;
  concurrency: ProviderConcurrency;
};

const definitions: Record<string, ProviderDefinition> = {
  meta: { id: "meta", displayName: "Meta Ads", hierarchyLevels: ["account", "campaign", "adset", "ad"], supportsAsyncReports: true, expectedLatencyMinutes: 15, concurrency: providerConcurrency("meta") },
  google: { id: "google", displayName: "Google Ads", hierarchyLevels: ["account", "campaign", "adgroup", "ad"].filter((level): level is "account" | "campaign" | "adset" | "ad" => level !== "adgroup"), supportsAsyncReports: false, expectedLatencyMinutes: 30, concurrency: providerConcurrency("google") },
  tiktok: { id: "tiktok", displayName: "TikTok Ads", hierarchyLevels: ["account", "campaign", "adset", "ad"], supportsAsyncReports: true, expectedLatencyMinutes: 60, concurrency: providerConcurrency("tiktok") },
  linkedin: { id: "linkedin", displayName: "LinkedIn Ads", hierarchyLevels: ["account", "campaign", "adset", "ad"], supportsAsyncReports: false, expectedLatencyMinutes: 60, concurrency: providerConcurrency("linkedin") },
  youtube: { id: "youtube", displayName: "YouTube Analytics", hierarchyLevels: ["account", "campaign"], supportsAsyncReports: false, expectedLatencyMinutes: 30, concurrency: providerConcurrency("youtube") },
};

export function getProviderDefinition(provider: string): ProviderDefinition | null { return definitions[provider] ?? null; }
export function listProviderDefinitions(): ProviderDefinition[] { return Object.values(definitions); }
