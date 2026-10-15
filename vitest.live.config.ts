import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Testes REAIS contra serviços de homologação/Sandbox (scripts/live). Fora do `pnpm test` e do `pnpm check`.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["scripts/live/**/*.live.test.ts"], testTimeout: 90_000, fileParallelism: false, sequence: { concurrent: false } },
});
