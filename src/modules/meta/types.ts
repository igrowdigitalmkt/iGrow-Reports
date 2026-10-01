export type MetaAdminAccount = {
  id: string;
  externalId: string;
  name: string;
  currency: string;
  timezoneName: string;
  archivedAt: string | null;
  lastSyncedAt: string | null;
};

export type ClientAdAccountLink = {
  clientId: string;
  adAccountId: string;
  active: boolean;
};

export type ClientMetricMapping = {
  clientId: string;
  primaryMetricKey: "leads" | "conversations" | "purchases";
  primaryActionType: string;
  revenueActionType: string | null;
  mappingVersion: number;
};

export type MetaIntegrationStatus = {
  connectionStatus: "disconnected" | "connected" | "error";
  healthStatus: "unknown" | "healthy" | "degraded" | "error";
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
};

export type MetaServerReadiness = {
  databaseReady: boolean;
  serviceRoleConfigured: boolean;
  encryptionConfigured: boolean;
  apiVersion: string | null;
  ready: boolean;
};

export type MetaAdminSnapshot = {
  accounts: MetaAdminAccount[];
  links: ClientAdAccountLink[];
  mappings: ClientMetricMapping[];
  integration: MetaIntegrationStatus | null;
  serverReadiness: MetaServerReadiness;
};
