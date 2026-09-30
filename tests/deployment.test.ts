import { describe, expect, it } from "vitest";
// @ts-expect-error JavaScript deployment validator also runs directly in Node before Next builds.
import { validateDeployment } from "../scripts/deployment-config.mjs";

const ready = {
  NEXT_PUBLIC_APP_URL: "https://igrow.example.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
  APP_ENV: "production", ENABLE_DEMO: "false", EXTERNAL_DELIVERIES_ENABLED: "false",
};
describe("publicação operacional", () => {
  it("aceita configuração completa", () => expect(validateDeployment(ready)).toEqual([]));
  it("bloqueia configuração ausente", () => expect(validateDeployment({})).toHaveLength(6));
  it.each(["http://igrow.example.com", "https://localhost", "https://user:pass@igrow.example.com", "https://igrow.example.com/path"])("rejeita origem %s", (url) => {
    expect(validateDeployment({ ...ready, NEXT_PUBLIC_APP_URL: url })).toHaveLength(1);
  });
  it("bloqueia credencial privilegiada sem exibir seu conteúdo", () => {
    const key = `a.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.c`;
    const errors = validateDeployment({ ...ready, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key });
    expect(errors).toHaveLength(1);
    expect(JSON.stringify(errors)).not.toContain(key);
  });
  it("bloqueia demonstração, envios e segredo público", () => {
    expect(validateDeployment({ ...ready, ENABLE_DEMO: "true", EXTERNAL_DELIVERIES_ENABLED: "true", NEXT_PUBLIC_META_APP_SECRET: "secret" })).toHaveLength(3);
  });
});
