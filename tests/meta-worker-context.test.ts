import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { CollectionIdentity } from "@/modules/integrations/data-contract";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/crypto", () => ({ decryptServerSecret: vi.fn(() => "test-token"), encryptServerSecret: vi.fn() }));
import { decryptServerSecret } from "@/lib/crypto";
import { loadMetaWorkerContext } from "@/modules/meta/server";

const identity: CollectionIdentity = { clientId: "client-a", connectionId: "connection-a", provider: "meta", externalAccountId: "act_123", dateFrom: "2026-10-01", dateTo: "2026-10-03", level: "campaign", apiVersion: "v24.0", contractVersion: 1 };
beforeEach(() => vi.clearAllMocks());

function setup(connectionId = "connection-a", missingAccount = false) {
  function query(data: unknown) {
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data, error: null })), limit: vi.fn(async () => ({ data, error: null })) };
  }
  const clients = query({ agency_id: "agency-a" });
  const integrations = query({ id: "integration-a", connection_status: "connected" });
  const connections = query([{ id: connectionId }]);
  const accounts = query(missingAccount ? null : { currency: "BRL", timezone_name: "America/Sao_Paulo" });
  const rpc = vi.fn(() => ({ single: async () => ({ data: { key_id: "key", nonce_b64: "nonce", ciphertext_b64: "cipher", auth_tag_b64: "tag" }, error: null }) }));
  const from = vi.fn((table: string) => ({ clients, integrations, meta_connections: connections, meta_ad_accounts: accounts })[table]);
  return { service: { from, rpc } as unknown as SupabaseClient<Database>, rpc, accounts, connections };
}

describe("Meta worker credential context", () => {
  it("loads the connection-scoped encrypted token and account metadata on the server", async () => {
    const { service, rpc, accounts, connections } = setup();
    const context = await loadMetaWorkerContext(service, identity);
    expect(context).toMatchObject({ currency: "BRL", timezone: "America/Sao_Paulo" });
    expect(connections.eq).toHaveBeenCalledWith("client_id", identity.clientId);
    expect(accounts.eq).toHaveBeenCalledWith("meta_connection_id", identity.connectionId);
    expect(accounts.eq).toHaveBeenCalledWith("external_id", identity.externalAccountId);
    expect(rpc).toHaveBeenCalledWith("get_integration_secret", expect.objectContaining({ p_agency_id: "agency-a", p_integration_id: "integration-a" }));
    expect(decryptServerSecret).toHaveBeenCalledWith(expect.objectContaining({ ciphertextB64: "cipher" }), expect.stringContaining("connection-a"));
  });

  it.each([["other-connection", false], ["connection-a", true]] as const)("rejects a mismatched connection or missing account before decrypting", async (connectionId, missingAccount) => {
    const { service, rpc } = setup(connectionId, missingAccount);
    await expect(loadMetaWorkerContext(service, identity)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
    expect(decryptServerSecret).not.toHaveBeenCalled();
  });
});
