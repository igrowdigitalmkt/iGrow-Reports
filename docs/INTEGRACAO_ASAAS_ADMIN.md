# Integração Asaas administrada pelo Super Admin (etapa 2.2H, 16/10/2026)

Asaas é o único provedor de pagamentos. Ambiente, chave de API e token do webhook são administrados em **Super Admin > Integrações: Pagamentos** (`/admin/integracoes/pagamentos`), sem alterar código nem a Vercel. Status: **implementado e homologado em homologação (Sandbox)**; migration 0011 **não aplicada em produção**.

## Onde ficam os segredos
- **Supabase Vault** (extensão `supabase_vault` 0.3.1, instalada em homologação e produção): chave de API, token atual e token anterior (em transição) são segredos do Vault, criptografados em repouso. `anon` e `authenticated` não têm acesso ao schema `vault`.
- `private.asaas_integration` (uma linha, RLS ligado, sem acesso direto para nenhum papel da API) guarda só **estado**: ambiente, ids dos segredos, datas, resultado das verificações e a **impressão digital SHA-256** da conta Asaas por ambiente. Nenhum segredo em tabela comum, localStorage, cookie, `NEXT_PUBLIC` ou arquivo.
- **Única leitura dos segredos:** `public.asaas_read_credentials()`, concedida **somente ao `service_role`** (servidor). Nenhuma função administrativa devolve segredo. O token novo do webhook é gerado no servidor e aparece **uma única vez** na resposta da rotação.
- Funções administrativas (`platform_asaas_*`): `require_operator()` (operador + MFA aal2) e auditoria sem valores secretos (`integration.asaas_*` em `platform_audit_log`). As Server Actions reconferem operador + MFA antes de qualquer chamada.

## Como a camada financeira usa as credenciais
`src/modules/billing/credentials.ts` (+ `credentials-core.ts`) é a **fonte única**: cliente Asaas, checkout, webhook, reconciliação, cancelamento, consulta de pagamentos, processamento de eventos e cron passam por `createBillingRuntime()`/`resolveBillingCredentials()`. Lidas a cada requisição (sem cache): trocar a chave ou o token vale na hora para funções e rotinas, sem deploy. Reserva: variáveis `ASAAS_*` apenas enquanto nada estiver registrado no painel. Falha de leitura = integração inerte (nunca cai em outro ambiente). O cliente HTTP do Asaas é o mesmo (`createRequester`); o painel usa só consultas de leitura (`/myAccount/status`, `/webhooks`).

## Travas de cobrança real (inalteradas e independentes do registro de chave)
Produção só opera com: ambiente Produção + `ASAAS_PRODUCTION_UNLOCK=yes` (variável de infraestrutura) + chave `$aact_prod_` + `billing_settings.live_enabled=true` (banco, fora da tela). A página distingue "Credenciais configuradas" de "Cobranças reais habilitadas". Chave de produção em Sandbox (e o inverso) é recusada no servidor e no banco.

## Rotação e troca de conta
- **Mesma conta:** a chave é validada no Asaas (leitura) antes de ser guardada; atualização atômica do mesmo segredo.
- **Outra conta:** bloqueada quando existem assinaturas, pagamentos, contratações, clientes reais (não sintéticos) ou eventos em aberto do ambiente. Sem migração automática. Primeiro registro com registros já existentes exige confirmação explícita de "mesma conta". Impressão digital por ambiente (voltar ao Sandbox compara com a conta do Sandbox).
- **Token do webhook:** rotação com transição configurável (0 a 1440 min): o anterior vale só até vencer ou ser revogado ("Encerrar transição"); o token nunca pode ser igual à chave. Segurança do webhook preservada: token, idempotência, duplicados, reconciliação, estado real lido na API do Asaas.

## Conferência do webhook
"Conferir webhook" lê `GET /webhooks` e classifica (não encontrado, desativado, interrompido, sem token, eventos incompletos, duplicado, ativo). Nunca cria, altera ou duplica webhook (cadastro manual; instruções na tela). O Asaas não revela o valor do token: prova do recebimento = "último evento recebido".

## Testes
- `pnpm test:db`: `supabase/tests/asaas-integration-admin.test.sql` (Vault simulado no PGlite; criptografia real só no Postgres de homologação).
- Vitest: `tests/asaas-integration-admin.test.ts`, `tests/billing-webhook-route.test.ts` (token do painel/transição/produção travada).
- Homologação real: `scripts/check-asaas-integration-homolog.mjs` (45 verificações) e `tests/asaas-integration.homolog.test.ts` (opt-in).
