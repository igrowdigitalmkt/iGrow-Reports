import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("@/modules/agencies/context", () => ({
  requireAgencyContext: mocks.context,
}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidate,
}));

import { setClientPortalAccess } from "@/modules/client-portal/actions";

const agencyId = "aaaaaaaa-0000-4000-8000-000000000021";
const clientId = "11111111-0000-4000-8000-000000000021";
const userId = "10000000-0000-4000-8000-000000000021";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.context.mockResolvedValue({
    role: "owner",
    agency: { id: agencyId },
    supabase: { rpc: mocks.rpc },
  });
});

it("restringe gestão de acesso a proprietário e administrador", async () => {
  mocks.context.mockResolvedValue({ role: "editor" });
  expect(await setClientPortalAccess({ agencyId, clientId, userId, active: true }))
    .toHaveProperty("error");
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("não aceita agência enviada pelo navegador como autorização", async () => {
  expect(await setClientPortalAccess({
    agencyId: "bbbbbbbb-0000-4000-8000-000000000022",
    clientId,
    userId,
    active: true,
  })).toHaveProperty("error");
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("usa a agência autenticada ao conceder acesso", async () => {
  expect(await setClientPortalAccess({ agencyId, clientId, userId, active: true }))
    .toEqual({ success: true });
  expect(mocks.rpc).toHaveBeenCalledWith("set_client_user_access", {
    p_agency_id: agencyId,
    p_client_id: clientId,
    p_user_id: userId,
    p_active: true,
  });
  expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard/clientes");
});

it("não expõe detalhes internos do banco quando a RPC falha", async () => {
  mocks.rpc.mockResolvedValue({
    error: { code: "23503", message: "sensitive database detail" },
  });
  expect(await setClientPortalAccess({ agencyId, clientId, userId, active: true }))
    .toEqual({
      error: "Não foi possível liberar o acesso. Confira o cliente e a conta do usuário.",
    });
});
