import { beforeEach, expect, it, vi } from "vitest";
import { consentInputSchema, recipientInputSchema } from "@/modules/clients/recipient-schema";
const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/modules/agencies/context", () => ({ requireAgencyContext: mocks.context }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { loadRecipients, recordRecipientConsent, saveRecipient } from "@/modules/clients/recipient-actions";
const agencyId = "aaaaaaaa-0000-4000-8000-000000000001";
const clientId = "11111111-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ role: "editor", agency: { id: agencyId }, supabase: { rpc: mocks.rpc, from: mocks.from } });
});
it.each(["11999999999", "+55 (11) 99999-9999", "+0123456789", "+5512", "+1234567890123456"])("rejeita telefone fora do formato internacional %s", phone => {
  expect(recipientInputSchema.safeParse({ name: "Pessoa", phone, active: true }).success).toBe(false);
});
it("normaliza nome sem inferir autorização", () => {
  expect(recipientInputSchema.parse({ name: " Pessoa ", phone: "+5511999999999", active: true })).toEqual({ name: "Pessoa", phone: "+5511999999999", active: true });
});
it("exige data válida e origem para autorização", () => {
  expect(consentInputSchema.safeParse({ granted: true, source: "Formulário", occurredAt: null }).success).toBe(false);
  expect(consentInputSchema.safeParse({ granted: true, source: "Formulário", occurredAt: new Date(Date.now() + 10 * 60000).toISOString() }).success).toBe(false);
  // A device clock slightly ahead of the server still counts as "now".
  expect(consentInputSchema.safeParse({ granted: true, source: "Formulário", occurredAt: new Date(Date.now() + 60000).toISOString() }).success).toBe(true);
  expect(consentInputSchema.safeParse({ granted: true, source: "", occurredAt: new Date().toISOString() }).success).toBe(false);
  expect(consentInputSchema.safeParse({ granted: false, source: "Solicitação", occurredAt: null }).success).toBe(true);
});
it("leitor não modifica destinatários nem consentimento", async () => {
  mocks.context.mockResolvedValue({ role: "viewer" });
  expect(await saveRecipient({})).toHaveProperty("error");
  expect(await recordRecipientConsent({})).toHaveProperty("error");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("agência do navegador não concede acesso", async () => {
  const other = "bbbbbbbb-0000-4000-8000-000000000002";
  expect(await loadRecipients({ agencyId: other, clientId })).toHaveProperty("error");
  expect(await saveRecipient({ agencyId: other, clientId, id: null, name: "Pessoa", phone: "+5511999999999", active: true })).toHaveProperty("error");
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.from).not.toHaveBeenCalled();
});
it("duplicata retorna erro compreensível sem detalhes internos", async () => {
  mocks.rpc.mockResolvedValue({ error: { code: "23505", message: "sensitive provider detail" } });
  expect(await saveRecipient({ agencyId, clientId, id: null, name: "Pessoa", phone: "+5511999999999", active: true })).toEqual({ error: "Este telefone já está cadastrado para o cliente." });
  expect(mocks.rpc).toHaveBeenCalledWith("save_client_recipient", expect.objectContaining({ p_agency_id: agencyId, p_client_id: clientId }));
});
