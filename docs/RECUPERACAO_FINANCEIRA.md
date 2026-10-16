# Recuperação financeira: vínculo, intenções antigas, cron e tela (correção da etapa 2.2B)

Status: migration `202610150004_billing_recovery.sql` **aplicada somente em `igrow-homologacao`** (registrada como `billing_recovery_0150004`), com deploy de homologação. **Não commitada, sem push, nada em produção.** Detalhes dos testes reais na seção 7.

## 1. Regra do vínculo financeiro (aprovada)
Só ativa automaticamente uma assinatura com **identificador verificável** ligado à intenção ANTES do pagamento:
- `checkoutSession` da assinatura = checkout gravado na intenção, **ou** `externalReference` = id da intenção;
- e, em conjunto: organização (pelo cliente financeiro exclusivo da organização), cliente, valor, ciclo, cartão de crédito e plano/versão (da intenção); a ativação só ocorre quando a cobrança é lida CONFIRMADA na API.

**Coincidência não basta.** Cliente + valor + ciclo + data + cartão iguais, **sem** identificador que case, resulta em `unlinked_candidate`: nada é ativado, a intenção e o pagamento são preservados (a intenção ganha `review_required_at`), uma auditoria `subscription.unlinked_candidate` é gravada (uma vez por assinatura), a conferência automática **não** libera nova contratação e o caso vai para revisão financeira. Identificador de outra organização → `mismatch` (`subscription.cross_organization_checkout`); checkout divergente ou valor/ciclo/cartão diferentes → `mismatch`; intenção cancelada/falha/concluída com aquele checkout → `intent_closed`.
O vínculo por identificador **não tem prazo**: a intenção expirada há 40 dias ainda é recuperada se o checkout confere (o pagamento legítimo não se perde por demora).
**Custo assumido:** contratação cujo checkout não foi gravado (resposta perdida na criação) deixa de se recuperar sozinha e passa por revisão financeira (o Asaas não permite consultar o checkout por id).

## 2. Prazos coerentes (intenção antiga)
- **Expiração real do checkout no Asaas:** 30 min (+2 de folga nossa). Depois disso o checkout não pode mais ser pago, então uma assinatura só nasce dele antes disso.
- **Conferência:** uma intenção expirada com checkout enviado fica **bloqueando nova contratação até uma conferência conclusiva** (lista completa do cliente no Asaas, sem pendência de revisão, ≥ 2 min após a expiração) ou liberação por **operador** (auditada). **Não há liberação por decurso de prazo** (o corte de 3 dias foi removido).
- **Reconciliação:** intenção expirada e não conferida é consultada a cada 4 min no 1º dia e a cada 30 min depois, **sem prazo final**; já conferida, a cada 6 h por 3 dias (defesa extra). O vínculo por identificador (item 1) não tem prazo. A lista de assinaturas do cliente é pedida com limite 100; 100 resultados = possivelmente truncada = não conclusiva.
- **Sem bloqueio silencioso:** a tela mostra "Confirmação em andamento" nas primeiras 24 h e "Contratação em análise" (orientação para o suporte, sem convidar a pagar de novo) depois de 24 h ou com revisão pendente. Tratamento: `billing_operator_release_intent(intent, justificativa ≥ 15 caracteres)` (operador da plataforma com 2 etapas; nunca cria assinatura nem altera cobrança; auditoria `intent.released_by_operator`). **Pendente (decisão de negócio):** vínculo manual de uma assinatura paga não identificada, reembolso/cancelamento e interface do operador para isso.

## 3. Migration (revisão do SQL final)
Incremental: apenas `add column` (`recovery_checked_at`, `verified_after_expiry_at`, `review_required_at`), `create or replace` de funções existentes, `drop function` da assinatura antiga de `billing_reconcile_work(integer)` (agora `(integer, text)`) e três funções novas. Nenhuma tabela criada ou recriada, nenhum dado alterado ou apagado. Privilégios: `billing_reconcile_work`, `billing_recovery_candidates`, `billing_mark_intent_verified` só `service_role`; `billing_operator_release_intent` só `authenticated` (exige operador + `aal2`); funções existentes mantêm os grants. `billing_reconcile_work` agora escreve: reivindica intenções com `for update skip locked` numa única instrução (atômica), filtra por ambiente, e é recuperável (se o servidor cair, o carimbo expira em 4 min e outra rodada reconfere).

## 4. Cron financeiro
`/api/cron/billing` (CRON_SECRET): manutenção, eventos pendentes (10) e reconciliação (5 assinaturas + intenções reivindicadas). Sem agendamento permanente, a recuperação de pagamento sem webhook e os prazos **não acontecem** (dependência registrada). **Procedimento de agendamento (NÃO executado):** reaproveitar o cron da VPS das automações (`docs/HOMOLOGACAO_FINANCEIRA.md`): script com `flock -n`, `curl -m 110`, `Authorization: Bearer $CRON_SECRET` de `/opt/igrow/cron.env` (600), `*/5 * * * *`, log só de HTTP (sem segredo), alerta se não houver HTTP 200 por 15 min; em homologação, URL de homologação + bypass de proteção + segredo de homologação. Próxima homologação do agendamento: deixar um pagamento de teste sem webhook (token do webhook errado por alguns minutos) e provar que o cron o recupera sozinho.

## 5. Tela e `GET /api/billing/state`
Rota somente leitura, autenticada (`requireAgencyContext`), 403 para quem não é proprietário/administrador, **uma** RPC (`get_agency_billing`, que confere papel/organização no banco), resposta mínima `{ state, polling }`, `Cache-Control: private, no-store`. O acompanhamento (`return-watcher.tsx`) consulta em 5 s → 15 s → 60 s (~40 min), pausa com a aba oculta e recarrega a página **uma vez** quando o estado muda. Estados: verificando, confirmação em andamento, contratação em análise, conflito, confirmado, expirado/cancelado/erro. Falha de comunicação nunca vira "recusado".

## 6. Conflitos
Segunda assinatura viva do mesmo cliente: `duplicate_subscription`; a atual é marcada `Conflito: …` e a cobrança não vinculada fica em `payment.unlinked` (uma vez por cobrança, com lock da organização). Nada é cancelado, reembolsado ou descartado. Política de estorno: pendente de decisão.

## 7. Verificação (o que foi e o que NÃO foi provado)
- Mocks (vitest): `tests/billing-recovery.test.ts`, `tests/billing-state-route.test.ts`.
- PGlite: `supabase/tests/billing-recovery.test.sql` e os testes ajustados de 2.2A/2.2B (`pnpm test:db`).
- **PostgreSQL real (homologação)**, uma conexão, transação sempre revertida: a suíte de recuperação inteira (75 asserções), sem resíduos.
- **PostgreSQL real, conexões independentes (HTTP)**: `scripts/check-billing-recovery-homolog.mjs` (organizações fictícias `TESTE-2.2C`): reivindicação simultânea, 10 aplicações simultâneas da mesma assinatura e da mesma cobrança, 8 contratações em paralelo, 2 assinaturas diferentes em paralelo, anual em disputa, coincidência sem identificador, divergências.
- **API real do Asaas (somente leitura)**: a assinatura real foi identificada (cliente, assinatura, `checkoutSession` = checkout da intenção, cobrança confirmada) sem webhook.
- **Não provado:** recuperação por cron **de ponta a ponta com pagamento real sem webhook** (próximo teste); execução do agendador; fluxo de operador pela interface.
