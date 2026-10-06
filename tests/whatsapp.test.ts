import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseStatusEvents, validWebhookSignature } from "@/modules/whatsapp/webhook";
import { bodyParameterCount, bodyParameters, reportTemplates } from "@/modules/whatsapp/templates";

describe("webhook do WhatsApp", () => {
  const secret = "segredo-do-app";
  const body = JSON.stringify({ entry: [] });
  const sign = (value: string) => `sha256=${createHmac("sha256", secret).update(value).digest("hex")}`;

  it("aceita só corpos assinados com o segredo do app", () => {
    expect(validWebhookSignature(body, sign(body), secret)).toBe(true);
    expect(validWebhookSignature(body + " ", sign(body), secret)).toBe(false);
    expect(validWebhookSignature(body, null, secret)).toBe(false);
    expect(validWebhookSignature(body, sign(body), undefined)).toBe(false);
    expect(validWebhookSignature(body, "sha1=abc", secret)).toBe(false);
  });

  it("lê entregas, leituras e falhas e ignora o resto", () => {
    const events = parseStatusEvents({ entry: [{ changes: [{ value: {
      statuses: [
        { id: "wamid.A", status: "delivered", timestamp: "1791260000" },
        { id: "wamid.B", status: "failed", timestamp: "1791260001", errors: [{ code: 131026, title: "Message undeliverable" }] },
        { id: "wamid.C", status: "deleted", timestamp: "1791260002" },
      ],
      messages: [{ id: "wamid.in", type: "text" }],
    } }] }] });
    expect(events.map(event => [event.wamid, event.status])).toEqual([["wamid.A", "delivered"], ["wamid.B", "failed"]]);
    expect(events[1]).toMatchObject({ errorCode: "131026", errorMessage: "Message undeliverable" });
    expect(events[0].at).toBe(new Date(1791260000 * 1000).toISOString());
    expect(new Set(events.map(event => event.dedupKey)).size).toBe(2);
  });
});

describe("mensagens modelo", () => {
  const template = { name: "relatorio_desempenho", language: "pt_BR", status: "APPROVED", components: [
    { type: "HEADER", format: "DOCUMENT" }, { type: "BODY", text: "Olá, {{1}}! Relatório de {{2}} ({{3}})." },
  ] };

  it("usa só modelos aprovados com PDF no cabeçalho", () => {
    expect(reportTemplates([template, { ...template, name: "texto", components: [{ type: "BODY", text: "Oi" }] }, { ...template, status: "PENDING" }]).map(item => item.name)).toEqual(["relatorio_desempenho"]);
  });

  it("preenche as variáveis na ordem do modelo", () => {
    expect(bodyParameterCount(template)).toBe(3);
    expect(bodyParameters(3, { recipient: "Ana", client: "Colégio", period: "01/09 a 30/09", workspace: "iGrow" }).map(item => item.text)).toEqual(["Ana", "Colégio", "01/09 a 30/09"]);
  });
});
