import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { adoptLinkCode, createLink, deleteLead, deleteLink, deleteSource, readLinkCode, rotateLinkCode, sameSourceName, updateLink, updateSource } from "@/modules/lead-pages/hub-admin";
import { accessCodeMatches, hashAccessCode } from "@/modules/lead-pages/leads";
import type { Service } from "@/modules/lead-pages/hub-query";

type Row = Record<string, unknown>;

/** Banco em memória: select/eq/maybeSingle, insert, update, delete, contagem (head) e select após update. */
function fakeService(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = { lead_share_links: [], lead_pages: [], lead_forms: [], leads: [], ...structuredClone(seed) };
  const from = (table: string) => {
    const tests: ((row: Row) => boolean)[] = [];
    let mode: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row = {};
    let head = false;
    let returning = false;
    const rows = () => (tables[table] ?? []).filter(row => tests.every(test => test(row)));
    const run = () => {
      if (mode === "insert") { tables[table] = [...(tables[table] ?? []), { ...payload }]; return { data: null, error: null }; }
      if (mode === "update") { const hit = rows(); hit.forEach(row => Object.assign(row, payload)); return { data: returning ? hit.map(row => ({ id: row.id })) : null, error: null }; }
      if (mode === "delete") { const hit = rows(); tables[table] = (tables[table] ?? []).filter(row => !hit.includes(row)); return { data: null, error: null }; }
      const list = rows();
      return { data: head ? null : list, error: null, count: list.length };
    };
    const builder: Record<string, unknown> = {
      select: (_c?: string, options?: { head?: boolean }) => { if (options?.head) head = true; returning = true; return builder; },
      insert: (value: Row) => { mode = "insert"; payload = value; return builder; },
      update: (value: Row) => { mode = "update"; payload = value; returning = false; return builder; },
      delete: () => { mode = "delete"; return builder; },
      eq: (column: string, value: unknown) => { tests.push(row => row[column] === value); return builder; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => void) => resolve(run()),
    };
    return builder;
  };
  const rpcCalls: { name: string; args: Row }[] = [];
  // Mesmo efeito da função do banco: apaga leads, histórico, formulários e a fonte; devolve quantos leads saíram.
  const rpc = async (name: string, args: Row) => {
    rpcCalls.push({ name, args });
    if (name === "delete_lead") { const hit = (tables.leads ?? []).some(row => row.id === args.p_lead_id); tables.leads = (tables.leads ?? []).filter(row => row.id !== args.p_lead_id); return { data: hit, error: null }; }
    const sourceId = args.p_source_id;
    const leadIds = (tables.leads ?? []).filter(row => row.lead_page_id === sourceId).map(row => row.id);
    tables.leads = (tables.leads ?? []).filter(row => row.lead_page_id !== sourceId);
    tables.lead_forms = (tables.lead_forms ?? []).filter(row => row.lead_page_id !== sourceId);
    tables.lead_pages = (tables.lead_pages ?? []).filter(row => row.id !== sourceId);
    return { data: leadIds.length, error: null };
  };
  return { service: { from, rpc } as unknown as Service, tables, rpcCalls };
}

const CLIENT = "cl-1";
const hash = hashAccessCode("codigo-original-do-link-123");
const link = (over: Row = {}): Row => ({ id: "L1", agency_id: "ag", client_id: CLIENT, name: "Equipe", access_hash: hash, form_ids: null, can_update: false, active: true, code_encrypted: null, ...over });

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY_ID", "k1");
  vi.stubEnv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
});

afterEach(() => { vi.unstubAllEnvs(); });

describe("links compartilhados: copiar, editar, ativar, trocar código e excluir", () => {
  it("criar guarda o código criptografado e o hash; o código volta a poder ser lido para copiar o link", async () => {
    const { service, tables } = fakeService({});
    const created = await createLink(service, { agencyId: "ag", clientId: CLIENT, name: "Corretor João", formIds: ["100001"], canUpdate: true, userId: null });
    expect(created.ok).toBe(true);
    const code = (created as { code: string }).code;
    const row = tables.lead_share_links[0]!;
    expect(row.access_hash).toBe(hashAccessCode(code));
    expect(JSON.stringify(row.code_encrypted)).not.toContain(code);
    expect(row).toMatchObject({ name: "Corretor João", form_ids: ["100001"], can_update: true });
    expect(await readLinkCode(service, { clientId: CLIENT, linkId: row.id as string })).toBe(code);
    expect(await readLinkCode(service, { clientId: "outro-cliente", linkId: row.id as string })).toBeNull();
  });
  it("link antigo (sem cópia) pode ser adotado com o código atual, sem mudar o endereço", async () => {
    const { service, tables } = fakeService({ lead_share_links: [link()] });
    expect(await readLinkCode(service, { clientId: CLIENT, linkId: "L1" })).toBeNull();
    expect(await adoptLinkCode(service, { clientId: CLIENT, linkId: "L1", code: "codigo-errado-que-nao-confere" })).toBe(false);
    expect(await adoptLinkCode(service, { clientId: CLIENT, linkId: "L1", code: "codigo-original-do-link-123" })).toBe(true);
    expect(tables.lead_share_links[0]!.access_hash).toBe(hash);
    expect(await readLinkCode(service, { clientId: CLIENT, linkId: "L1" })).toBe("codigo-original-do-link-123");
  });
  it("editar muda nome, formulários e permissão sem mexer no código; desativar e ativar alternam o acesso", async () => {
    const { service, tables } = fakeService({ lead_share_links: [link()] });
    expect(await updateLink(service, { clientId: CLIENT, linkId: "L1", name: "  Equipe comercial ", formIds: ["100001", "100002"], canUpdate: true })).toBe(true);
    expect(tables.lead_share_links[0]).toMatchObject({ name: "Equipe comercial", form_ids: ["100001", "100002"], can_update: true, access_hash: hash });
    expect(await updateLink(service, { clientId: CLIENT, linkId: "L1", formIds: [] })).toBe(true);
    expect(tables.lead_share_links[0]!.form_ids).toBeNull();
    await updateLink(service, { clientId: CLIENT, linkId: "L1", active: false });
    expect(tables.lead_share_links[0]).toMatchObject({ active: false });
    expect(tables.lead_share_links[0]!.revoked_at).toBeTruthy();
    await updateLink(service, { clientId: CLIENT, linkId: "L1", active: true });
    expect(tables.lead_share_links[0]).toMatchObject({ active: true, revoked_at: null });
  });
  it("não altera link de outro cliente", async () => {
    const { service, tables } = fakeService({ lead_share_links: [link({ client_id: "outro" })] });
    await updateLink(service, { clientId: CLIENT, linkId: "L1", name: "Invasão" });
    expect(tables.lead_share_links[0]!.name).toBe("Equipe");
    expect(await deleteLink(service, { clientId: CLIENT, linkId: "L1" })).toBe(false);
    expect(tables.lead_share_links).toHaveLength(1);
  });
  it("novo código invalida o antigo e devolve o novo", async () => {
    const { service, tables } = fakeService({ lead_share_links: [link()] });
    const rotated = await rotateLinkCode(service, { clientId: CLIENT, linkId: "L1" });
    expect(rotated.ok).toBe(true);
    const code = (rotated as { code: string }).code;
    expect(accessCodeMatches("codigo-original-do-link-123", tables.lead_share_links[0]!.access_hash as string)).toBe(false);
    expect(accessCodeMatches(code, tables.lead_share_links[0]!.access_hash as string)).toBe(true);
    expect(await readLinkCode(service, { clientId: CLIENT, linkId: "L1" })).toBe(code);
    expect(await rotateLinkCode(service, { clientId: "outro", linkId: "L1" })).toEqual({ ok: false });
  });
  it("excluir remove só o link do cliente", async () => {
    const { service, tables } = fakeService({ lead_share_links: [link(), link({ id: "L2", access_hash: hashAccessCode("outro-codigo-qualquer-123456") })] });
    expect(await deleteLink(service, { clientId: CLIENT, linkId: "L1" })).toBe(true);
    expect(tables.lead_share_links.map(item => item.id)).toEqual(["L2"]);
  });
});

describe("fontes de leads: editar e remover", () => {
  const source = (over: Row = {}): Row => ({ id: "S1", client_id: CLIENT, title: "Página antiga", form_id: null, ...over });
  it("editar muda o nome e o formulário da fonte do cliente", async () => {
    const { service, tables } = fakeService({ lead_pages: [source()] });
    expect(await updateSource(service, { clientId: CLIENT, sourceId: "S1", title: " Página da RM ", formId: "100001" })).toBe(true);
    expect(tables.lead_pages[0]).toMatchObject({ title: "Página da RM", form_id: "100001" });
    await updateSource(service, { clientId: "outro", sourceId: "S1", title: "Invasão", formId: null });
    expect(tables.lead_pages[0]!.title).toBe("Página da RM");
  });
  const ctx = { agencyId: "ag", userId: "u1" };
  it("o nome é comparado sem diferenciar maiúsculas nem espaços repetidos", () => {
    expect(sameSourceName("  página   ANTIGA ", "Página antiga")).toBe(true);
    expect(sameSourceName("Página", "Página antiga")).toBe(false);
  });
  it("exclui a fonte com todos os leads quando o nome é digitado igual, e registra na auditoria", async () => {
    const { service, tables, rpcCalls } = fakeService({ lead_pages: [source()], lead_forms: [{ lead_page_id: "S1", form_id: "100001" }], leads: [{ id: "a", lead_page_id: "S1" }, { id: "b", lead_page_id: "S1" }, { id: "c", lead_page_id: "S2" }] });
    expect(await deleteSource(service, { ...ctx, clientId: CLIENT, sourceId: "S1", confirmName: "página antiga" })).toEqual({ ok: true, leads: 2 });
    expect(rpcCalls).toHaveLength(1);
    expect(tables.lead_pages).toEqual([]);
    expect(tables.leads.map(row => row.id)).toEqual(["c"]);
    expect(tables.audit_logs[0]).toMatchObject({ action: "lead_source.deleted", metadata: { leads_deleted: 2, title: "Página antiga" } });
  });
  it("nome digitado diferente não exclui nada", async () => {
    const { service, tables, rpcCalls } = fakeService({ lead_pages: [source()], leads: [{ id: "a", lead_page_id: "S1" }] });
    const result = await deleteSource(service, { ...ctx, clientId: CLIENT, sourceId: "S1", confirmName: "Outra página" });
    expect(result).toMatchObject({ ok: false });
    expect(rpcCalls).toHaveLength(0);
    expect(tables.lead_pages).toHaveLength(1);
    expect(tables.leads).toHaveLength(1);
  });
  it("fonte de outro cliente não é encontrada", async () => {
    const { service, tables } = fakeService({ lead_pages: [source({ client_id: "outro" })] });
    expect(await deleteSource(service, { ...ctx, clientId: CLIENT, sourceId: "S1", confirmName: "Página antiga" })).toMatchObject({ ok: false, message: "Fonte de leads não encontrada." });
    expect(tables.lead_pages).toHaveLength(1);
  });
});

describe("excluir lead", () => {
  const ctx = { agencyId: "ag", clientId: CLIENT, userId: "u1" };
  it("exclui o lead do cliente e registra na auditoria sem dados pessoais", async () => {
    const { service, tables, rpcCalls } = fakeService({ leads: [{ id: "a", name: "Maria", phone: "+5511900000001" }, { id: "b" }] });
    expect(await deleteLead(service, { ...ctx, leadId: "a" })).toBe("ok");
    expect(rpcCalls[0]).toMatchObject({ name: "delete_lead", args: { p_client_id: CLIENT, p_lead_id: "a" } });
    expect(tables.leads.map(row => row.id)).toEqual(["b"]);
    expect(JSON.stringify(tables.audit_logs)).not.toContain("Maria");
    expect(tables.audit_logs[0]).toMatchObject({ action: "lead.deleted", entity_id: "a" });
  });
  it("lead que não é do cliente não existe para quem pede", async () => {
    const { service, tables } = fakeService({ leads: [] });
    expect(await deleteLead(service, { ...ctx, leadId: "x" })).toBe("not_found");
    expect(tables.audit_logs ?? []).toEqual([]);
  });
});
