import { createElement as h, Fragment } from "react";
import { describe, expect, it } from "vitest";
import { parseOptions, textOf } from "@/components/ui/select";

describe("opcoes da lista suspensa", () => {
  it("le option e optgroup na ordem, com valor, rotulo e desabilitado", () => {
    const groups = parseOptions(h(Fragment, null,
      h("option", { value: "" }, "Todas"),
      h("optgroup", { label: "Resultados" }, h("option", { value: "a" }, "A"), h("option", { value: "b", disabled: true }, "B")),
      h("option", { value: "z" }, "Z"),
    ));
    expect(groups.map(group => group.label)).toEqual([null, "Resultados", null]);
    expect(groups[0].options).toEqual([{ value: "", label: "Todas", disabled: false }]);
    expect(groups[1].options).toEqual([{ value: "a", label: "A", disabled: false }, { value: "b", label: "B", disabled: true }]);
    expect(groups[2].options[0].value).toBe("z");
  });

  it("usa o texto como valor quando a option nao tem value e aceita listas e fragmentos", () => {
    const items = ["x", "y"];
    const groups = parseOptions(h(Fragment, null, h("option", null, "Todos"), items.map(item => h("option", { key: item, value: item }, `Item ${item}`)), false, null));
    expect(groups).toHaveLength(1);
    expect(groups[0].options.map(option => [option.value, option.label])).toEqual([["Todos", "Todos"], ["x", "Item x"], ["y", "Item y"]]);
  });

  it("um optgroup desabilitado desabilita as opcoes dele e o texto junta os filhos", () => {
    const groups = parseOptions(h("optgroup", { label: "G", disabled: true }, h("option", { value: "1" }, "Um")));
    expect(groups[0].options[0].disabled).toBe(true);
    expect(textOf(h(Fragment, null, "Olá ", 1, h("b", null, "!")))).toBe("Olá 1!");
  });
});
