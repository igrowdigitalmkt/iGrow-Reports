// Local demo only. Never signs in, fetches customer data or submits forms.
// Run with the demo server on port 3100: node scripts/capture-sales-media.mjs
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const origin = "http://127.0.0.1:3100";
const output = join(process.cwd(), "public/product");
const temporary = join(tmpdir(), `groow-sales-${Date.now()}`);
await mkdir(output, { recursive: true });
await mkdir(temporary, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark", reducedMotion: "reduce" });
// Deny external requests and mutations. All source data comes from demo fixtures.
await context.route("**/*", route => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== origin || !["GET", "HEAD"].includes(request.method())) return route.abort();
  return route.continue();
});
const sanitizeDemo = () => {
  localStorage.setItem("theme", "dark");
  // Only text in demo fixtures is replaced. Product structure/styles stay intact.
  const replacements = [["iGrow Digital", "Aurora Digital"], ["Silvio", "Alex"], ["Lindaiane Lívia", "Marina Oliveira"], ["Colégio Crescer", "Escola Horizonte"], ["Crescer", "Horizonte"], ["RM Imobiliária", "Casa Nativa"], ["Clínica Sotero", "Lumina Estética"]];
  const sanitize = () => {
    const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (["SCRIPT", "STYLE"].includes(node.parentElement?.tagName ?? "")) continue;
      let value = node.textContent ?? "";
      for (const [from, to] of replacements) value = value.replaceAll(from, to);
      value = value.replace(/\+55\s*\d{2}\s*\d{4,5}[-\s]?\d{4}/g, "+55 11 90000-0000");
      if (value !== node.textContent) node.textContent = value;
    }
  };
  new MutationObserver(sanitize).observe(document, { childList: true, subtree: true, characterData: true });
};
await context.addInitScript(() => { localStorage.setItem("theme", "dark"); });
const page = await context.newPage();
const sources = [];
async function visit(path) {
  const response = await page.goto(`${origin}${path}`, { waitUntil: "networkidle" });
  if (response?.status() !== 200) throw new Error(`Demo unavailable: ${path}`);
  await page.getByText("Todos os dados são fictícios.", { exact: false }).first().waitFor();
  // Sanitize only after hydration; changing SSR text before hydration breaks it.
  await page.evaluate(sanitizeDemo);
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000);
}
async function capture(name, path, width = 1440, height = 1000) {
  await page.setViewportSize({ width, height });
  await visit(path);
  if (name === "whatsapp") {
    await page.getByText("Diretoria Escola Horizonte", { exact: true }).click();
    await page.waitForTimeout(400);
  }
  await sharp(await page.screenshot({ animations: "disabled" })).webp({ quality: 88 }).toFile(join(output, `${name}.webp`));
  sources.push({ file: `${name}.webp`, route: path, width, height });
  console.log(`Captured ${name} from ${path}`);
}
try {
  await capture("overview", "/demo");
  await capture("analytics", "/demo/clientes/demo-4");
  await capture("automations", "/demo/agendamentos");
  await capture("reports", "/demo/relatorios");
  await capture("whatsapp", "/demo/whatsapp");
  await capture("tablet", "/demo/clientes/demo-4", 1024, 1366);
  await capture("mobile", "/demo", 390, 844);
  // A real screen recording, with only navigations, scroll and tab changes.
  await context.close();
  const videoContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: temporary, size: { width: 1440, height: 1000 } }, colorScheme: "dark", reducedMotion: "reduce" });
  await videoContext.route("**/*", route => new URL(route.request().url()).origin === origin && ["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.abort());
  // Keep fictional display identities consistent in screenshots and recording.
  await videoContext.addInitScript(() => { localStorage.setItem("theme", "dark"); });
  const videoPage = await videoContext.newPage();
  // The recording uses the non-personal demo analytics and scheduling screens.
  for (const path of ["/demo/clientes/demo-4", "/demo/agendamentos", "/demo/relatorios"]) {
    await videoPage.goto(`${origin}${path}`, { waitUntil: "networkidle" });
    await videoPage.evaluate(sanitizeDemo);
    await videoPage.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await videoPage.waitForTimeout(2500);
    await videoPage.mouse.wheel(0, 450);
    await videoPage.waitForTimeout(2000);
  }
  const video = videoPage.video();
  await videoContext.close();
  const raw = await video.path();
  const converted = spawnSync("ffmpeg", ["-y", "-i", raw, "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(output, "tour.mp4")], { windowsHide: true, encoding: "utf8" });
  if (converted.status !== 0) throw new Error(`Video conversion failed: ${converted.stderr?.slice(-800)}`);
  const webm = spawnSync("ffmpeg", ["-y", "-i", raw, "-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "36", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", join(output, "tour.webm")], { windowsHide: true, encoding: "utf8" });
  if (webm.status !== 0) throw new Error(`WebM conversion failed: ${webm.stderr?.slice(-800)}`);
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", join(output, "tour.mp4")], { windowsHide: true, encoding: "utf8" });
  if (probe.status !== 0) throw new Error("Unable to measure video duration for captions.");
  const duration = Number(JSON.parse(probe.stdout).format.duration);
  const timestamp = seconds => new Date(Math.round(seconds * 1000)).toISOString().slice(11, 23);
  const descriptions = ["Painel do cliente: período, contas de anúncios e resultados demonstrativos.", "Agendamentos: rotinas de mensagens organizadas por cliente e frequência.", "Relatórios: acompanhamento de envios e entregas. Ambiente demonstrativo; nenhum envio real."];
  await writeFile(join(output, "tour.vtt"), "WEBVTT\n\n" + descriptions.map((description, index) => `${timestamp(duration * index / 3)} --> ${timestamp(duration * (index + 1) / 3)}\n${description}\n`).join("\n"));
  await writeFile(join(output, "sources.json"), JSON.stringify({ source: "Local demo rendered by the production UI components; fictional data. No customer session.", sources }, null, 2) + "\n");
  console.log("Captured all product media and tour.mp4");
} finally { await browser.close(); }
