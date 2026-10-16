import { requirePlatformOperator } from "@/modules/platform-admin/guard";
import { ActionForm, Field, inputClass, primaryButton, secondaryButton, SubmitButton } from "@/modules/platform-admin/commercial/action-form";
import { adminRpc } from "@/modules/platform-admin/commercial/billing-settings";
import { checkAsaasWebhookAction, revokePreviousWebhookTokenAction, saveAsaasKeyAction, testAsaasConnectionAction } from "@/modules/platform-admin/integrations/actions";
import { asaasStateSchema, REQUIRED_WEBHOOK_EVENTS, webhookUrl } from "@/modules/platform-admin/integrations/asaas";
import { WebhookTokenForm } from "@/modules/platform-admin/integrations/token-form";
import { productionUnlocked } from "@/modules/billing/config";
import { resolveBillingCredentials } from "@/modules/billing/credentials";

export const dynamic = "force-dynamic";
export const metadata = { title: "Integrações: Pagamentos" };

const card = "rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5";
const when = (value: string | null) => (value ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "nunca");
const KEY_STATUS = { unverified: ["Não verificada", "text-[var(--muted)]"], connected: ["Conectado", "text-[var(--good)]"], auth_failed: ["Falha de autenticação", "text-[var(--bad)]"], unreachable: ["Falha de comunicação", "text-[var(--warn)]"] } as const;
const WEBHOOK_STATUS = {
  unknown: ["Não conferido", "text-[var(--muted)]"], ok: ["Conferido: ativo", "text-[var(--good)]"], missing: ["Não encontrado no Asaas", "text-[var(--bad)]"], disabled: ["Desativado no Asaas", "text-[var(--bad)]"],
  interrupted: ["Interrompido no Asaas", "text-[var(--bad)]"], no_token: ["Sem token no Asaas", "text-[var(--bad)]"], incomplete_events: ["Eventos incompletos", "text-[var(--warn)]"],
  duplicate: ["Duplicado no Asaas", "text-[var(--warn)]"], unreachable: ["Falha de comunicação", "text-[var(--warn)]"], auth_failed: ["Falha de autenticação", "text-[var(--bad)]"],
} as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-[var(--border)] py-2 text-sm"><dt className="text-[var(--secondary)]">{label}</dt><dd className="text-right">{children}</dd></div>;
}

export default async function PaymentsIntegrationPage() {
  const { supabase } = await requirePlatformOperator();
  const credentials = await resolveBillingCredentials();
  const environmentForView = credentials?.environment ?? "sandbox";
  const result = await adminRpc(supabase)("platform_asaas_get_state", { p_environment: environmentForView });
  const parsed = asaasStateSchema.safeParse(result.data);
  if (!parsed.success) return <div className="space-y-6"><h1 className="text-2xl font-semibold tracking-tight">Integrações: Pagamentos</h1>
    <p role="alert" className="text-sm text-[var(--bad)]">Não foi possível carregar a integração agora. Confira se a migration da integração com o Asaas já foi aplicada neste ambiente.</p></div>;
  const s = parsed.data;
  const url = webhookUrl();
  const source = credentials?.source === "panel" ? "painel (Super Admin)" : "variáveis de ambiente (reserva)";
  const activeEnvironment = credentials?.environment ?? "sandbox";
  const production = activeEnvironment === "production";
  const unlocked = productionUnlocked();
  const credentialsReady = Boolean(credentials?.probeConfig) && (credentials?.webhookTokens.length ?? 0) > 0;
  const realChargesReasons = [!production && "o ambiente ativo é o Sandbox", production && !unlocked && "o desbloqueio de produção (ASAAS_PRODUCTION_UNLOCK) não está ativo", !s.live_enabled && "a cobrança real (live_enabled) está desligada"].filter(Boolean) as string[];
  const realCharges = realChargesReasons.length === 0 && credentialsReady;
  const recordsCount = s.links.subscriptions + s.links.payments + s.links.checkouts + s.links.customers + s.links.open_events;
  const needsSameAccountConfirmation = recordsCount > 0 && !s.account_registered;
  const [keyLabel, keyTone] = KEY_STATUS[s.key_status];
  const [hookLabel, hookTone] = WEBHOOK_STATUS[s.webhook_status];

  return <div className="space-y-6">
    <header>
      <h1 className="text-2xl font-semibold tracking-tight">Integrações: Pagamentos</h1>
      <p className="mt-1 max-w-2xl text-sm text-[var(--secondary)]">Asaas é o único provedor de pagamentos. Chave e token ficam protegidos no servidor (Supabase Vault) e nunca voltam ao navegador. Trocas valem na hora, sem alterar código nem a Vercel.</p>
    </header>

    <section className={card} aria-labelledby="estado">
      <h2 id="estado" className="text-sm font-semibold">Estado da integração</h2>
      <div className={`mt-3 rounded-lg border p-3 text-sm ${production ? "border-[var(--warn)]/40" : "border-[var(--good)]/30"}`}>
        Ambiente ativo: <strong>{production ? "Produção" : "Sandbox (testes)"}</strong> · {production ? "operações reais possíveis, sujeitas às travas abaixo." : "nenhuma cobrança real é criada neste ambiente."} Origem das credenciais: {source}.
      </div>
      <dl className="mt-3">
        <Row label="Credenciais configuradas"><strong className={credentialsReady ? "text-[var(--good)]" : "text-[var(--warn)]"}>{credentialsReady ? "Sim (ambiente, chave e token do webhook)" : "Incompletas"}</strong></Row>
        <Row label="Cobranças reais habilitadas"><strong className={realCharges ? "text-[var(--warn)]" : "text-[var(--good)]"}>{realCharges ? "Sim" : "Não"}</strong>{!realCharges && realChargesReasons.length > 0 && <span className="block text-xs text-[var(--muted)]">Porque {realChargesReasons.join("; ")}.</span>}</Row>
        <Row label="Chave de API"><span className={keyTone}>{s.key_configured ? "Configurada" : "Não configurada no painel"} · {keyLabel}</span><span className="block text-xs text-[var(--muted)]">Alterada em {when(s.key_changed_at)} · última verificação {when(s.key_checked_at)}</span></Row>
        <Row label="Webhook"><span className={hookTone}>{hookLabel}</span><span className="block text-xs text-[var(--muted)]">Conferido em {when(s.webhook_checked_at)}</span></Row>
        <Row label="Último evento recebido">{when(s.last_event_at)}</Row>
        <Row label="Eventos com falha / em revisão / pendentes"><span className={s.events.failed || s.events.needs_review ? "text-[var(--bad)]" : ""}>{s.events.failed} / {s.events.needs_review} / {s.events.pending}</span></Row>
        <Row label="Rotina financeira (cron)"><span className={s.cron.ok ? "text-[var(--good)]" : "text-[var(--bad)]"}>{s.cron.ok ? "Saudável" : "Atenção"}</span><span className="block text-xs text-[var(--muted)]">Último sucesso: {when(s.cron.last_success_at)}</span></Row>
        <Row label="Liberação comercial (live_enabled)"><span className={s.live_enabled ? "text-[var(--warn)]" : "text-[var(--good)]"}>{s.live_enabled ? "Ligada" : "Desligada"}</span><span className="block text-xs text-[var(--muted)]">Controlada fora desta tela, de propósito.</span></Row>
      </dl>
      <p className="mt-3 text-xs text-[var(--muted)]">Registrar uma chave, inclusive de produção, <strong>não habilita contratação</strong>. Para cobranças reais valem juntos: ambiente Produção, desbloqueio de produção (variável de infraestrutura) e liberação comercial no banco.</p>
    </section>

    <section className={card} aria-labelledby="chave">
      <h2 id="chave" className="text-sm font-semibold">Ambiente e chave de API</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">A chave é validada no Asaas (consulta somente de leitura) antes de ser guardada e nunca é exibida de novo. Substituir a chave da mesma conta vale imediatamente. Trocar para <strong>outra conta</strong> do Asaas é bloqueado enquanto houver assinaturas, pagamentos, contratações ou eventos da conta atual: exige um procedimento de migração.</p>
      {recordsCount > 0 && <p className="mt-2 text-xs text-[var(--secondary)]">Registros ligados à conta atual deste ambiente: {s.links.subscriptions} assinatura(s), {s.links.payments} pagamento(s), {s.links.checkouts} contratação(ões), {s.links.customers} cliente(s), {s.links.open_events} evento(s) em aberto.</p>}
      <div className="mt-4"><ActionForm action={saveAsaasKeyAction} resetOnSuccess className="space-y-4">
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ambiente" hint="Sandbox usa chaves de teste; Produção usa a chave real e fica sujeita às travas.">
              <select name="environment" defaultValue={s.environment ?? activeEnvironment} className={inputClass}><option value="sandbox">Sandbox (testes)</option><option value="production">Produção</option></select>
            </Field>
            <Field label={s.key_configured ? "Nova chave de API" : "Chave de API"} hint="Começa com $aact_. Cole e envie: ela não fica visível depois.">
              <input name="apiKey" type="password" autoComplete="off" spellCheck={false} required minLength={20} maxLength={400} className={`${inputClass} font-mono`} />
            </Field>
          </div>
          {s.environment && <label className="flex items-start gap-2 text-xs text-[var(--secondary)]"><input type="checkbox" name="confirmEnvironment" className="mt-0.5" /> Confirmo a troca do ambiente ativo (marque só se estiver mudando entre Sandbox e Produção).</label>}
          {needsSameAccountConfirmation && <label className="flex items-start gap-2 text-xs text-[var(--warn)]"><input type="checkbox" name="confirmSameAccount" className="mt-0.5" /> Já existem registros financeiros neste ambiente e a conta ainda não foi registrada: confirmo que esta chave pertence à MESMA conta do Asaas que os criou.</label>}
          <div><SubmitButton className={primaryButton}>{s.key_configured ? "Substituir chave" : "Registrar chave"}</SubmitButton></div>
        </>
      </ActionForm></div>
      <div className="mt-4 border-t border-[var(--border)] pt-4"><ActionForm action={testAsaasConnectionAction}><div className="flex flex-wrap items-center gap-3">
        <SubmitButton className={secondaryButton}>Testar conexão</SubmitButton>
        <span className="text-xs text-[var(--muted)]">Consulta a conta no Asaas (somente leitura). Não cria cobrança, cliente, assinatura nem pagamento.</span></div></ActionForm></div>
    </section>

    <section className={card} aria-labelledby="webhook">
      <h2 id="webhook" className="text-sm font-semibold">Webhook</h2>
      <dl className="mt-3">
        <Row label="Endereço"><code className="break-all text-xs">{url}</code></Row>
        <Row label="Token">{s.webhook_token_configured ? <>Configurado · gerado em {when(s.webhook_token_changed_at)}</> : <span className="text-[var(--warn)]">{credentials?.webhookTokens.length ? "Usando o token das variáveis de ambiente (reserva)" : "Não configurado"}</span>}</Row>
        {s.previous_token_active && <Row label="Token anterior"><span className="text-[var(--warn)]">Em transição até {when(s.previous_token_expires_at)}</span></Row>}
      </dl>
      <div className="mt-4"><WebhookTokenForm hasToken={s.webhook_token_configured} /></div>
      {s.previous_token_active && <div className="mt-3"><ActionForm action={revokePreviousWebhookTokenAction}><SubmitButton className={secondaryButton}>Encerrar transição agora</SubmitButton></ActionForm></div>}
      <div className="mt-4 border-t border-[var(--border)] pt-4"><ActionForm action={checkAsaasWebhookAction}><div className="flex flex-wrap items-center gap-3">
        <SubmitButton className={secondaryButton}>Conferir webhook no Asaas</SubmitButton>
        <span className="text-xs text-[var(--muted)]">Só lê a lista de webhooks do Asaas. Nunca cria, altera ou duplica webhook.</span></div></ActionForm></div>
      <div className="mt-4 text-sm">
        <p className="font-medium">Cadastro manual no painel do Asaas</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-[var(--secondary)]">
          <li>No Asaas, abra Integrações &gt; Webhooks e crie (ou edite) o webhook de cobranças. Se já existir um com este endereço, edite-o: não crie outro.</li>
          <li>URL: o endereço acima. Versão da API: v3. Fila de sincronização: ligada (sequencial).</li>
          <li>Token de autenticação: o token gerado acima (cole no campo de token do Asaas). Depois de atualizá-lo, use &quot;Conferir webhook no Asaas&quot;.</li>
          <li>Eventos ({REQUIRED_WEBHOOK_EVENTS.length}): <span className="font-mono">{REQUIRED_WEBHOOK_EVENTS.join(", ")}</span>.</li>
          <li>Depois de uma rotação, atualize o token no Asaas dentro do prazo de transição. O evento só avisa: o estado financeiro é sempre confirmado consultando o Asaas.</li>
        </ol>
      </div>
    </section>

    <section className={card} aria-labelledby="infra">
      <h2 id="infra" className="text-sm font-semibold">O que continua nas variáveis da Vercel</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[var(--secondary)]">
        <li><code>NEXT_PUBLIC_APP_URL</code>: domínio do aplicativo (base do endereço do webhook e dos retornos do checkout).</li>
        <li><code>SUPABASE_SERVICE_ROLE_KEY</code> e as chaves públicas do Supabase: a conexão do servidor com o banco (de onde as credenciais do Asaas são lidas).</li>
        <li><code>CRON_SECRET</code>: autenticação da rotina financeira.</li>
        <li><code>ASAAS_PRODUCTION_UNLOCK=yes</code>: desbloqueio deliberado da produção ({unlocked ? "ativo" : "inativo"} agora). Junto com a liberação comercial, é o que permite cobranças reais.</li>
        <li><code>ASAAS_ENVIRONMENT</code>, <code>ASAAS_API_KEY</code>, <code>ASAAS_WEBHOOK_TOKEN</code>: opcionais; só valem como reserva enquanto nada foi registrado nesta tela.</li>
      </ul>
    </section>
  </div>;
}
