import { beforeEach, expect, it, vi } from "vitest";
import { clientInputSchema } from "@/modules/clients/schema";
const mocks = vi.hoisted(() => ({ context: vi.fn(), from: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/modules/agencies/context", () => ({ requireAgencyContext: mocks.context }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { saveClient, setClientArchived } from "@/modules/clients/actions";
const agencyId = "aaaaaaaa-0000-4000-8000-000000000001";
const id = "11111111-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ role: "editor", agency: { id: agencyId }, supabase: { from: mocks.from } });
});
it("normaliza campos e rejeita nomes vazios ou observações excessivas", () => {
  expect(clientInputSchema.parse({ name: "  Aurora  ", notes: "  " })).toEqual({ name: "Aurora", notes: "" });
  expect(clientInputSchema.safeParse({ name: " ", notes: "" }).success).toBe(false);
  expect(clientInputSchema.safeParse({ name: "Aurora", notes: "a".repeat(10001) }).success).toBe(false);
});
it("nega escrita de leitor antes de acessar banco", async () => {
  mocks.context.mockResolvedValue({ role: "viewer" });
  expect(await saveClient({ name: "Aurora", notes: "", agencyId })).toHaveProperty("error");
  expect(await setClientArchived({ id, agencyId, archived: true })).toHaveProperty("error");
  expect(mocks.from).not.toHaveBeenCalled();
});
it("nega formulário de agência diferente da sessão", async () => {
  expect(await saveClient({ name: "Aurora", notes: "", agencyId: "bbbbbbbb-0000-4000-8000-000000000002" })).toHaveProperty("error");
  expect(mocks.from).not.toHaveBeenCalled();
});
it("edição usa agência autenticada e não altera cliente arquivado", async () => {
  const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  mocks.from.mockReturnValue(query);
  expect(await saveClient({ id, agencyId, name: "Aurora", notes: "" })).toHaveProperty("error");
  expect(query.eq).toHaveBeenCalledWith("agency_id", agencyId);
  expect(query.eq).toHaveBeenCalledWith("id", id);
  expect(query.is).toHaveBeenCalledWith("archived_at", null);
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("arquivamento preserva registro e revalida páginas após persistir", async () => {
  const row = { id, name: "Aurora", notes: null, archived_at: "2026-09-30", updated_at: "2026-09-30" };
  const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) };
  mocks.from.mockReturnValue(query);
  expect(await setClientArchived({ id, agencyId, archived: true })).toEqual({ client: row });
  expect(query.eq).toHaveBeenCalledWith("agency_id", agencyId);
  expect(query.update).toHaveBeenCalledWith({ archived_at: expect.any(String) });
  expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard/clientes");
});
