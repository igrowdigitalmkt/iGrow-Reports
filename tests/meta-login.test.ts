import { describe, expect, it } from "vitest";
import { selectedMetaAccounts } from "@/modules/meta/login-config";

describe("Meta login account selection", () => {
  const accounts = [{ id: "act_1" }, { id: "act_2" }, { id: "act_3" }];
  it("includes only the accounts explicitly chosen for the client", () => {
    expect(selectedMetaAccounts(accounts, ["act_2"])).toEqual([{ id: "act_2" }]);
    expect(selectedMetaAccounts(accounts)).toEqual(accounts);
  });
  it("rejects inaccessible, empty and duplicate selections", () => {
    expect(() => selectedMetaAccounts(accounts, ["act_4"])).toThrow();
    expect(() => selectedMetaAccounts(accounts, [])).toThrow();
    expect(() => selectedMetaAccounts(accounts, ["act_1", "act_1"])).toThrow();
  });
});
