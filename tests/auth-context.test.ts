import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), cookies: vi.fn(), redirect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { requireAgencyContext, requireUserSession } from "@/modules/agencies/context";

const user = { id: "user-a", email: "user-a@example.test" };
const ownMembership = { agency_id: "agency-a", role: "viewer", agencies: { id: "agency-a", name: "Agência A", timezone: "America/Sao_Paulo" } };

function authenticatedClient(memberships: unknown[] = [ownMembership], dbError: unknown = null) {
  const filter = vi.fn().mockResolvedValue({ data: memberships, error: dbError });
  const select = vi.fn().mockReturnValue({ eq: filter });
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockReturnValue({ select }),
  };
  mocks.createClient.mockResolvedValue(client);
  return { client, filter };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.cookies.mockResolvedValue({ get: () => ({ value: "agency-a" }) });
  mocks.redirect.mockImplementation((path: string) => { throw new Error(`REDIRECT:${path}`); });
});

describe("contexto da agência validado no servidor", () => {
  it("ausência de Supabase leva ao estado Não configurado", async () => {
    mocks.createClient.mockResolvedValue(null);
    await expect(requireUserSession()).rejects.toThrow("REDIRECT:/entrar?estado=nao-configurado");
  });

  it("não confia em cookie de agência sem identidade validada", async () => {
    const { client } = authenticatedClient();
    client.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(requireAgencyContext()).rejects.toThrow("REDIRECT:/entrar?next=");
    expect(client.from).not.toHaveBeenCalled();
  });

  it("reconsulta somente associações do usuário autenticado e preserva seu papel", async () => {
    const { filter } = authenticatedClient();
    const result = await requireAgencyContext();
    expect(filter).toHaveBeenCalledWith("user_id", user.id);
    expect(result.agency.id).toBe("agency-a");
    expect(result.role).toBe("viewer");
  });

  it("cookie adulterado não concede acesso à agência solicitada", async () => {
    authenticatedClient();
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "agency-victim" }) });
    expect((await requireAgencyContext()).agency.id).toBe("agency-a");
  });

  it("associação revogada encaminha para acesso pendente", async () => {
    authenticatedClient([]);
    await expect(requireAgencyContext()).rejects.toThrow("REDIRECT:/sem-acesso");
  });

  it("cookie desconhecido exige escolha entre múltiplas associações", async () => {
    authenticatedClient([ownMembership, { ...ownMembership, agency_id: "agency-b", agencies: { ...ownMembership.agencies, id: "agency-b" } }]);
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "agency-victim" }) });
    await expect(requireAgencyContext()).rejects.toThrow("REDIRECT:/selecionar-agencia");
  });

  it("falha do banco interrompe o acesso em vez de mostrar dados de demonstração", async () => {
    authenticatedClient([], { message: "database unavailable" });
    await expect(requireAgencyContext()).rejects.toThrow("Não foi possível consultar suas agências");
  });
});
