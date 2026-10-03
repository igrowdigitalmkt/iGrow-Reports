import { expect, test } from "@playwright/test";

test("destinatários: autorização explícita, troca de telefone, descadastro e histórico", async ({ page }) => {
  await page.goto("/demo/clientes");
  await page.locator(".client-card").first().getByRole("button", { name: "Destinatários", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Novo destinatário", exact: true }).click();
  await dialog.getByLabel("Nome do destinatário").fill("Pessoa de teste");
  await dialog.getByLabel("Telefone internacional", { exact: true }).fill("+5511999999999");
  await dialog.getByRole("button", { name: "Salvar destinatário" }).click();
  await expect(dialog.getByText("Sem autorização", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Registrar autorização", exact: true }).click();
  await dialog.getByLabel("Origem e referência da autorização").fill("Formulário fictício de teste");
  await dialog.getByLabel("A autorização foi recebida agora").check();
  await dialog.getByLabel(/Confirmo que o destinatário/).check();
  await dialog.getByRole("button", { name: "Confirmar autorização" }).click();
  await expect(dialog.getByText("Autorização registrada", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Editar destinatário", exact: true }).click();
  await dialog.getByLabel("Telefone internacional", { exact: true }).fill("+5511999999998");
  await dialog.getByRole("button", { name: "Salvar destinatário" }).click();
  await expect(dialog.getByText("Sem autorização", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Descadastrar", exact: true }).click();
  await dialog.getByLabel("Motivo ou origem do descadastro").fill("Solicitação fictícia de parada");
  await dialog.getByRole("button", { name: "Confirmar descadastro", exact: true }).click();
  await expect(dialog.getByText("Descadastrado", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Histórico", exact: true }).click();
  await expect(dialog.getByText("Telefone alterado — autorização invalidada", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Descadastro registrado", { exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/recipient-history.png", fullPage: true });
  await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.locator(".client-card").first().getByRole("button", { name: "Destinatários", exact: true }).click();
  await expect(dialog.getByText("Nenhum destinatário cadastrado.", { exact: true })).toBeVisible();
});

test("clientes: cadastro, edição, arquivamento e reativação temporários", async ({ page }) => {
  await page.goto("/demo/clientes");
  await page.getByRole("button", { name: "Novo cliente" }).click();
  await page.getByLabel("Nome do cliente").fill("Cliente de teste");
  await page.getByLabel("Observações").fill("Exemplo fictício");
  await page.getByRole("button", { name: "Salvar cliente" }).click();
  await expect(page.getByRole("status")).toContainText("Cliente cadastrado");
  const card = page.locator(".client-card").filter({ has: page.getByRole("heading", { name: "Cliente de teste", exact: true }) });
  await card.getByRole("button", { name: "Editar cliente" }).click();
  await page.getByLabel("Nome do cliente").fill("Cliente revisado");
  await page.getByRole("button", { name: "Salvar cliente" }).click();
  const updated = page.locator(".client-card").filter({ has: page.getByRole("heading", { name: "Cliente revisado", exact: true }) });
  await updated.getByRole("button", { name: "Arquivar", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar arquivamento" }).click();
  await expect(updated).toHaveCount(0);
  await page.getByLabel("Estado dos clientes").selectOption("archived");
  await updated.getByRole("button", { name: "Reativar", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar reativação" }).click();
  await page.getByLabel("Estado dos clientes").selectOption("active");
  await expect(updated).toBeVisible();
  await page.reload();
  await expect(updated).toHaveCount(0);
});

test("demonstração explícita, gráfico, filtros e prévia acessível", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/demo");
  await expect(page.getByText("Modo demonstração", { exact: true })).toBeVisible();
  await expect(page.getByText("Todos os dados são fictícios. Nenhuma mensagem é enviada.")).toBeVisible();
  await expect(page.locator(".activity-chart canvas").first()).toBeVisible();
  const before = await page.locator(".metric-value").nth(1).textContent();
  await page.getByRole("combobox", { name: "Período do dashboard" }).selectOption("7d");
  await expect(page.locator(".metric-value").nth(1)).not.toHaveText(before!);
  await page.getByRole("textbox", { name: "Buscar cliente ou relatório" }).fill("Aurora");
  await expect(page.locator(".reports-table tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Visualizar relatório de Aurora Studio" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Prévia demonstrativa · todos os números abaixo são fictícios.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Limpar busca" }).click();
  await expect(page.locator(".reports-table tbody tr")).toHaveCount(5);
  await page.getByRole("navigation").getByRole("link", { name: /Relatórios/ }).click();
  await page.getByRole("combobox", { name: "Filtrar relatórios por estado" }).selectOption("Aguardando aprovação");
  await expect(page.locator(".reports-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".reports-table tbody tr")).toContainText("Verde & Grão");
  expect(errors).toEqual([]);
});

test("painel privado exige configuração e nunca usa dados fictícios", async ({ page, request }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/entrar/);
  await expect(page.getByText("Não configurado", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrar na plataforma", exact: true })).toBeDisabled();
  await expect(page.getByText("Aurora Studio")).toHaveCount(0);
  await page.goto("/cliente");
  await expect(page).toHaveURL(/\/entrar/);
  await expect(page.getByText("Não configurado", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Aurora Studio")).toHaveCount(0);
  const health = await request.get("/api/health");
  expect(health.status()).toBe(503);
  expect((await health.json()).checks).toEqual({ application: true, privilegedSupabase: false, database: false, encryption: false, metaApi: false });
  await page.goto("/auth/callback?next=https://attacker.example");
  await expect(page).toHaveURL(/127\.0\.0\.1:3100\/entrar/);
});

test("navegação, temas e integrações futuras sem status falso", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/demo/integracoes");
  await expect(page.getByText("Não configurada", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Simulada", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Implementação em etapa futura")).toHaveCount(2);
  await page.getByRole("navigation").getByRole("link", { name: "Configurações" }).click();
  await page.getByRole("button", { name: "Claro", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Escuro", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  for (const route of ["templates", "agendamentos", "entregas"]) {
    await page.goto(`/demo/${route}`);
    await expect(page.getByText("Esta funcionalidade ainda não está disponível.")).toBeVisible();
  }
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 1100 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
  test(`layout e navegação ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/demo");
    await expect(page.locator(".activity-chart canvas").first()).toBeVisible();
    await page.screenshot({ path: `artifacts/dashboard-${viewport.width}.png`, fullPage: true, animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (viewport.width < 1024) {
      await page.getByRole("button", { name: "Abrir menu" }).click();
      await page.getByRole("dialog").getByRole("link", { name: "Clientes", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Clientes", exact: true })).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  });
}
