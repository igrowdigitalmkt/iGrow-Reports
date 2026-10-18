import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

// The actual React hook and checkbox component run in Chrome, with all network
// requests intercepted. No Next/auth bypass or production test route is added.
let browser: Browser;
let page: Page;
let bundle: string;
const chat = "44444444-4444-4444-8444-444444444444";
type List = { id: string; name: string; color: string; sortOrder: number; conversationIds: string[] };
let lists: Record<string, List[]>;
let writes: number;
let completedWrites: number;
let beforeWrite: (() => Promise<void>) | undefined;
let rejectWrite: boolean;
let malformedRead: boolean;
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const vitePath = createRequire(require.resolve("vitest/package.json")).resolve("vite");
  const { build } = await import(pathToFileURL(vitePath).href) as {
    build(options: unknown): Promise<Array<{ output: Array<{ type: string; code?: string }> }>>;
  };
  const built = await build({ configFile: false, logLevel: "error", define: { "process.env.NODE_ENV": JSON.stringify("test") },
    build: { write: false, minify: false, lib: { entry: resolve("tests/fixtures/whatsapp-labels-browser.tsx"), formats: ["iife"], name: "LabelsHarness" } } });
  bundle = built.flatMap(output => output.output).map(chunk => chunk.code ?? "").join("\n");
  browser = await chromium.launch({ channel: "chrome", headless: true });
}, 60_000);

beforeEach(async () => {
  lists = {
    qr: [{ id: "wa:4", name: "QR", color: "#c15add", sortOrder: 0, conversationIds: [] }],
    official: [{ id: "11111111-1111-4111-8111-111111111111", name: "Oficial", color: "#c15add", sortOrder: 0, conversationIds: [] }],
  };
  writes = 0; completedWrites = 0; beforeWrite = undefined; rejectWrite = false; malformedRead = false;
  page = await browser.newPage();
  await page.clock.install();
  await page.route("**/*", async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    if (!url.pathname.startsWith("/api/whatsapp/inbox/")) return route.abort();
    const channel = url.pathname.endsWith("/native-labels") ? "qr" : "official";
    if (request.method() === "GET") return route.fulfill({ json: malformedRead ? {} : { lists: structuredClone(lists[channel]) } });
    writes++;
    await beforeWrite?.();
    if (rejectWrite) return route.fulfill({ status: 503, json: { error: "Gravação rejeitada" } });
    const body = request.postDataJSON();
    if (request.method() === "PATCH") {
      lists[channel][0].conversationIds = body.member ? [chat] : [];
    }
    completedWrites++;
    return route.fulfill({ json: request.method() === "POST" ? { id: "wa:5" } : { ok: true } });
  });
  await page.goto("http://labels.test/");
  await page.addScriptTag({ content: bundle });
  await browserExpect(page.getByRole("checkbox")).toBeVisible();
});
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); });

it("mantém alterações da plataforma após consultas e recarregamento", async () => {
  await page.getByRole("checkbox").check();
  await browserExpect(page.getByTestId("busy")).toHaveText("false");
  await page.getByRole("button", { name: "Consultar", exact: true }).click();
  await browserExpect(page.getByRole("checkbox")).toBeChecked();
  await page.reload(); await page.addScriptTag({ content: bundle });
  await browserExpect(page.getByRole("checkbox")).toBeChecked();
  await page.getByRole("checkbox").uncheck();
  await browserExpect(page.getByTestId("busy")).toHaveText("false");
  await page.getByRole("button", { name: "Consultar", exact: true }).click();
  await browserExpect(page.getByRole("checkbox")).not.toBeChecked();
  expect(writes).toBe(2);
}, 30_000);

it("mantém alterações do celular depois de vários ciclos de consulta", async () => {
  lists.qr[0].conversationIds = [chat];
  await page.clock.runFor(15_001);
  await browserExpect(page.getByRole("checkbox")).toBeChecked();
  lists.qr[0].conversationIds = [];
  await page.clock.runFor(15_001);
  await browserExpect(page.getByRole("checkbox")).not.toBeChecked();
  await page.clock.runFor(30_001);
  await browserExpect(page.getByRole("checkbox")).not.toBeChecked();
  expect(writes).toBe(0);
}, 30_000);

it("encerra pendências ao trocar de canal durante uma gravação e aceita o próximo estado externo", async () => {
  const ack = deferred(); beforeWrite = () => ack.promise;
  await page.getByRole("checkbox").check();
  await browserExpect(page.getByTestId("busy")).toHaveText("true");
  await page.getByRole("button", { name: "Trocar canal" }).click();
  await browserExpect(page.getByText("Oficial", { exact: true })).toBeVisible();
  ack.release();
  await browserExpect.poll(() => completedWrites).toBe(1);
  await browserExpect(page.getByTestId("busy")).toHaveText("false");
  await page.getByRole("button", { name: "Trocar canal" }).click();
  await browserExpect(page.getByText("QR", { exact: true })).toBeVisible();
  lists.qr[0].conversationIds = [];
  await page.clock.runFor(15_001);
  await browserExpect(page.getByRole("checkbox")).not.toBeChecked();
}, 30_000);

it("não substitui a lista do canal atual pela consulta de uma criação do canal anterior", async () => {
  const ack = deferred(); beforeWrite = () => ack.promise;
  await page.getByRole("button", { name: "Criar", exact: true }).click();
  await browserExpect(page.getByTestId("busy")).toHaveText("true");
  await page.getByRole("button", { name: "Trocar canal" }).click();
  await browserExpect(page.getByText("Oficial", { exact: true })).toBeVisible();
  ack.release();
  await browserExpect.poll(() => completedWrites).toBe(1);
  await browserExpect(page.getByTestId("busy")).toHaveText("false");
  await browserExpect(page.getByText("Oficial", { exact: true })).toBeVisible();
}, 30_000);

it("reverte somente a escolha rejeitada e mostra o erro sem esvaziar as etiquetas", async () => {
  rejectWrite = true;
  await page.getByRole("checkbox").check();
  await browserExpect(page.getByTestId("busy")).toHaveText("false");
  await browserExpect(page.getByRole("checkbox")).not.toBeChecked();
  await browserExpect(page.getByTestId("error")).toHaveText("Gravação rejeitada");
  await browserExpect(page.getByText("QR", { exact: true })).toBeVisible();
}, 30_000);

it("preserva a última lista válida quando a consulta recebe HTTP 200 sem listas", async () => {
  malformedRead = true;
  await page.clock.runFor(15_001);
  await browserExpect(page.getByTestId("error")).not.toBeEmpty();
  await browserExpect(page.getByText("QR", { exact: true })).toBeVisible();
}, 30_000);

it("ordena cliques rápidos sem perder a escolha final após a consulta", async () => {
  const ack = deferred(); beforeWrite = () => ack.promise;
  await page.getByRole("checkbox").check();
  await page.getByRole("checkbox").uncheck();
  ack.release();
  await browserExpect.poll(() => completedWrites).toBe(2);
  await browserExpect(page.getByTestId("busy")).toHaveText("false");
  await page.getByRole("button", { name: "Consultar", exact: true }).click();
  await browserExpect(page.getByRole("checkbox")).not.toBeChecked();
  expect(lists.qr[0].conversationIds).toEqual([]);
}, 30_000);
