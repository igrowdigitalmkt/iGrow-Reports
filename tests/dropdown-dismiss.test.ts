import { describe, expect, it } from "vitest";
import { closeDropdownsOutside, DROPDOWN_DETAILS } from "@/components/ui/dropdown-dismiss";

type FakeMenu = { open: boolean; inside: object; removeAttribute: (name: string) => void; contains: (node: unknown) => boolean };
const menu = (): FakeMenu => {
  const inside = { nodeType: 1 };
  const item: FakeMenu = { open: true, inside, removeAttribute: () => { item.open = false; }, contains: node => node === inside };
  return item;
};
const root = (menus: FakeMenu[]) => ({ querySelectorAll: (selector: string) => (selector.includes("[open]") ? menus.filter(item => item.open) : []) }) as unknown as ParentNode;

describe("menus suspensos fecham ao clicar fora", () => {
  it("fecha os abertos quando o clique é fora e mantém o que contém o alvo", () => {
    const a = menu(), b = menu();
    closeDropdownsOutside(a.inside as EventTarget, root([a, b]));
    expect(a.open).toBe(true);
    expect(b.open).toBe(false);
  });
  it("clique fora de todos fecha todos; sem alvo (Esc) também", () => {
    const a = menu(), b = menu();
    closeDropdownsOutside({ nodeType: 1 } as unknown as EventTarget, root([a, b]));
    expect([a.open, b.open]).toEqual([false, false]);
    const c = menu();
    closeDropdownsOutside(null, root([c]));
    expect(c.open).toBe(false);
  });
  it("cobre os menus da plataforma (colunas, contas, qualidade dos dados, filtros e alertas)", () => {
    for (const name of ["campaigns-columns", "campaigns-accounts", "analytics-quality-menu", "analytics-filter-menu", "summary-alerts"]) expect(DROPDOWN_DETAILS).toContain(name);
  });
});
