import { expect,it,vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { CollectionIdentity } from "@/modules/integrations/data-contract";
vi.mock("server-only",() => ({}));
import { readConfirmedCollectionSnapshot } from "@/modules/integrations/snapshot-reader";
import { SnapshotValidationError } from "@/modules/integrations/snapshot-validation-error";
import { CollectionSchemaUnavailableError } from "@/modules/integrations/collection-schema-error";

const identity: CollectionIdentity = { clientId: "c",connectionId: "i",provider: "meta",externalAccountId: "act_1",dateFrom: "2026-10-01",dateTo: "2026-10-03",level: "campaign",apiVersion: "v24.0",contractVersion: 1 };
it("queries the authenticated RPC with every identity dimension",async () => {
  const rpc = vi.fn(async () => ({ data: null,error: null }));
  expect(await readConfirmedCollectionSnapshot({ rpc } as unknown as SupabaseClient<Database>,identity)).toMatchObject({ status: "empty",entities: [] });
  expect(rpc).toHaveBeenCalledWith("get_confirmed_collection_snapshot", { p_client_id: "c",p_connection_id: "i",p_provider: "meta",p_external_account_id: "act_1",p_date_from: identity.dateFrom,p_date_to: identity.dateTo,p_entity_level: "campaign",p_api_version: "v24.0",p_contract_version: 1 });
});
it("does not turn denied reads or database outages into empty data",async () => {
  const rpc = vi.fn(async () => ({ data: null,error: { message: "private details" } }));
  await expect(readConfirmedCollectionSnapshot({ rpc } as unknown as SupabaseClient<Database>,identity)).rejects.toThrow("Não foi possível consultar");
});
it("classifies invalid stored metrics without copying their contents into the error",async () => {
  const rpc = vi.fn(async () => ({ data: { snapshotId: "s",collectedAt: "private invalid date",metrics: [] },error: null }));
  await expect(readConfirmedCollectionSnapshot({ rpc } as unknown as SupabaseClient<Database>,identity)).rejects.toBeInstanceOf(SnapshotValidationError);
});
it("distinguishes an unavailable RPC from missing snapshots",async () => {
  const rpc = vi.fn(async () => ({ data: null,error: { code: "PGRST202",message: "private details" } }));
  await expect(readConfirmedCollectionSnapshot({ rpc } as unknown as SupabaseClient<Database>,identity)).rejects.toBeInstanceOf(CollectionSchemaUnavailableError);
});
