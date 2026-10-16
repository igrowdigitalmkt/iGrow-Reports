import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Operational script also runs directly in Node.
import { applyBillingCronSchedule, prepareBillingCronSchedule } from "../scripts/billing-cron-schedule.mjs";

const env = {
  BILLING_CRON_ORIGIN: "https://homolog.example.com", BILLING_CRON_ENVIRONMENT: "homolog", CRON_SECRET: "c".repeat(48),
  QSTASH_TOKEN: "qstash-private-token", VERCEL_BYPASS_SECRET: "b".repeat(32),
};
const healthNever = () => Response.json({ ok: false, flags: ["never_ran"] }, { status: 503 });

describe("plano do agendamento financeiro (nunca executado nesta etapa)", () => {
  it("é estável, separado por ambiente e não revela segredos nem os coloca em URL", () => {
    const plan = prepareBillingCronSchedule(env);
    expect(plan).toMatchObject({ destination: "https://homolog.example.com/api/cron/billing", health: "https://homolog.example.com/api/cron/billing/health", cron: "*/5 * * * *", method: "GET", retries: 2, messagesPerDay: 288 });
    expect(plan.scheduleId).toMatch(/^igrow-billing-homolog-[0-9a-f]{12}$/);
    expect(prepareBillingCronSchedule(env).scheduleId).toBe(plan.scheduleId);
    const production = prepareBillingCronSchedule({ ...env, BILLING_CRON_ORIGIN: "https://app.example.com", BILLING_CRON_ENVIRONMENT: "production" });
    expect(production.scheduleId).not.toBe(plan.scheduleId);
    const text = JSON.stringify(plan);
    for (const secret of [env.CRON_SECRET, env.QSTASH_TOKEN, env.VERCEL_BYPASS_SECRET]) expect(text).not.toContain(secret);
    expect(plan.destination).not.toMatch(/[?#@]/);
  });
  it.each(["http://app.example.com", "https://user:private@app.example.com", "https://app.example.com/path", "https://app.example.com/?x-vercel-protection-bypass=segredo", "https://localhost"])("recusa destino inseguro %s", origin => {
    expect(() => prepareBillingCronSchedule({ ...env, BILLING_CRON_ORIGIN: origin })).toThrow("BILLING_CRON_ORIGIN");
  });
  it("recusa ambiente desconhecido, QStash falso e callback inseguro", () => {
    expect(() => prepareBillingCronSchedule({ ...env, BILLING_CRON_ENVIRONMENT: "staging" })).toThrow("BILLING_CRON_ENVIRONMENT");
    expect(() => prepareBillingCronSchedule({ ...env, QSTASH_URL: "https://qstash.upstash.io.evil.test" })).toThrow("QSTASH_URL");
    expect(() => prepareBillingCronSchedule({ ...env, BILLING_ALERT_CALLBACK_URL: "http://alerta.example.com/falha" })).toThrow("BILLING_ALERT_CALLBACK_URL");
    expect(() => prepareBillingCronSchedule({ ...env, BILLING_ALERT_CALLBACK_URL: "https://alerta.example.com/falha?token=x" })).toThrow("BILLING_ALERT_CALLBACK_URL");
  });
});

describe("ativação explícita (testada só com rede simulada)", () => {
  const id = () => prepareBillingCronSchedule(env).scheduleId as string;
  it("sem confirmação exata ou sem credenciais não faz nenhuma chamada de rede", async () => {
    const fetcher = vi.fn();
    await expect(applyBillingCronSchedule(env, "", fetcher)).rejects.toThrow("Confirmação");
    await expect(applyBillingCronSchedule(env, "outro", fetcher)).rejects.toThrow("Confirmação");
    await expect(applyBillingCronSchedule({ ...env, QSTASH_TOKEN: "" }, id(), fetcher)).rejects.toThrow("Configure");
    await expect(applyBillingCronSchedule({ ...env, VERCEL_BYPASS_SECRET: "" }, id(), fetcher)).rejects.toThrow("VERCEL_BYPASS_SECRET");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([new Response("<html>", { status: 401 }), Response.json({ error: "x" }, { status: 404 }), Response.json({ error: "x" }, { status: 401 })])("rota de saúde inalcançável ou sem autenticação: nada é agendado", async response => {
    const fetcher = vi.fn().mockResolvedValue(response);
    await expect(applyBillingCronSchedule(env, id(), fetcher)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "error", headers: { Authorization: `Bearer ${env.CRON_SECRET}`, "x-vercel-protection-bypass": env.VERCEL_BYPASS_SECRET } });
  });
  it("respeita o limite de agendamentos da conta e nunca sobrescreve um existente", async () => {
    const nine = Array.from({ length: 9 }, (_, index) => ({ scheduleId: `s${index}` }));
    await expect(applyBillingCronSchedule(env, id(), vi.fn().mockResolvedValueOnce(healthNever()).mockResolvedValueOnce(Response.json(nine)))).rejects.toThrow("limite");
    const fetcher = vi.fn().mockResolvedValueOnce(healthNever()).mockResolvedValueOnce(Response.json([{ scheduleId: id() }]));
    await expect(applyBillingCronSchedule(env, id(), fetcher)).rejects.toThrow("já existe");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("cria uma vez, com segredos só em cabeçalhos redigidos e a URL limpa", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(healthNever()).mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json({ scheduleId: id() }));
    const result = await applyBillingCronSchedule({ ...env, BILLING_ALERT_CALLBACK_URL: "https://alerta.example.com/falha" }, id(), fetcher);
    expect(result).toMatchObject({ created: true, cron: "*/5 * * * *" });
    const [url, options] = fetcher.mock.calls[2];
    expect(String(url)).toBe(`https://qstash.upstash.io/v2/schedules/https://homolog.example.com/api/cron/billing`);
    expect(String(url)).not.toContain(env.CRON_SECRET);
    expect(options.headers).toMatchObject({
      "Upstash-Method": "GET", "Upstash-Cron": "*/5 * * * *", "Upstash-Retries": "2", "Upstash-Timeout": "110s", "Upstash-Schedule-Id": id(),
      "Upstash-Forward-Authorization": `Bearer ${env.CRON_SECRET}`, "Upstash-Forward-x-vercel-protection-bypass": env.VERCEL_BYPASS_SECRET,
      "Upstash-Redact-Fields": "header[Authorization],header[x-vercel-protection-bypass]", "Upstash-Failure-Callback": "https://alerta.example.com/falha",
    });
    expect(JSON.stringify(result)).not.toContain(env.CRON_SECRET);
  });
});
