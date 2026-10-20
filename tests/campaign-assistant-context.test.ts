import { describe, expect, it } from "vitest";
import type { AssistantScope } from "@/modules/campaigns/assistant/contracts";
import { generalSelection, resolveContext, type ContextData } from "@/modules/campaigns/assistant/context";
import { conversationOf, conversationReducer, conversationsReducer, initialConversation, initialConversations } from "@/modules/campaigns/assistant/conversation";
import { getAssistantAvailability } from "@/modules/campaigns/assistant/availability";

const scope: AssistantScope = { organizationId: "org-1", clientId: "cli-1", platform: "meta" };
const row = (accountId: string, level: "campaign" | "adset" | "ad", id: string, name: string, parentId: string | null) => ({ key: `${level}:${id}`, id, level, name, parentId, accountId });
const data: ContextData = {
  accounts: [{ id: "acc-a", name: "Conta A" }, { id: "acc-b", name: "Conta B" }], selectedAccountIds: ["acc-a", "acc-b"], dateFrom: "2026-09-19", dateTo: "2026-10-18",
  rows: [
    row("acc-a", "campaign", "100", "Captação", null), row("acc-a", "adset", "200", "Público aberto", "100"), row("acc-a", "ad", "300", "Vídeo", "200"),
    // Mesmo ID e mesmo nome em outra conta: entidades diferentes.
    row("acc-b", "campaign", "100", "Captação", null),
  ],
};

describe("contexto do assistente", () => {
  it("sem seleção ou com seleção geral, o contexto é o do cliente", () => {
    for (const selection of [null, generalSelection(scope)]) {
      const { context, invalidated } = resolveContext(selection, scope, data);
      expect(invalidated).toBe(false);
      expect(context).toMatchObject({ level: "client", account: null, entity: null, accounts: [{ id: "acc-a", name: "Conta A" }, { id: "acc-b", name: "Conta B" }], period: { dateFrom: "2026-09-19", dateTo: "2026-10-18" } });
    }
  });
  it("contexto de conta, de campanha, de conjunto e de anúncio, com os ancestrais", () => {
    expect(resolveContext({ scope, kind: "account", accountId: "acc-b" }, scope, data).context).toMatchObject({ level: "account", account: { id: "acc-b", name: "Conta B" } });
    expect(resolveContext({ scope, kind: "entity", accountId: "acc-a", level: "campaign", entityId: "100" }, scope, data).context).toMatchObject({ level: "campaign", entity: { id: "100" }, ancestors: [] });
    const adset = resolveContext({ scope, kind: "entity", accountId: "acc-a", level: "adset", entityId: "200" }, scope, data).context;
    expect(adset.ancestors.map(item => item.id)).toEqual(["100"]);
    const ad = resolveContext({ scope, kind: "entity", accountId: "acc-a", level: "ad", entityId: "300" }, scope, data).context;
    expect(ad).toMatchObject({ level: "ad", account: { id: "acc-a" } });
    expect(ad.ancestors.map(item => `${item.level}:${item.id}`)).toEqual(["adset:200", "campaign:100"]);
  });
  it("entidades de contas diferentes com o mesmo ID e nome têm identidades diferentes", () => {
    const a = resolveContext({ scope, kind: "entity", accountId: "acc-a", level: "campaign", entityId: "100" }, scope, data).context;
    const b = resolveContext({ scope, kind: "entity", accountId: "acc-b", level: "campaign", entityId: "100" }, scope, data).context;
    expect(a.entity).toEqual(b.entity);
    expect(a.key).not.toBe(b.key);
    expect(a.key).toContain("org-1");
    expect(a.key).toContain("cli-1");
    expect(a.key).toContain("meta");
    expect(a.key).toContain("acc-a");
  });
  it("não aceita entidade que não pertence à conta informada", () => {
    const wrongAccount = resolveContext({ scope, kind: "entity", accountId: "acc-b", level: "adset", entityId: "200" }, scope, data);
    expect(wrongAccount.invalidated).toBe(true);
    expect(wrongAccount.context.level).toBe("client");
  });
  it("seleção de outro cliente, organização ou plataforma é invalidada", () => {
    const selection = { scope, kind: "entity", accountId: "acc-a", level: "campaign", entityId: "100" } as const;
    for (const other of [{ ...scope, clientId: "cli-2" }, { ...scope, organizationId: "org-2" }, { ...scope, platform: "google" as never }]) {
      const result = resolveContext(selection, other, data);
      expect(result.invalidated).toBe(true);
      expect(result.context.level).toBe("client");
      expect(result.context.scope).toEqual(other);
    }
  });
  it("conta fora do filtro atual ou entidade que sumiu dos dados volta ao contexto geral", () => {
    const filtered = { ...data, selectedAccountIds: ["acc-b"] };
    expect(resolveContext({ scope, kind: "account", accountId: "acc-a" }, scope, filtered).invalidated).toBe(true);
    expect(resolveContext({ scope, kind: "entity", accountId: "acc-a", level: "ad", entityId: "300" }, scope, filtered).invalidated).toBe(true);
    const gone = { ...data, rows: data.rows.filter(item => item.id !== "300") };
    expect(resolveContext({ scope, kind: "entity", accountId: "acc-a", level: "ad", entityId: "300" }, scope, gone).invalidated).toBe(true);
  });
});

describe("conversa e disponibilidade", () => {
  it("o assistente está indisponível nesta etapa e não há resposta simulada", () => {
    expect(getAssistantAvailability()).toMatchObject({ state: "unavailable", reason: "integration_pending" });
    expect(initialConversation).toEqual({ status: "idle", messages: [], error: null });
  });
  it("reducer registra envio, resposta, falha e reinício", () => {
    const message = (role: "user" | "assistant") => ({ id: role, role, content: "x", createdAt: "2026-10-19T00:00:00Z", contextKey: "k", status: "sent" as const });
    const sending = conversationReducer(initialConversation, { type: "user_sent", message: message("user") });
    expect(sending).toMatchObject({ status: "sending", messages: [{ id: "user" }] });
    expect(conversationReducer(sending, { type: "assistant_replied", message: message("assistant") })).toMatchObject({ status: "idle", messages: [{ id: "user" }, { id: "assistant" }] });
    expect(conversationReducer(sending, { type: "failed", error: "falhou" })).toMatchObject({ status: "error", error: "falhou", messages: [{ id: "user" }] });
    expect(conversationReducer(sending, { type: "reset" })).toEqual(initialConversation);
  });
});

describe("conjunto de contas faz parte da identidade", () => {
  it("o contexto geral considera as contas selecionadas e cada conjunto de contas é um contexto e uma conversa diferentes", () => {
    const only = (ids: string[]) => resolveContext(null, scope, { ...data, selectedAccountIds: ids }).context;
    const a = only(["acc-a"]), b = only(["acc-b"]), both = only(["acc-a", "acc-b"]), reversed = only(["acc-b", "acc-a"]);
    expect(a.accounts.map(account => account.id)).toEqual(["acc-a"]);
    expect(new Set([a.key, b.key, both.key]).size).toBe(3);
    expect(both.key).toBe(reversed.key);
    let state = initialConversations;
    state = conversationsReducer(state, { contextKey: both.key, action: { type: "user_sent", message: { id: "1", role: "user", content: "p", createdAt: "", contextKey: both.key, status: "sent" } } });
    expect(conversationOf(state, a.key).messages).toEqual([]);
    expect(conversationOf(state, both.key).messages).toHaveLength(1);
  });
  it("conta que saiu da seleção invalida a seleção de conta e de entidade", () => {
    const narrowed = { ...data, selectedAccountIds: ["acc-b"] };
    expect(resolveContext({ scope, kind: "account", accountId: "acc-a" }, scope, narrowed).invalidated).toBe(true);
    expect(resolveContext({ scope, kind: "entity", accountId: "acc-a", level: "campaign", entityId: "100" }, scope, narrowed).invalidated).toBe(true);
  });
});
