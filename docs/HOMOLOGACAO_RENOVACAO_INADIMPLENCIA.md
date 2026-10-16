# Homologação de renovações e inadimplência — preparação (etapa 2.2I)

Status (15/10/2026): **somente preparação.** Nenhuma cobrança criada, confirmada ou vencida; nenhuma assinatura criada no Asaas; nenhuma migration, deploy, commit ou cron permanente. Quatro organizações fictícias criadas só no Supabase de homologação.

## 1. Recursos oficiais do Asaas (documentação consultada em 15/10/2026)
| Recurso | O que a documentação diz | Limites / dúvidas |
|---|---|---|
| `GET /v3/subscriptions/{id}/paymentBook` ("Gerar carnê de assinatura") | Devolve um PDF. No **Sandbox** pode **antecipar a criação das cobranças futuras** da assinatura até `month`/`year` (mês final). Não paga nada; as cobranças criadas têm ciclo próprio e disparam os eventos normais. GET com body → 403. | **Escreve dados financeiros apesar do GET.** Não diz se as cobranças nascem com vencimento futuro nem como o cartão cadastrado é tratado nelas. Cobranças criadas não podem ser desfeitas, só removidas com o cancelamento da assinatura. |
| `POST /v3/sandbox/payment/{id}/confirm` | Simula a confirmação da cobrança (sem dinheiro real). Resposta: objeto da cobrança. | A página **não** diz se vale para cartão de crédito, quais status aceita, o que ocorre com cobrança já paga, nem quais webhooks dispara. A FAQ do Sandbox só cita a confirmação manual pela interface do Sandbox. |
| `POST /v3/sandbox/payment/{id}/overdue` | Força o vencimento da cobrança. | A página **não** explica se `dueDate` muda (passa para ontem?) nem quais tipos de cobrança aceita. Sem body. |
| Eventos (`docs/webhook-para-cobrancas`) | Cartão em dia: `PAYMENT_CREATED` → `PAYMENT_CONFIRMED` → (~32 dias) `PAYMENT_RECEIVED`. Atrasado: `CREATED` → `OVERDUE` → `CONFIRMED`. Cobranças de assinatura usam os mesmos eventos (campo `subscription`). | |
Conclusão: os três recursos existem (só Sandbox), mas **o comportamento com cartão de crédito é desconhecido até o primeiro uso real**; por isso o primeiro passo de cada cenário é só observar o retorno (`GET`) antes de seguir.

## 2. O que o iGrow já faz (código/banco atuais; nada precisa ser reconstruído)
- **Renovação** (`billing_apply_payment`, migrations 0004/0005): cobrança CONFIRMED/RECEIVED, de cartão, do valor da assinatura → `current_period_end = vencimento + 1 mês/1 ano` (nunca encolhe), `next_due_date` atualizado, `payment.renewed`; mesma cobrança de novo → `noop_duplicate`; mesma assinatura e mesmo registro. Cobrança PENDING não amplia nada.
- **Atraso** de renovação: `past_due`, tolerância = vencimento + 7 dias, até o fim desse dia em Brasília (`grace_ends_at`); acesso integral; primeira cobrança recusada **não** tem tolerância (`activation_failed`).
- **Suspensão**: `billing_run_maintenance` (só roda quando o cron é chamado) → `suspended`, acesso `restricted`.
- **Regularização**: cobrança em atraso CONFIRMED → `subscription.reactivated`, tolerância zerada, `sync_access` restaura direitos.
- **Sem webhook**: reconciliação (`billing_reconcile_work`) reconfere de hora em hora assinaturas em atraso/suspensas e ativas com vencimento até amanhã.
- **Bloqueios**: IA (`agency_ai_entitlement` → `billing_restricted`), automações (`automations/runner.ts` consulta `agency_billing_restricted` na hora do envio) e direitos (`resolve_entitlement`).

## 3. Organizações fictícias preparadas (só Supabase; login do proprietário confirmado; sem assinatura, intenção, cliente financeiro ou pagamento)
| Org | Cenário | Credenciais |
|---|---|---|
| TESTE-2.2I Org Renovação mensal | renovação mensal | `.env.homolog-teste22i` (local, ignorado pelo Git) |
| TESTE-2.2J Org Renovação anual | renovação anual | `.env.homolog-teste22j` |
| TESTE-2.2K Org Atraso e regularização por webhook | atraso + tolerância + regularização com webhook | `.env.homolog-teste22k` |
| TESTE-2.2M Org Atraso e regularização por reconciliação | atraso + regularização com webhook bloqueado | `.env.homolog-teste22m` |
Suspensão (7 dias) **não** usa organização real: simulada em `scripts/sql/billing-suspension-simulation.sql` (transação revertida; ver §7). B, D, E, F, G e H não foram tocadas.
Scripts: `scripts/homolog-lifecycle-org-setup.mjs <letra> "<rótulo>"` (preparação) e `scripts/check-billing-renewal-homolog.mjs <letra>` (leitura iGrow + Asaas).

## 4. Procedimento comum a cada cenário real (depende da autorização do usuário)
1. Usuário contrata na org (checkout hospedado, cartão `4444 4444 4444 4444`). **Escolher explicitamente "TESTE-2.2 Plano pago" (ver §8).** Mensal em I, K, M; anual em J. Sem isso nada começa.
2. Registrar o estado inicial (`check-billing-renewal-homolog.mjs`): assinatura, cobrança paga, período, próximo vencimento, direitos, cobranças já existentes no Asaas.
3. Só então a operação financeira do cenário, **uma por vez**, sempre na assinatura da própria org (nunca nas de B, D, E, F, G, H).

### 4.1 Renovação mensal (org I)
1. `GET /subscriptions/{id}/paymentBook?month=<mês seguinte>&year=<ano>` → cria a cobrança da renovação (**modifica dados; precisa de autorização expressa**). Conferir: surgiu exatamente 1 cobrança nova, PENDING, R$ 49,90, vencimento do próximo ciclo.
2. Conferir no iGrow: `PAYMENT_CREATED` processado como `recorded_only`; período e próximo vencimento **não** mudaram (cobrança criada ≠ paga).
3. `POST /sandbox/payment/{id}/confirm` na cobrança nova. Se o Asaas recusar cobrança de cartão (limite documentado como desconhecido), alternativa: pagar a fatura (`invoiceUrl`) com o cartão de teste, com participação do usuário.
4. Esperado: webhook `PAYMENT_CONFIRMED` → `payment.renewed`; `current_period_end` = vencimento da cobrança + 1 mês; `next_due_date` atualizado; mesma assinatura; 2 pagamentos, sem duplicata; direito `full`.
5. Reprocessar o mesmo evento e rodar 1 chamada do cron: `noop_duplicate`.
**Representatividade:** o período é calculado a partir do **vencimento** da cobrança (não da data do pagamento) e confirmar antes do vencimento é equivalente a pagar na data; porém é um atalho do Sandbox (sem o cartão ser cobrado de fato na data). Fica como ressalva: a cobrança automática no vencimento só se observa esperando a data real.

### 4.2 Renovação anual (org J)
Igual a 4.1 com `year` do ano seguinte (a cobrança futura mais próxima é a de 12 meses). Conferir: cobrança de R$ 499,00 (não 49,90), período + 1 ano, ciclo `yearly` preservado, direito `full`, assinatura e checkout originais intactos. Atenção: `paymentBook` antecipa **todas** as cobranças até o mês final; limitar `month/year` ao menor necessário.

### 4.3 Inadimplência e sete dias (org K, sobre a cobrança de renovação criada como em 4.1)
1. `POST /sandbox/payment/{id}/overdue` na cobrança PENDING da renovação. **Observar primeiro a resposta:** `dueDate` ficou no passado (ontem) ou foi mantido? Isso define `grace_ends_at` (vencimento + 7 dias, fim do dia em Brasília); se o vencimento ficar no futuro, a tolerância sairia futura demais — anotar, não corrigir.
2. Webhook `PAYMENT_OVERDUE` → `past_due`; `overdue_due_date` e `grace_ends_at` gravados; acesso `full`; tela mostra atraso e tolerância; link da fatura só do Asaas.
3. Não se aplica a primeira cobrança recusada (já homologada: sem tolerância).

### 4.4 Suspensão (simulada; nunca no relógio real)
Executar `scripts/sql/billing-suspension-simulation.sql` (transação revertida em homologação). **Já executado nesta preparação** (resultado em §7). Opcional no cenário real K: depois de `past_due`, **não** esperar 7 dias; a prova real da suspensão exigiria alterar datas da assinatura real, o que não será feito.

### 4.5 Regularização com webhook (org K)
`POST /sandbox/payment/{id}/confirm` na cobrança em atraso → `PAYMENT_CONFIRMED` → `subscription.reactivated`, tolerância zerada, período = vencimento + 1 mês, direitos `full`, sem pagamento duplicado, automações não refeitas retroativamente (`UNVERIFIED/RESTRICTED` não reexecutam; só o próximo horário).

### 4.6 Regularização por reconciliação (org M)
Mesmo caminho, mas com o webhook **bloqueado antes** (`homolog-webhook-gate.mjs block`; confirmar `enabled:false`; só então confirmar a cobrança). Depois: 1 chamada do cron (reconciliação lê a cobrança na API) → `reactivated`. Restaurar o webhook (`unblock`) e conferir fila (eventos acumulados reprocessados como `noop_duplicate`).

## 5. Origem da diferença R$ 49,90 → R$ 79,90 (causa encontrada; nada alterado)
- **Não houve divergência de preço.** A intenção, a assinatura no Asaas, a cobrança e o iGrow mostram todos R$ 79,90 e o plano "TESTE-2.1 Plano pela interface" v2 (preço do catálogo: 79,90/mês, 799,00/ano).
- O catálogo de homologação tem **dois planos públicos publicados** com o mesmo `sort_order` (100): "TESTE-2.1 Plano pela interface" (79,90) e "TESTE-2.2 Plano pago" (49,90). A lista é ordenada por `sort_order, name` e, sem plano "recomendado", a tela **pré-seleciona o primeiro** (`checkout-form.tsx`: `offers.find(recommended) ?? offers[0]`) = o de 79,90. O teste contratou o plano pré-selecionado.
- Opções (decisão do usuário, não aplicadas): aposentar/ocultar "TESTE-2.1 Plano pela interface" na homologação; ou marcar o de 49,90 como recomendado; ou apenas instruir a seleção explícita. Reaproveitei esta instrução em §4.

## 6. Cron e impedimentos (nada reconstruído)
O endpoint `/api/cron/billing` já faz: manutenção (suspensão, fim de período, intenções), processamento de eventos pendentes e reconciliação (limite 15, orçamento 90 s). Cobre renovação, atraso, tolerância, suspensão, regularização e reprocessamento idempotente (comprovado em PostgreSQL real e concorrência). **Impedimentos:** (a) não há agendamento permanente — suspensão só acontece quando alguém chama o cron; para os cenários basta uma chamada manual autorizada por cenário (`homolog-cron-loop.mjs` é temporário); (b) reconciliação de assinatura ativa só ocorre se vencimento ≤ amanhã (renovação com vencimento distante só entra na fila diária); (c) o Sandbox pode demorar a enviar webhooks.

## 7. Resultado da simulação revertida (suspensão e regularização, dados 100% fictícios, nada gravado)
Atraso há 8 dias → `past_due` (tolerância até o fim do 7º dia em Brasília, acesso `full`); dentro da tolerância a manutenção não suspende; vencida a tolerância → `suspended`, acesso `restricted`, todos os direitos pagos desligados, IA bloqueada (`billing_restricted`), organização e membros preservados, 2ª manutenção idempotente; pagamento confirmado → `reactivated`, tolerância zerada, período renovado, acesso `full`; repetição → `noop_duplicate`; 2 pagamentos e 1 assinatura; auditoria `created, activated, past_due, suspended, reactivated`. Bloqueio de automações não foi executado nesta simulação (coberto por testes do `runner`).

## 8. Riscos técnicos
1. `paymentBook` escreve dados e é irreversível sem cancelar; criar só o mês necessário e só em assinatura de teste própria.
2. `confirm`/`overdue` podem não funcionar para cartão ou mudar a data de modo inesperado: observar antes de decidir.
3. Cobrança futura criada e confirmada antecipadamente é um atalho; a cobrança automática no vencimento real continua não observada.
4. `overdue` com vencimento mantido no futuro distorceria `grace_ends_at`.
5. Sandbox pode gerar e-mails/SMS: usar só dados fictícios (já usados).
6. Planos públicos duplicados na homologação causam escolha errada (§5).
7. Sem agendamento permanente o ciclo financeiro depende de chamada manual (produção exigirá cron).
8. Evento 219 (`PAYMENT_OVERDUE` de outra org) segue em revisão; não afeta estes cenários.

## 9. Ordem recomendada
1. Decidir §5 (plano duplicado). 2. Org I (mensal) — valida `paymentBook`+`confirm` com cartão, o maior risco. 3. Org K (atraso + regularização com webhook) usando o que aprendeu em I. 4. Org M (regularização por reconciliação, webhook bloqueado). 5. Org J (anual). 6. Verificação final (todas as assinaturas anteriores intactas; hashes). Cada passo só com autorização; cada org exige 1 pagamento fictício do usuário na contratação.

## Resultados reais (15/10/2026, Asaas Sandbox + homologação)
- **Org I (renovação mensal):** `paymentBook` (mês 11/2026, uma vez) → HTTP 400 "Nenhuma cobrança encontrada", mas o Asaas criou DUAS cobranças PENDING (15/11 e 15/12); `PAYMENT_CREATED` → `recorded_only`, sem extensão de acesso. `confirm` na de 15/11 (cartão): HTTP 200 → webhook `PAYMENT_CONFIRMED` → `payment.renewed`; período 15/11 → 15/12/2026; mesma assinatura, 3 pagamentos, `full`. Ressalva: a cobrança automática real na data não foi observada.
- **Org K (atraso + regularização com webhook):** `overdue` → HTTP 200, `dueDate` movido para ontem (14/10), `originalDueDate` preservado; `PAYMENT_OVERDUE` → `past_due`, tolerância até 22/10/2026 00:00 (Brasília), acesso `full`, `current_period_end` intacto. `confirm` na cobrança atrasada: HTTP 200 → `PAYMENT_CONFIRMED` → `subscription.reactivated`, tolerância/atraso zerados, período não encolhe (15/11), sem duplicidade.
- **Org M (regularização por reconciliação):** mesmo caminho até `past_due`; webhook bloqueado (token trocado); `confirm` (HTTP 200) sem nenhum evento recebido; 1 chamada ao cron → reconciliação leu a cobrança na API e reativou (`subscription.reactivated`, `event_id` nulo = sem webhook), acesso `full`, 3 pagamentos, 1 assinatura. Webhook restaurado (token original, fila ativa, vigia encerrado).
- **Defeitos/ressalvas:** (1) tela: "Situação do pagamento" usa a cobrança de maior vencimento e mostrou a futura (PENDING) durante o atraso (`describeLatestPayment`); (2) a reconciliação regravou `observed_at`/`updated_at` e **zerou `last_event_id`** dos pagamentos de todas as organizações reconferidas (status/valores iguais) — perde o vínculo com o evento de origem; (3) organização J (anual) não executada; (4) entrega retida dos webhooks após o restore ainda não observada até o registro.

- **Org J (renovação anual, 15/10/2026):** contratação anual R$ 499,00 (`sub_om0gb4fusgs5t8n3`). `paymentBook` (`month=10&year=2027`, uma vez) → HTTP 400, mas criou **uma** cobrança PENDING (R$ 499,00, 15/10/2027, cartão). `confirm` → HTTP 200 → webhook `PAYMENT_CONFIRMED` → `payment.renewed`: período 15/10/2027–15/10/2028, ciclo `yearly`, valor 49900, mesma assinatura, 2 pagamentos, `full`. Os webhooks retidos durante o bloqueio da org M chegaram depois do restore como `noop_duplicate` (M manteve 1 reativação). Mesma ressalva: cobrança automática real na data não observada.

## Correções posteriores (15/10/2026) — sem aplicar em banco
1. **Tela** (`subscription-info.ts`): "Situação do pagamento" prioriza a cobrança em atraso mais antiga; cobranças futuras pendentes já geradas não escondem o atraso. Teste novo em `tests/billing-lifecycle.test.ts`.
2. **Vínculo com o evento** (`supabase/migrations/202610150006_billing_keep_event_link.sql`, **arquivo preparado, NÃO aplicado em nenhum banco**): `billing_apply_payment` passa a usar `coalesce(novo, existente)` em `last_event_id`; a reconciliação deixa de apagar o evento de origem. Cobertura em `supabase/tests/billing-lifecycle.test.sql` (3 asserções, PGlite). Para a homologação remota a migration ainda precisa de autorização.
3. Observação: a reconciliação também atualiza `observed_at`/`updated_at` de pagamentos de todas as organizações reconferidas (sem mudar status, valores, períodos ou direitos) — comportamento esperado; hashes de comparação devem excluir essas colunas.

## Publicação em homologação das correções (15/10/2026)
- **Migration `202610150006` aplicada SOMENTE em `igrow-homologacao`** (`billing_keep_event_link_0150006`): função corrigida (confirmado por `pg_get_functiondef`), grants preservados (só `service_role`). Não aplicada em produção.
- **Deploy da correção da tela** no projeto `i-grow-reports-homolog` (CLI, cópia sem `crons`). Verificado: aplicação e banco ok no health (503 = integração Meta ausente, esperado), tela da org K carrega, cron 401 sem segredo, webhook 200 com o token original e 401 com token errado, fila do Asaas ativa.
- **Não verificado visualmente em produção de dados:** a prioridade do atraso na tela só foi comprovada por teste automatizado, pois nenhuma organização está em atraso agora; e o efeito da migration sobre a reconciliação real ainda precisa de uma rodada do cron com pagamentos que tenham `last_event_id`.
- Sem commit, push, merge, produção, VPS ou cron permanente.
