import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/whatsapp-qr/server", () => ({ createQrSender: vi.fn(), getQrStatus: vi.fn() }));

import { saveAlertRecipient, type SaveRecipientInput } from "@/modules/lead-pages/alerts-admin";
import type { Service } from "@/modules/lead-pages/hub-query";

const never = new Proxy({}, { get: () => { throw new Error("o banco não pode ser consultado antes da validação"); } }) as unknown as Service;
const valid: SaveRecipientInput = { agencyId: "a", clientId: "c", name: "Silvio", phone: "(91) 98074-8371", mode: "instant", sendTimes: [], weekdays: [0, 1, 2, 3, 4, 5, 6], campaignIds: null, formIds: null, consent: true, userId: null };

describe("cadastro de quem recebe alertas: validações antes de gravar", () => {
  it.each([
    ["nome curto", { name: "S" }],
    ["telefone inválido", { phone: "123" }],
    ["horário inválido", { mode: "scheduled" as const, sendTimes: ["9h"] }],
    ["resumo sem horário", { mode: "scheduled" as const, sendTimes: [] }],
    ["sem dia da semana", { weekdays: [] }],
    ["sem consentimento no cadastro novo", { consent: false }],
  ])("recusa %s sem tocar no banco", async (_label, patch) => {
    const result = await saveAlertRecipient(never, { ...valid, ...patch });
    expect(result.ok).toBe(false);
  });

  it("cadastro novo válido consulta o banco só depois de validar (e recusa número repetido)", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const service = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ limit: async () => ({ data: [{ id: "x" }] }) }) }) }) }), insert }) } as unknown as Service;
    const result = await saveAlertRecipient(service, valid);
    expect(result).toEqual({ ok: false, message: "Este número já está cadastrado neste cliente." });
    expect(insert).not.toHaveBeenCalled();
  });
});
