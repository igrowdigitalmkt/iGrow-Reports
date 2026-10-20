import { describe, expect, it, vi } from "vitest";
import type { AssistantContext } from "@/modules/campaigns/assistant/contracts";
import { resolveContext } from "@/modules/campaigns/assistant/context";
import { CONVERSATION_LIMITS, conversationOf, conversationsReducer, initialConversations, type ConversationsAction, type ConversationsState } from "@/modules/campaigns/assistant/conversation";
import { sendQuestion } from "@/modules/campaigns/assistant/send";
import type { AssistantAskResult } from "@/modules/campaigns/assistant/request";
import type { AssistantTransport } from "@/modules/campaigns/assistant/transport";
import { campaignsData, IDS } from "./campaign-assistant-fixtures";

const scope = { organizationId: IDS.org, clientId: IDS.client, platform: "meta" as const };
const ctx = (selection: Parameters<typeof resolveContext>[0], over = {}): AssistantContext => resolveContext(selection, scope, campaignsData(over)).context;
const campaign = (accountId = IDS.accA, id = "100") => ({ scope, kind: "entity", accountId, level: "campaign", entityId: id }) as const;

function harness() {
  let state: ConversationsState = initialConversations;
  const dispatch = (action: ConversationsAction) => { state = conversationsReducer(state, action); };
  return { dispatch, get state() { return state; } };
}
const replyFor = (context: AssistantContext, text = "Resposta"): AssistantAskResult => ({ ok: true, reply: { text, contextKey: context.key, factsHash: "h", generatedAt: "2026-10-19T15:00:00.000Z" } });

describe("identidade do contexto inclui o período", () => {
  it("a mesma entidade em outro período é outro contexto", () => {
    const a = ctx(campaign());
    const b = ctx(campaign(), { dateFrom: "2026-08-01", dateTo: "2026-08-31" });
    expect(a.key).not.toBe(b.key);
    expect(a.key.endsWith("2026-09-19..2026-10-18")).toBe(true);
    expect(ctx(null).key).not.toBe(ctx(null, { dateTo: "2026-10-17" }).key);
  });
  it("a mesma campanha homônima em outra conta continua sendo outro contexto", () => {
    expect(ctx(campaign(IDS.accA)).key).not.toBe(ctx(campaign(IDS.accB)).key);
  });
});

describe("conversas isoladas por contexto", () => {
  it("trocar de entidade, conta ou período mostra uma conversa vazia, nunca a de outro contexto", async () => {
    const h = harness();
    const first = ctx(campaign());
    const transport: AssistantTransport = { send: async () => replyFor(first, "Resposta sobre a campanha 100") };
    await sendQuestion({ context: first, text: "Analise", history: [], transport, dispatch: h.dispatch });
    expect(conversationOf(h.state, first.key).messages.map(m => m.role)).toEqual(["user", "assistant"]);
    for (const other of [ctx(campaign(IDS.accB)), ctx({ scope, kind: "account", accountId: IDS.accA }), ctx(null), ctx(campaign(), { dateFrom: "2026-08-01", dateTo: "2026-08-31" })]) {
      expect(conversationOf(h.state, other.key).messages).toEqual([]);
    }
  });
  it("resposta que chega depois da troca de contexto fica no contexto de origem", async () => {
    const h = harness();
    const origin = ctx(campaign());
    let release: (value: AssistantAskResult) => void = () => {};
    const transport: AssistantTransport = { send: () => new Promise(resolve => { release = resolve; }) };
    const pending = sendQuestion({ context: origin, text: "Analise", history: [], transport, dispatch: h.dispatch });
    const current = ctx(null);
    expect(conversationOf(h.state, origin.key).status).toBe("sending");
    expect(conversationOf(h.state, current.key).status).toBe("idle");
    release(replyFor(origin, "Resposta tardia"));
    await pending;
    expect(conversationOf(h.state, origin.key).messages.at(-1)).toMatchObject({ role: "assistant", content: "Resposta tardia", contextKey: origin.key });
    expect(conversationOf(h.state, current.key).messages).toEqual([]);
  });
  it("resposta com chave diferente da de origem (outro período, conta ou organização) é descartada", async () => {
    const h = harness();
    const origin = ctx(campaign());
    for (const wrong of [ctx(campaign(), { dateFrom: "2026-08-01", dateTo: "2026-08-31" }), ctx(campaign(IDS.accB)), ctx(null)]) {
      await sendQuestion({ context: origin, text: "Analise", history: [], transport: { send: async () => replyFor(wrong) }, dispatch: h.dispatch });
    }
    const state = conversationOf(h.state, origin.key);
    expect(state.messages.every(m => m.role === "user")).toBe(true);
    expect(state.status).toBe("error");
    expect(state.error).toContain("descartada");
  });
  it("falhas do servidor e do transporte viram erro no contexto de origem, sem resposta fictícia", async () => {
    const h = harness();
    const origin = ctx(campaign());
    await sendQuestion({ context: origin, text: "a", history: [], transport: { send: async () => ({ ok: false, code: "forbidden", message: "Sem acesso" }) }, dispatch: h.dispatch });
    expect(conversationOf(h.state, origin.key)).toMatchObject({ status: "error", error: "Sem acesso" });
    await sendQuestion({ context: origin, text: "b", history: [], transport: { send: async () => { throw new Error("rede"); } }, dispatch: h.dispatch });
    expect(conversationOf(h.state, origin.key).status).toBe("error");
    expect(conversationOf(h.state, origin.key).messages.every(m => m.role === "user")).toBe(true);
  });
  it("o histórico enviado é só o do contexto ativo e limitado", async () => {
    const h = harness();
    const origin = ctx(campaign());
    const send = vi.fn(async () => replyFor(origin));
    for (let i = 0; i < 6; i++) await sendQuestion({ context: origin, text: `p${i}`, history: conversationOf(h.state, origin.key).messages, transport: { send }, dispatch: h.dispatch });
    const lastRequest = (send.mock.calls.at(-1) as unknown as [{ history: unknown[] }])[0];
    expect(lastRequest.history.length).toBeLessThanOrEqual(6);
    const foreign = ctx(campaign(IDS.accB));
    await sendQuestion({ context: foreign, text: "outra", history: conversationOf(h.state, origin.key).messages, transport: { send }, dispatch: h.dispatch });
    expect((send.mock.calls.at(-1) as unknown as [{ history: unknown[] }])[0].history).toEqual([]);
  });
});

describe("limites de memória da conversa", () => {
  it("mantém no máximo 20 mensagens por contexto e 8 contextos", () => {
    let state = initialConversations;
    const key = "k";
    for (let i = 0; i < 30; i++) state = conversationsReducer(state, { contextKey: key, action: { type: "user_sent", message: { id: String(i), role: "user", content: String(i), createdAt: "", contextKey: key, status: "sent" } } });
    expect(conversationOf(state, key).messages).toHaveLength(CONVERSATION_LIMITS.messagesPerContext);
    expect(conversationOf(state, key).messages[0]!.content).toBe("10");
    for (let i = 0; i < 12; i++) state = conversationsReducer(state, { contextKey: `c${i}`, action: { type: "reset" } });
    expect(Object.keys(state.byContext)).toHaveLength(CONVERSATION_LIMITS.contexts);
    expect(state.byContext["c11"]).toBeDefined();
    expect(state.byContext[key]).toBeUndefined();
  });
});

describe("falhas que suspendem o envio nesta tela", () => {
  const origin = ctx(campaign());
  const run = (result: AssistantAskResult) => { const h = harness(); return sendQuestion({ context: origin, text: "a", history: [], transport: { send: async () => result }, dispatch: h.dispatch }).then(outcome => ({ outcome, state: conversationOf(h.state, origin.key) })); };
  it("contabilização comprometida suspende o envio e mostra o erro, sem resposta", async () => {
    const { outcome, state } = await run({ ok: false, code: "accounting_failed", message: "consumo não registrado", possibleCharge: true });
    expect(outcome.suspended).toBe("consumo não registrado");
    expect(state).toMatchObject({ status: "error", error: "consumo não registrado" });
    expect(state.messages.every(m => m.role === "user")).toBe(true);
  });
  it("assistente indisponível suspende; erros comuns não suspendem", async () => {
    expect((await run({ ok: false, code: "assistant_unavailable", message: "indisponível" })).outcome.suspended).toBe("indisponível");
    expect((await run({ ok: false, code: "busy", message: "ocupado" })).outcome.suspended).toBeNull();
    expect((await run({ ok: false, code: "model_error", message: "falhou", possibleCharge: true })).outcome.suspended).toBeNull();
  });
  it("falha de comunicação avisa que a chamada pode ter sido processada", async () => {
    const h = harness();
    await sendQuestion({ context: origin, text: "a", history: [], transport: { send: async () => { throw new Error("rede"); } }, dispatch: h.dispatch });
    expect(conversationOf(h.state, origin.key).error).toContain("pode ter sido processada");
  });
  it("cada pergunta usa um identificador de solicitação diferente", async () => {
    const send = vi.fn(async () => replyFor(origin));
    const h = harness();
    await sendQuestion({ context: origin, text: "a", history: [], transport: { send }, dispatch: h.dispatch });
    await sendQuestion({ context: origin, text: "a", history: [], transport: { send }, dispatch: h.dispatch });
    const ids = send.mock.calls.map(call => (call as unknown as [{ requestId: string }])[0].requestId);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
  });
});
