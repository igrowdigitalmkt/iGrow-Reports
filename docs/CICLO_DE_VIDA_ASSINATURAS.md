# Ciclo de vida das assinaturas (etapa 2.2C)

Status (15/10/2026): **implementado e testado localmente; NÃO aplicado em banco remoto, NÃO publicado, NÃO homologado com cancelamento/renovação/atraso reais.** Migration nova: `supabase/migrations/202610150005_billing_lifecycle.sql` (incremental; as anteriores não foram alteradas).

## Conceitos que NÃO se confundem
| Conceito | Onde vive | Muda quando |
|---|---|---|
| **Cancelamento financeiro no Asaas** (`DELETE /subscriptions/{id}`) | Asaas | Depois que o pedido é registrado no iGrow e o Asaas confirma (ou a reconciliação repete) |
| **Fim das cobranças futuras** | Asaas + `remote_cancel_pending = false` | Só com a confirmação do Asaas. Antes disso a tela diz "em processamento" e NÃO diz que a renovação parou |
| **Período efetivamente pago** | `current_period_end` | Só por cobrança CONFIRMADA lida na API. O cancelamento **não** o altera |
| **Direito de acesso** | `agency_plan_assignments` (`access_state`) | `full` até o fim do período pago; `restricted` depois do cancelamento efetivo ou da suspensão |

Comportamento real do Asaas (documentação oficial, "Remover assinatura"): a remoção encerra a recorrência, **remove as cobranças pendentes e vencidas** e **preserva as pagas**; eventos de cobranças já geradas podem chegar depois (o `PAYMENT_DELETED` com cobrança inexistente é ignorado sem erro). Não foi testada uma remoção real nesta etapa (não autorizada).

## Cancelamento
- **Quem:** só o proprietário (conferido na ação de servidor `cancelSubscriptionAction`, que usa organização e usuário da SESSÃO, e de novo no banco: `billing_request_cancel` → 42501 para admin, editor e proprietário de outra organização). Super Admin não confirma pagamento: as funções que registram assinatura e pagamento são só do servidor; o painel do operador é somente leitura.
- **Como:** o pedido é gravado e auditado ANTES de falar com o Asaas (`subscription.cancel_requested`, uma única vez mesmo com clique duplo ou pedido repetido; sob lock da organização). Depois o servidor remove a assinatura no Asaas; a confirmação é auditada (`subscription.remote_cancel_confirmed`, uma vez). Timeout ou erro: o pedido segue pendente (`remote_cancel_pending`) e a **reconciliação do cron repete** o aviso (404 = já removida = concluído). Pedido repetido depois de concluído não chama o Asaas.
- **Efeito:** a assinatura continua `active` com `cancel_at_period_end`; acesso completo até `current_period_end`; ao fim do período a manutenção a encerra (`canceled`) e o acesso pago passa a `restricted`. Nada é apagado (organização, equipe, clientes, relatórios, integrações, configurações). Sem reembolso automático. Assinatura ainda não ativada (`pending`) é cancelada na hora, sem acesso.
- **Eventos depois do cancelamento:** `SUBSCRIPTION_DELETED/INACTIVATED` → `cancel_already_recorded`; cobrança pendente que chegue → `recorded_only` (não amplia o período); estorno/contestação → revisão humana.
- **Fora do escopo (pendente):** reativar uma assinatura cancelada antes do fim do período pago (hoje, nova contratação só depois do término), upgrade, downgrade, reembolso.

## Renovação
Mensal e anual pelo mesmo caminho: cobrança CONFIRMADA ou RECEBIDA, **lida na API**, de cartão de crédito, com o valor da assinatura → `current_period_end = vencimento + 1 mês/1 ano` (nunca encolhe), `next_due_date` atualizado, auditoria `payment.renewed`. Cobrança pendente não amplia nada; valor diferente → `mismatch`; mesma cobrança duas vezes → `noop_duplicate`; retrato antigo → `stale_snapshot`. Nenhuma segunda assinatura nem duplicação de direitos.

## Inadimplência e regularização (política aprovada)
- `OVERDUE` de uma **renovação** de assinatura ativa → `past_due`, com tolerância de **7 dias** (`grace_ends_at` = fim do 7º dia depois do vencimento, no horário de Brasília). Acesso completo e dados preservados; regularização permitida.
- Tolerância esgotada (manutenção) → `suspended`: acesso restrito, recursos pagos, automações pagas e IA bloqueados, **área de assinatura acessível**, dados preservados.
- Pagamento confirmado da cobrança em atraso → `subscription.reactivated`: período atualizado, tolerância zerada, direitos restaurados (`sync_access`), configurações intactas. Automações que ficaram sem executar **não são refeitas** (só o próximo horário futuro), sem mensagens duplicadas.
- **Sem tolerância:** primeira cobrança recusada/não paga (`pending` → `activation_failed`, sem direitos) e teste gratuito vencido.
- Concessões: a administrativa gratuita e as concessões especiais seguem suas regras; organizações antigas sem assinatura não são tocadas.

## Cron / reconciliação (sem reconstruir)
Mesmo `/api/cron/billing`. Única adaptação (migration 0005): assinaturas **em atraso ou suspensas** e **ativas com vencimento hoje/amanhã** são reconferidas de hora em hora (renovação, atraso e regularização percebidos mesmo sem webhook); as demais seguem diárias; `pending` a cada 5 min por 3 dias; canceladas não são reconferidas. **Sem o agendamento permanente os prazos (suspensão, fim do período) e a recuperação sem webhook não acontecem.** VPS e agendamento permanente não foram tocados.

## Tela (`/dashboard/assinatura`, sem criar área nova)
Resumo "Sua assinatura": plano, periodicidade, valor (anual = cobrança integral), estado, situação do pagamento (paga / aguardando / em atraso / estorno em análise), acesso pago até, próxima renovação ("Sem renovação" quando cancelada). Proprietário vê "Cancelar assinatura" com confirmação explícita (acesso até a data, sem renovação, dados preservados, sem reembolso automático; botão desabilitado e trava síncrona contra clique duplo). Administrador só consulta. Estados novos: cancelamento em processamento, assinatura cancelada (com data), assinatura encerrada, e textos de atraso/suspensão com orientação. Link da cobrança em aberto só para endereços do Asaas. Estilos reutilizam os tokens existentes (tema claro/escuro); **não houve conferência visual no navegador nesta etapa**.

## Verificação
Mocks: `tests/billing-lifecycle.test.ts` (29), `tests/billing-cancel-screen.test.ts` (9, renderiza a tela no servidor). PGlite: `supabase/tests/billing-lifecycle.test.sql` e os existentes. **Nenhum teste real** (Asaas Sandbox, PostgreSQL real, navegador) foi feito para esta etapa.

## Homologação técnica (etapa 2.2C.1, 15/10/2026) — sem cancelamento real no Asaas
- **Migration `0005` aplicada SOMENTE em `igrow-homologacao`** (`billing_lifecycle_0150005`; sem `db push`). Inclui, além do planejado, a correção de um defeito de escala achado na revisão: a reconciliação escolhia as assinaturas "mais antigas" e uma falha não atualizava a data, então assinaturas com erro voltavam ao topo da fila e podiam impedir a conferência das demais. Agora `billing_reconcile_work` **reivindica** as assinaturas (`reconcile_attempted_at`, `skip locked`), por **prioridade** (atraso/suspensa → vencimento hoje/amanhã → pendente → demais) e em **rodízio** (nova tentativa só depois de 4 min). Assinatura que já não existe no Asaas (404) é registrada e dada como conferida. O cron passou a pedir até 15 assinaturas por rodada (antes 5), dentro do orçamento de 90 s.
- **Testes:** PGlite (todo o `pnpm test:db`), **PostgreSQL real de homologação**: 90 asserções do ciclo de vida em transação revertida + concorrência por conexões independentes (8 pedidos de cancelamento simultâneos → 1 auditoria; 8 confirmações → 1 auditoria; 10 renovações simultâneas → 1 ativação; 10 atrasos → 1 `past_due`; 10 regularizações → 1 reativação). Verificação visual no navegador (prévia temporária, removida): desktop, 375 px, tema claro e escuro, proprietário/administrador/editor, sem rolagem horizontal.
- **Não feito:** nenhum cancelamento, cobrança ou checkout no Asaas; nenhuma assinatura anterior alterada.

## Homologação real do cancelamento (etapa 2.2H, 15/10/2026) — Asaas Sandbox + homologação
Organização TESTE-2.2H; plano contratado pelo proprietário no checkout hospedado: "TESTE-2.1 Plano pela interface" mensal R$ 79,90 (não o plano de R$ 49,90 previsto; sem efeito sobre o teste). Cancelamento feito pelo proprietário na tela, sem terminal/SQL/API manual.
- Antes: assinatura ACTIVE/MONTHLY, cobrança única `CONFIRMED`, período até 15/11/2026, direito `full`, sem cobranças futuras geradas.
- Depois: Asaas `INACTIVE`/`deleted:true` (GET 200, não 404); cobrança paga preservada e nenhuma nova; local `active` + `cancel_at_period_end`, `remote_cancel_pending=false`, período e direito `full` inalterados; auditoria `subscription.cancel_requested` e `subscription.remote_cancel_confirmed` (uma vez cada); webhook `SUBSCRIPTION_DELETED` → `cancel_already_recorded`. Tela: "Assinatura cancelada… acesso até 15 de novembro de 2026", "Sem renovação"; igual após 2 recargas.
- Eventos tardios (reais pelo webhook, estado lido do Asaas): `PAYMENT_CONFIRMED` → `noop_duplicate`; `SUBSCRIPTION_INACTIVATED` → `cancel_already_recorded`; `PAYMENT_DELETED` inexistente → ignorado. Nada reativou, duplicou ou removeu direitos.
- Fim do período: SIMULADO em transação revertida (vencimento deslocado só dentro da transação): manutenção → `canceled`, acesso `restricted`, direitos pagos zerados, dados e pagamento preservados, segunda execução idempotente. Estado real conferido depois: inalterado. O fim real (15/11/2026) NÃO foi observado.
- Outras assinaturas (B, D, E, F, G) intactas (Asaas e hashes). Sem reembolso, sem deploy, migration ou cron permanente.
- Não testado: novo pedido de cancelamento pela tela (o botão some após cancelar; repetição coberta só por testes automatizados e PostgreSQL real); recurso externo real.
