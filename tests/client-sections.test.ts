import { describe, expect, it } from "vitest";
import { clientSectionPath, isClientRoute, parseClientPath, SECTION_SLUGS, VALID_SECTION_SLUGS } from "@/modules/client-portal/client-sections";

const ID = "94e033bc-1fe7-4ddb-868d-e2f07b998dae";

describe("secoes do menu do cliente", () => {
  it("reconhece a secao e a raiz do cliente pelo endereco", () => {
    expect(parseClientPath(`/clientes/${ID}`)).toEqual({ base: `/clientes/${ID}`, section: "summary" });
    expect(parseClientPath(`/clientes/${ID}/`)).toEqual({ base: `/clientes/${ID}`, section: "summary" });
    expect(parseClientPath(`/clientes/${ID}/dashboard`)).toEqual({ base: `/clientes/${ID}`, section: "overview" });
    expect(parseClientPath(`/clientes/${ID}/campanhas`)?.section).toBe("campaigns");
    expect(parseClientPath(`/clientes/${ID}/metricas`)?.section).toBe("metrics");
    expect(parseClientPath(`/clientes/${ID}/relatorios`)?.section).toBe("reports");
    expect(parseClientPath(`/demo/clientes/${ID}/dashboard`)).toEqual({ base: `/demo/clientes/${ID}`, section: "overview" });
  });

  it("rejeita enderecos fora do menu do cliente", () => {
    expect(parseClientPath("/clientes")).toBeNull();
    expect(parseClientPath(`/clientes/${ID}/desconhecida`)).toBeNull();
    expect(parseClientPath(`/clientes/${ID}/dashboard/extra`)).toBeNull();
    expect(parseClientPath("/relatorios")).toBeNull();
    expect(parseClientPath(`/cliente/${ID}`)).toBeNull(); // portal do cliente final nao usa o menu
  });

  it("monta o endereco de cada secao e valida os segmentos aceitos", () => {
    const base = `/clientes/${ID}`;
    expect(clientSectionPath(base, "summary")).toBe(base);
    expect(clientSectionPath(base, "overview")).toBe(`${base}/dashboard`);
    expect(VALID_SECTION_SLUGS).toEqual(["dashboard", "campanhas", "metricas", "relatorios"]);
    expect(Object.keys(SECTION_SLUGS)).toHaveLength(5);
  });

  it("a barra principal recolhe em qualquer pagina de cliente, e so nelas", () => {
    expect(isClientRoute(`/clientes/${ID}`)).toBe(true);
    expect(isClientRoute(`/clientes/${ID}/relatorios`)).toBe(true);
    expect(isClientRoute(`/demo/clientes/${ID}`)).toBe(true);
    expect(isClientRoute("/clientes")).toBe(false);
    expect(isClientRoute("/relatorios")).toBe(false);
    expect(isClientRoute(`/cliente/${ID}`)).toBe(false);
  });
});
