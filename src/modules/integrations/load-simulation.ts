import type { CollectionIdentity } from "./data-contract";
import { collectionPriority } from "./scheduler-policy";

export type SyntheticClientWorkload = {
  clientId: string;
  jobs: CollectionIdentity[];
  priority: number;
};

export function buildSyntheticWorkload(clientCount: number, provider = "meta"): SyntheticClientWorkload[] {
  return Array.from({ length: clientCount }, (_, index) => {
    const clientId = `synthetic-client-${index + 1}`;
    const identity: CollectionIdentity = {
      clientId, connectionId: `connection-${index + 1}`, provider,
      externalAccountId: `act_${index + 1}`, dateFrom: "2026-10-01", dateTo: "2026-10-03",
      level: "campaign", apiVersion: "v24.0", contractVersion: 1,
    };
    return { clientId, jobs: [identity], priority: collectionPriority({ ...identity, isRecent: true }) };
  });
}

export function assertWorkloadIsolation(workload: SyntheticClientWorkload[]): boolean {
  const keys = new Set<string>();
  for (const client of workload) {
    for (const job of client.jobs) {
      if (job.clientId !== client.clientId) return false;
      const key = `${job.clientId}:${job.externalAccountId}:${job.dateFrom}:${job.dateTo}`;
      if (keys.has(key)) return false;
      keys.add(key);
    }
  }
  return true;
}
