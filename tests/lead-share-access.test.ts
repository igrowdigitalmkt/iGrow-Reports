import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("@/modules/client-portal/context", () => ({ requireClientDashboardAccess: vi.fn() }));
vi.mock("@/modules/team/admin", () => ({ loadOwnModules: vi.fn() }));
vi.mock("@/modules/team/permissions", () => ({ canOpenSection: vi.fn(() => true) }));

const state = vi.hoisted(() => ({ links: [] as Record<string, unknown>[], clients: [] as Record<string, unknown>[], touched: [] as string[] }));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => {
      let column = ""; let value: unknown; let updating = false; let patch: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        select: () => builder, update: (next: Record<string, unknown>) => { updating = true; patch = next; return builder; },
        eq: (c: string, v: unknown) => { column = c; value = v; if (updating && table === "lead_share_links" && "last_opened_at" in patch) state.touched.push(String(v)); return builder; },
        maybeSingle: async () => ({ data: (table === "lead_share_links" ? state.links : state.clients).find(row => row[column] === value) ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      };
      return builder;
    },
  }),
}));

import { authorizeLeadsLink } from "@/modules/lead-pages/hub-access";
import { hashAccessCode } from "@/modules/lead-pages/leads";

const CODE = "codigo-secreto-de-teste-123";
const link = (over: Record<string, unknown> = {}) => ({ id: "l1", agency_id: "ag", client_id: "cl", name: "Equipe comercial", access_hash: hashAccessCode(CODE), form_ids: null, can_update: false, active: true, last_opened_at: null, ...over });

beforeEach(() => { state.links = [link()]; state.clients = [{ id: "cl", name: "RM Imobiliária", archived_at: null }]; state.touched = []; });

describe("acesso por link compartilhado", () => {
  it("código desconhecido, curto demais ou ausente nunca dá acesso", async () => {
    expect(await authorizeLeadsLink("codigo-errado-que-nao-existe-aqui")).toBeNull();
    expect(await authorizeLeadsLink("curto")).toBeNull();
    expect(await authorizeLeadsLink(null)).toBeNull();
    expect(await authorizeLeadsLink("x".repeat(200))).toBeNull();
  });
  it("link ativo dá só-leitura por padrão, no escopo do cliente, com o nome do link como autor", async () => {
    const access = await authorizeLeadsLink(CODE);
    expect(access).toMatchObject({ clientId: "cl", agencyId: "ag", clientName: "RM Imobiliária", via: "link", canManage: false, canUpdate: false, restrictFormIds: null, actor: "Link: Equipe comercial", userId: null });
  });
  it("escopo de formulários e permissão de atualizar vêm do link", async () => {
    state.links = [link({ form_ids: ["100001", "100002"], can_update: true })];
    expect(await authorizeLeadsLink(CODE)).toMatchObject({ canUpdate: true, restrictFormIds: ["100001", "100002"], canManage: false });
  });
  it("link revogado deixa de funcionar na hora", async () => {
    state.links = [link({ active: false })];
    expect(await authorizeLeadsLink(CODE)).toBeNull();
  });
  it("registra a última abertura no máximo a cada 10 minutos", async () => {
    await authorizeLeadsLink(CODE);
    expect(state.touched).toEqual([]);
    await authorizeLeadsLink(CODE, { touch: true });
    expect(state.touched).toEqual(["l1"]);
    state.links = [link({ last_opened_at: new Date().toISOString() })];
    state.touched = [];
    await authorizeLeadsLink(CODE, { touch: true });
    expect(state.touched).toEqual([]);
  });
});
