import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  clientRow: null as null | { id: string; agency_id: string; name: string; logo_path: null; archived_at: null },
  memberships: [] as Array<{ agency: { id: string; name: string; timezone: string }; role: string }>,
  portal: [] as Array<{ id: string; agency_id: string; name: string; logo_path: null; archived_at: null }>,
  redirected: null as string | null,
}));

vi.mock("next/navigation", () => ({ redirect: (to: string) => { state.redirected = to; throw new Error("REDIRECT:" + to); } }));
vi.mock("@/modules/auth/password-state", () => ({ needsPasswordSetup: () => false }));
vi.mock("@/modules/agencies/context", () => ({
  requireUserSession: async () => ({
    user: { id: "u1" },
    supabase: {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.clientRow, error: null }) }) }) }),
      rpc: async () => ({ data: state.portal, error: null }),
    },
  }),
  getRequestMemberships: async () => state.memberships,
}));

import { requireClientDashboardAccess } from "@/modules/client-portal/context";

const client = { id: "c1", agency_id: "ag1", name: "Cliente", logo_path: null, archived_at: null } as const;

beforeEach(() => { state.clientRow = null; state.memberships = []; state.portal = []; state.redirected = null; });

describe("acesso ao painel do cliente", () => {
  it("membro da organização do cliente entra no modo equipe, com o perfil dele", async () => {
    state.clientRow = { ...client }; state.memberships = [{ agency: { id: "ag1", name: "A", timezone: "America/Sao_Paulo" }, role: "viewer" }];
    const access = await requireClientDashboardAccess("c1");
    expect(access).toMatchObject({ agencyMode: true, workspaceRole: "viewer", canCollect: false, canManageReports: false });
    state.memberships = [{ agency: { id: "ag1", name: "A", timezone: "America/Sao_Paulo" }, role: "admin" }];
    expect(await requireClientDashboardAccess("c1")).toMatchObject({ agencyMode: true, canCollect: true, canManageReports: true });
  });
  it("quem é de OUTRA organização não vira equipe: só entra se tiver acesso de cliente (portal)", async () => {
    state.clientRow = { ...client }; state.memberships = [{ agency: { id: "outra", name: "B", timezone: "America/Sao_Paulo" }, role: "owner" }];
    await expect(requireClientDashboardAccess("c1")).rejects.toThrow("REDIRECT:/cliente?estado=sem-acesso");
    state.portal = [{ ...client }];
    expect(await requireClientDashboardAccess("c1")).toMatchObject({ agencyMode: false, workspaceRole: null, canCollect: false, canManageReports: false });
  });
  it("cliente que o banco não mostra (sem permissão) cai no portal e, sem acesso, é recusado", async () => {
    state.clientRow = null; state.memberships = [];
    await expect(requireClientDashboardAccess("c1")).rejects.toThrow("REDIRECT:/cliente?estado=sem-acesso");
    expect(state.redirected).toBe("/cliente?estado=sem-acesso");
  });
});
