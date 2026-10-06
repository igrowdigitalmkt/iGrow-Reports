import type { ClientItem } from "@/modules/clients/schema";
import type { MetaAdminSnapshot } from "@/modules/meta/types";

// Fictitious Meta connections for the demo workspace. Never written to the database.
const at = "2026-10-06T09:00:00.000Z";
const names = ["Aurora Studio", "Verde & Grão", "Órbita Fit", "Casa Nativa", "Escola Horizonte", "Lumina Estética"];
export const demoMetaClients: ClientItem[] = names.map((name, index) => ({ id: `d4000000-0000-4000-8000-00000000000${index + 1}`, name, notes: null, archived_at: null, updated_at: at }));

const connection = (index: number) => ({
  id: `d5000000-0000-4000-8000-00000000000${index + 1}`, clientId: demoMetaClients[index].id, label: null,
  scopes: ["ads_read", "ads_management", "business_management", "read_insights", "pages_show_list", "pages_read_engagement", "instagram_basic", "public_profile"],
  connectedAt: "2026-09-12T14:20:00.000Z", lastAccountsSyncAt: at,
});
const account = (index: number, connectionIndex: number, name: string) => ({
  id: `d6000000-0000-4000-8000-00000000000${index}`, connectionId: connection(connectionIndex).id, externalId: `act_10${index}48261937`,
  name, currency: "BRL", timezoneName: "America/Sao_Paulo", archivedAt: null, lastSyncedAt: at,
});

export const demoMetaSnapshot: MetaAdminSnapshot = {
  connections: [0, 1, 2, 4].map(connection),
  accounts: [
    account(1, 0, "Aurora Studio · Principal"), account(2, 0, "Aurora Studio · Lançamentos"),
    account(3, 1, "Verde & Grão"), account(4, 2, "Órbita Fit"), account(5, 4, "Escola Horizonte · Matrículas"),
  ].filter(item => item.connectionId !== connection(2).id),
  links: [], mappings: [],
  integration: { connectionStatus: "connected", healthStatus: "healthy", lastCheckedAt: at, lastSuccessAt: at, lastErrorAt: null },
  serverReadiness: { oauthReady: true, databaseReady: true, serviceRoleConfigured: true, encryptionConfigured: true, apiVersion: "v26.0", ready: true },
};
