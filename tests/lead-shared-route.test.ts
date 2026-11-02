import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => undefined }));

const access = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
const query = vi.hoisted(() => ({ queryBoard: vi.fn(), loadLeadEvents: vi.fn(), changeLeadStatus: vi.fn(), addLeadNote: vi.fn() }));
vi.mock("@/modules/lead-pages/hub-access", () => ({ authorizeLeadsLink: vi.fn(async () => access.value) }));
vi.mock("@/modules/lead-pages/hub-query", () => query);
vi.mock("@/modules/lead-pages/hub-sync", () => ({ syncStaleSources: vi.fn(async () => undefined) }));

import { GET, POST } from "@/app/api/leads/shared/route";

const LEAD = "33333333-3333-4333-8333-333333333333";
const base = { service: {}, clientId: "cl", clientName: "RM Imobiliária", canUpdate: false, restrictFormIds: ["100001"], actor: "Link: Equipe" };
const post = (body: unknown) => POST(new Request("https://x/api/leads/shared", { method: "POST", headers: { "x-lead-code": "c".repeat(24) }, body: JSON.stringify(body) }));

beforeEach(() => { Object.values(query).forEach(fn => fn.mockReset()); access.value = { ...base }; });

describe("rota do link compartilhado", () => {
  it("sem link válido, tudo responde 404 igual", async () => {
    access.value = null;
    expect((await GET(new Request("https://x/api/leads/shared"))).status).toBe(404);
    expect((await post({ action: "status", leadId: LEAD, status: "won" })).status).toBe(404);
    expect(query.queryBoard).not.toHaveBeenCalled();
  });
  it("lista com o escopo de formulários do link e informa se pode atualizar", async () => {
    query.queryBoard.mockResolvedValue({ total: 0, leads: [] });
    const response = await GET(new Request("https://x/api/leads/shared?status=won&formulario=100002"));
    expect(await response.json()).toMatchObject({ canUpdate: false, clientName: "RM Imobiliária" });
    expect(query.queryBoard).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ clientId: "cl", restrictFormIds: ["100001"], filters: expect.objectContaining({ status: ["won"], forms: ["100002"] }) }));
  });
  it("link só de leitura não muda status nem escreve notas", async () => {
    expect((await post({ action: "status", leadId: LEAD, status: "won" })).status).toBe(403);
    expect((await post({ action: "note", leadId: LEAD, body: "oi" })).status).toBe(403);
    expect(query.changeLeadStatus).not.toHaveBeenCalled();
    expect(query.addLeadNote).not.toHaveBeenCalled();
  });
  it("link com permissão muda status e anota, sempre no escopo do link e com o nome dele como autor", async () => {
    access.value = { ...base, canUpdate: true };
    query.changeLeadStatus.mockResolvedValue("ok");
    query.addLeadNote.mockResolvedValue("ok");
    expect((await post({ action: "status", leadId: LEAD, status: "visit" })).status).toBe(200);
    expect(query.changeLeadStatus).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ clientId: "cl", leadId: LEAD, restrictFormIds: ["100001"], status: "visit", actor: "Link: Equipe", userId: null }));
    expect((await post({ action: "note", leadId: LEAD, body: "Liguei" })).status).toBe(200);
    expect((await post({ action: "status", leadId: "nao-e-uuid", status: "won" })).status).toBe(400);
    expect((await post({ action: "status", leadId: LEAD, status: "inventado" })).status).toBe(400);
    expect((await post({ action: "x", leadId: LEAD })).status).toBe(400);
  });
  it("lead de fora do escopo responde 404", async () => {
    access.value = { ...base, canUpdate: true };
    query.changeLeadStatus.mockResolvedValue("not_found");
    expect((await post({ action: "status", leadId: LEAD, status: "won" })).status).toBe(404);
  });
});
