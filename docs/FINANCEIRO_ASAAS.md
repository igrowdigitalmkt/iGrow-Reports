# Fundação financeira com o Asaas (etapa 2.2A)

Status: **implementada localmente** na branch `feat/billing-foundation` (sem commit), com os ajustes finais (suspensão de automações, intenções, concessões, permissões). Migration `202610150001_billing_foundation.sql` **não aplicada em nenhum banco remoto**. Nenhum teste real no Asaas Sandbox foi feito: tudo foi validado com PGlite/pgTAP e simulações. Procedimento de homologação: `docs/HOMOLOGACAO_FINANCEIRA.md`. V1 = **somente cartão de crédito** (mensal ou anual, cobrança integral, renovação automática). Sem Pix, boleto ou cobrança manual.

## Conceitos (nunca se confundem)
| Conceito | Onde vive | Observação |
|---|---|---|
| Plano / versão de preço | catálogo da etapa 2.1 | a assinatura grava a **versão exata** e o valor contratado; mudar o preço depois não altera quem já assinou |
| Concessão administrativa | `agency_plan_assignments.kind='administrative'` | gratuita, feita pelo Super Admin |
| Teste gratuito | `kind='trial'` + `billing_trials` | 7 dias, sem cartão, sem cobrança, não vira assinatura sozinho |
| Assinatura paga | `billing_subscriptions` + `kind='subscription'` | só nasce de fato verificado no Asaas |
| Estado financeiro | `billing_subscriptions.status` | dinheiro |
| Direito efetivo | `resolve_entitlement` (2.1) + `access_state` | o que a organização pode usar; `restricted` = ler sim, criar nada novo |

## Fonte de verdade
- **Dinheiro:** o Asaas. O iGrow guarda um espelho mínimo (sem dados pessoais).
- **Direitos de uso:** o iGrow, derivados do estado financeiro por uma única função (`billing_sync_access`).
- **Preço:** sempre o do servidor (versão publicada do plano). O navegador não envia valor.

## Tabelas (schema `private`, sem acesso pela API, RLS ligada)
`billing_settings` (regras: teste 7 dias, tolerância 7 dias, janela do checkout, `live_enabled=false`), `billing_customers`, `billing_checkout_intents`, `billing_subscriptions`, `billing_payments`, `billing_trials`, `billing_events` (caixa de entrada dos webhooks), `billing_audit_log` (só acrescenta). Registros financeiros não são apagados (gatilhos).

## Máquina de estados da assinatura
`pending → active ⇄ past_due → suspended → active`; `active|past_due|suspended → canceled`; `pending → canceled`. `canceled` é final (reativar = nova assinatura). Transições inválidas são recusadas pelo banco.
- **pending:** criada, sem pagamento confirmado. Não concede nada.
- **active:** cartão `CONFIRMED`/`RECEIVED` (só `CREDIT_CARD`), valor e cliente conferem. Período = vencimento até o próximo ciclo; nunca encolhe.
- **past_due:** renovação vencida (`OVERDUE`) ou cartão recusado na renovação. Acesso preservado. Tolerância = vencimento + 7 dias, até o fim desse dia em Brasília.
- **suspended:** tolerância esgotada (rotina periódica). `access_state='restricted'`: dados e área da assinatura visíveis; novos cadastros e recursos pagos bloqueados; nada é apagado. Pagar a cobrança em aberto reativa.
- **canceled:** cancelamento vale no fim do período pago (`cancel_at_period_end`); depois o acesso fica `restricted`, nunca volta a "sem plano".
- Estorno/contestação, valor divergente, assinatura removida no Asaas, pagamento em assinatura cancelada: marcam `attention_reason` e **não mudam o acesso sozinhos** (decisão humana).

## Proteções contra duplicidade
1. Índice único: no máximo **uma assinatura viva** e **uma intenção em andamento** por organização.
2. A intenção é gravada **antes** de chamar o Asaas, com trava por organização; reenvio, segunda aba ou outra chave devolvem a mesma intenção. O Asaas é chamado **no máximo uma vez** por intenção.
3. Estados da intenção: `creating` (gravada, **nada enviado ainda**; se o processo morrer, é liberada em 3 minutos), `dispatching` (envio registrado **antes** da chamada; se não der para registrar, nada é enviado), `awaiting_payment`, `unknown` (sem resposta: o checkout pode existir), `completed`, `expired`, `failed`. Em `dispatching`/`unknown` a organização fica protegida de uma segunda criação **só até o checkout vencer**: o prazo é o `minutesToExpire` que nós mesmos enviamos (padrão 30 min) + 2 min, ou seja, no máximo ~32 minutos (antes eram ~75). Nesse intervalo a reconciliação consulta o Asaas (`GET /subscriptions?customer=`) e, se a assinatura já existir, registra-a pelo caminho normal (confere cliente, valor e ciclo). O cliente vê "estamos verificando sua contratação, sem nova cobrança, tente de novo depois das HH:MM". Recusa definitiva (4xx) → `failed` e libera nova tentativa. Não há idempotência do Asaas nem cancelamento de checkout por id documentado; por isso nunca se repete a criação sem prazo vencido.
4. Webhooks: id do evento único; duplicata não reprocessa. Fora de ordem: o processador **lê o objeto atual na API**; cada pagamento guarda `observed_at` e um retrato mais antigo é ignorado.
5. Assinatura nova só é aceita se o cliente for nosso e casar com a intenção (ciclo, valor, cartão). Segunda assinatura da mesma organização → `duplicate_subscription` (revisão), nunca ativada.
6. Não se usa idempotência do Asaas (não confirmada na documentação).

## Webhooks
`POST /api/webhooks/asaas`: token no cabeçalho `asaas-access-token` (comparação segura; não é assinatura do corpo) → validação → **gravação durável** → só então HTTP 200 (falha ao gravar = 503 para o Asaas reenviar) → processamento imediato via `after()` como **aceleração**. A recuperação não depende dele: `billing_claim_events` reserva eventos com validade (se o processo morrer, outro retoma), com tentativas e espera crescente; esgotadas, vão para `needs_review`. `GET /api/cron/billing` (protegido por `CRON_SECRET`, **não agendado** em `vercel.json`) executa manutenção de prazos, fila e reconciliação. Sem configuração do Sandbox, ambas as rotas ficam inertes (503). **A rotina precisa ser agendada fora da Vercel diária (ex.: a cada 5 min, com `CRON_SECRET`, como as automações)** para a recuperação e os prazos funcionarem; cada webhook novo também retoma até 5 eventos antigos pendentes (os mais antigos primeiro).

## Sandbox e proteções de ambiente
A URL do Asaas é uma constante de Sandbox; `ASAAS_ENVIRONMENT` precisa ser `sandbox` e chaves `$aact_prod_` são recusadas. O banco recusa ambiente `production` enquanto `billing_settings.live_enabled` for falso. Nenhuma chave no código, no banco, em logs ou no navegador.

## Teste gratuito (fundação)
`billing_start_trial` existe, mas **nada a chama**: o cadastro público não mudou. Exige o plano de teste configurado em `billing_settings.trial_plan_version_id` (criado pelo Super Admin com limites que protejam recursos caros). Freio contra repetição: um teste por organização e **um por usuário**; recomenda-se, na ativação comercial, também comparar o CPF/CNPJ no primeiro checkout.

## Padrões adotados (a confirmar)
- Só o **proprietário** contrata e cancela.
- Assinatura paga **substitui** uma concessão administrativa existente (registrado na auditoria); ao encerrar, o acesso fica restrito.
- Reembolso, estorno e contestação: revisão humana.
- Upgrade imediato e downgrade no próximo ciclo: apenas **campos preparados** (`scheduled_*`), sem cálculo proporcional.

## Suspensão e execução de automações (corrigido nos ajustes finais)
A restrição é verificada **no momento da execução**, em `executeAutomation` (cobre agendada, envio manual e aprovação de texto): `agency_billing_restricted` → a execução é registrada como "não realizada" (com a explicação), sem ler números, sem IA e sem enviar. Automações, destinatários, configurações e dados **não são alterados nem apagados**. A rotina de agendamentos já avançava o próximo horário antes de executar: os horários perdidos **não são refeitos** após a regularização; só o próximo horário futuro executa. A IA e a criação de clientes/convites/automações já eram barradas pelo catálogo (direitos zerados no acesso restrito); a mensagem da IA agora diz que a causa é a restrição. Organização sem plano, com concessão ou em dia nunca é restrita. **Estado indeterminado (consulta falha ou resposta inesperada): não se executa e não se libera tudo.** Só a função inexistente (migration não aplicada: nenhuma organização pode ter assinatura) equivale a "sem assinatura". Na rotina de agendamentos, o horário **não é consumido** por até 60 minutos (a próxima rodada tenta de novo, sem registrar nada nem avançar o horário); passada essa janela é registrado como **falha temporária** e descartado, nunca refeito depois. Envio manual ou aprovação com estado indeterminado: falha temporária imediata, pode repetir. Isso evita tanto a indisponibilidade permanente quanto a execução indiscriminada. Não coberto: coleta de dados da Meta/Google (cron `meta-daily`) e mensagens enviadas manualmente por pessoas na caixa de entrada do WhatsApp (não são recursos pagos do catálogo).

## Concessões especiais × assinatura
A assinatura paga substitui apenas a **concessão gratuita de plano** (auditado em `access.concession_replaced`, com o número de concessões especiais preservadas). Concessões especiais de recursos/limites (`entitlement_overrides`) **não são revogadas** e continuam valendo conforme seus prazos (precedência: interruptor global > restrição financeira > concessão > plano). Durante uma suspensão a restrição financeira prevalece sobre as concessões (elas ficam cadastradas e voltam a valer na regularização). Revogar uma concessão continua sendo uma decisão administrativa explícita.

## Permissões financeiras (V1)
Proprietário: contrata e cancela (o banco confere o papel, não só o servidor). Administrador: apenas consulta (`get_agency_billing`). Editor e visualizador: nada financeiro. Super Admin: consulta (`platform_billing_overview`), não confirma pagamento. Autenticação e MFA não foram alterados. Alterar plano/ciclo (upgrade/downgrade) ainda não existe; quando existir será só do proprietário.

## O que ainda NÃO existe
Página de vendas; checkout na interface; tela "Minha assinatura" e painel financeiro; ações de servidor para contratar/cancelar (a lógica está em `contracting.ts`, testada, sem interface); teste gratuito na criação de conta; upgrade/downgrade; reativação durante o período já cancelado; agendamento do cron; tipos do Supabase regenerados para as novas funções; testes no Sandbox real.

## Contratos do Asaas (documentação oficial + SANDBOX REAL, 15/10/2026)
Validados contra `https://api-sandbox.asaas.com/v3` com dados fictícios (`pnpm test:asaas-live`, 9 testes):
- **Autenticação:** cabeçalho `access_token`; chave de Sandbox aceita (HTTP 200).
- **Cliente:** `POST /customers` com `notificationDisabled`, `externalReference`, `phone`, `postalCode`, `address`, `addressNumber`, `province`; o Asaas deduz `city`/`state` do CEP. `GET /customers/{id}` devolve os campos e `notificationDisabled=true`.
- **ACHADO (incompatibilidade corrigida):** o checkout hospedado **exige dados de cobrança completos do cliente** (telefone, endereço, número, CEP, bairro). Sem eles responde 400 ("O campo ... deve existir para o customer informado"). O cadastro do cliente (`createCustomer`) e `CustomerData` agora levam esses campos; a futura tela de contratação precisa coletá-los (Dados de cobrança) antes do checkout.
- **Checkout** (`POST /v3/checkouts`): o campo **`customer` (id) é aceito** (a referência o descrevia só no texto); `customerData` também funciona; **`imageBase64` NÃO é obrigatório**; `externalReference` é aceito e devolvido; a resposta traz `id`, `link` (host `sandbox.asaas.com`), `status=ACTIVE`, `billingTypes`, `chargeTypes`, `minutesToExpire`, `subscription`, `items`, `callback`, `installment` e `split`. Mensal (`MONTHLY`) e anual (`YEARLY`, valor integral) criados; `nextDueDate` no formato AAAA-MM-DD aceito.
- **Sem leitura de checkout por id:** `GET /checkouts/{id}` → 404. O estado de um checkout só se conhece pelos eventos (`CHECKOUT_*`) e pela assinatura/cobrança que nasce do pagamento. A reconciliação por `GET /subscriptions?customer=` (usada nas intenções com resultado desconhecido) é o caminho válido.
- **Assinatura:** objeto traz `id`, `customer`, `value`, `cycle`, `status` (`ACTIVE`), `billingType`, `nextDueDate`, `deleted`, **`checkoutSession`** e `paymentLink`; anual volta como `YEARLY`. `GET /subscriptions?customer=` lista as assinaturas do cliente (inclui removidas com `includeDeleted`).
- **Cobrança** (`GET /subscriptions/{id}/payments`, `GET /payments/{id}`): `status=CONFIRMED` imediato com cartão de teste, `billingType=CREDIT_CARD`, `confirmedDate` presente (data, sem hora), `paymentDate` ausente, `invoiceUrl`, `subscription` e `customer`. Nosso código aceita `confirmedDate` ou `paymentDate`.
- **Cancelamento:** `DELETE /subscriptions/{id}` → depois `deleted=true`, `status=INACTIVE`; repetir o DELETE numa assinatura já removida **não dá erro** (idempotente); as cobranças continuam consultáveis.
- **Fatos reais no nosso banco:** a assinatura real e a cobrança real do Sandbox foram aplicadas por `billing_apply_subscription`/`billing_apply_payment` no banco de homologação: assinatura registrada (`created`) casada com a intenção (ciclo, valor, cartão) e cobrança confirmada → plano ativado (`activated`), acesso liberado.
- **Eventos e status (documentação):** todos os `PAYMENT_*` relevantes, incluindo `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED`, e os 14 status de cobrança estão tratados.
**Ainda NÃO validado (exige pessoa pagando no checkout hospedado e endpoint público):** pagamento pelo checkout (nascimento da assinatura depois do pagamento e vínculo com a intenção; a assinatura traz `checkoutSession`, que pode confirmar o vínculo com `asaas_checkout_id`), entrega real de webhooks (token, ordem, repetição), cartão recusado no checkout e em renovação, atraso real de cobrança e antecipação de vencimentos no Sandbox.

## Configuração (arquivo local fora do Git)
`ASAAS_ENVIRONMENT=sandbox`, `ASAAS_API_KEY=<chave do Sandbox>`, `ASAAS_WEBHOOK_TOKEN=<32+ caracteres, diferente da chave>`; webhook do Sandbox apontando para um endereço público de TESTE.

---

## Etapa 2.2B: contratação pelo checkout hospedado (implementada localmente, sem commit; NÃO homologada)
Tela `/dashboard/assinatura` (e retorno em `/dashboard/assinatura/retorno`), ação de servidor `startCheckoutAction`, migration `202610150003_billing_checkout_link.sql` (**não aplicada em nenhum banco**). Procedimento de homologação real: `docs/HOMOLOGACAO_CHECKOUT.md`.

**Fluxo:** proprietário escolhe plano (ofertas lidas do catálogo 2.1: públicas, à venda, versão publicada, com preço) e período (mensal ou anual, valor integral) → confere o total → informa dados de cobrança (só se a organização ainda não tem cliente financeiro) → o servidor grava a intenção, cadastra o cliente e cria o checkout (cartão, recorrente) → o navegador vai ao checkout hospedado do Asaas (só se o endereço for `https://sandbox.asaas.com`) → ao voltar, a tela fica em "verificando" até o servidor confirmar → plano liberado só pela confirmação financeira.

**Dados de cobrança: decisão e justificativa.** Opções do Asaas: (A) sem `customer`/`customerData` (o pagador digita tudo na página do Asaas); (B) `customerData`; (C) `customer` pré-cadastrado. Medido no Sandbox: o checkout exige telefone, endereço, número, CEP e bairro também em B e C (400 sem eles). A opção A não pôde ser verificada (exigiria pagar no checkout hospedado, o que o assistente não faz) e, mesmo funcionando, criaria um cliente novo a cada pagamento: a única ligação com a organização seria `checkoutSession`/`externalReference` da assinatura, cuja presença num pagamento real ainda não foi observada. **Adotada a C**: o cliente financeiro é nosso (um por organização), a assinatura nasce com `customer` = esse cliente e a ligação é inequívoca; `checkoutSession` e `externalReference` entram como conferência adicional. Custo: um formulário curto de dados de cobrança, que **não é guardado** no iGrow (vai direto ao Asaas; o cartão é digitado só no Asaas). Se um dia a opção A for validada com pagamento real, ela poderá substituir C sem mudar o resto.

**Vínculo checkout ↔ assinatura ↔ organização** (todos precisam bater; divergência = revisão humana, nunca ativação): cliente Asaas da assinatura = cliente da organização; intenção em aberto da organização; ciclo, valor e cartão iguais aos da intenção; `checkoutSession` (quando informado) = checkout da intenção; `externalReference` (quando for um identificador nosso) = id da intenção; no máximo uma assinatura viva por organização. A intenção de resultado desconhecido aprende o checkout pela própria assinatura. Pagamento: assinatura confere cliente/valor/cartão e a cobrança é lida na API.

**Eventos do checkout:** `CHECKOUT_PAID` não ativa nada: dispara a leitura na API das assinaturas e cobranças do cliente DA intenção, aplicadas pelo caminho verificado. `CHECKOUT_CANCELED`/`CHECKOUT_EXPIRED` fecham só a intenção em aberto (nunca uma concluída). `CHECKOUT_CREATED` é informativo. Sem checkout conhecido ou sem assinatura visível: tenta de novo e depois vai para revisão.

**Estados da tela:** aguardando pagamento, verificando contratação, verificando pagamento, pagamento confirmado, em atraso, suspensa, pagamento não concluído (assinatura nunca ativada e encerrada), cancelado, expirado, erro temporário, indisponível. A página de retorno usa uma dica de texto (`e=ok|cancelado|expirado`) que nunca ativa nada nem confirma: o estado vem do banco.

**Permissões:** só o proprietário contrata (conferido na ação, no banco e na tela); administrador consulta; demais não veem. Super Admin não ativa assinatura paga.

**Limitações conhecidas:** sem link de menu (acesso pelo endereço); sem cancelamento/troca de plano na tela; "pagamento recusado" só aparece quando uma assinatura é criada e encerrada sem ativar (a recusa dentro do checkout é mostrada pelo Asaas e a tela segue "aguardando" até expirar); não há leitura de checkout por id no Asaas; atualização dos dados de cobrança de um cliente já cadastrado não existe; o checkout aberto bloqueia nova contratação até expirar (30 min + 2).
