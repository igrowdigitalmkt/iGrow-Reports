import type { CollectionIdentity } from "../integrations/data-contract";

export type MetaJobInput = {
  clientId: string;
  connectionId: string;
  externalAccountId: string;
  dateFrom: string;
  dateTo: string;
  apiVersion: string;
  level?: CollectionIdentity["level"];
};

export function buildMetaCollectionIdentity(input: MetaJobInput): CollectionIdentity {
  return {
    clientId: input.clientId,
    connectionId: input.connectionId,
    provider: "meta",
    externalAccountId: input.externalAccountId,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    level: input.level ?? "campaign",
    apiVersion: input.apiVersion,
    contractVersion: 1,
  };
}
