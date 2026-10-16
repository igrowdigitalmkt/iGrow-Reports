# Homologação: pagamento com cartão RECUSADO no checkout hospedado (preparado, NÃO executado)

Status (15/10/2026): preparação concluída; **nenhum checkout, pagamento ou alteração financeira foi feito**. Requer autorização para executar.

## O que a documentação oficial do Asaas garante (e o que não)
Fonte: "Testando pagamento com cartão de crédito" (docs.asaas.com). Aprovação: cartão válido fictício (ex.: `4444 4444 4444 4444`), validade futura, CCV de 3 dígitos. **Recusa: Mastercard `5184019740373151` ou Visa `4916561358240741`**; no Sandbox os cartões de teste determinam o resultado e nenhuma adquirente é acionada. **LIMITAÇÃO:** a página descreve cobranças criadas pela API (`billingType = CREDIT_CARD`); **não diz** que os cartões de recusa valem no checkout hospedado, nem quais eventos de webhook uma recusa gera ali (a lista de eventos do checkout só traz `CHECKOUT_CREATED/PAID/CANCELED/EXPIRED`; `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED` é evento de cobrança). **Confirmar que o procedimento funciona no checkout hospedado só é possível executando-o**, e esse é o próprio teste. Se o Sandbox aprovar o cartão de recusa no checkout hospedado, isso será registrado como limitação do Sandbox (não como aprovação do cenário).

## Organização e acompanhamento preparados
- Organização `TESTE-2.2G Org Cartão recusado`, proprietário `teste22g-dono@example.test` (senha em `.env.homolog-teste22g`, ignorado pelo Git); sem assinatura, intenção, cliente financeiro, direitos ou auditoria; pode contratar; plano "TESTE-2.2 Plano pago" disponível.
- Webhook: habilitado, fila ativa, token original, sem bloqueio; nenhum processo de teste ativo; ambiente isolado (Sandbox, Supabase de homologação).
- Acompanhamento (somente leitura): `scripts/homolog-asaas-probe.mjs g` (cliente, assinaturas, cobranças no Asaas), `scripts/sql/billing-monitor.sql` com filtro `TESTE-2.2G %` (intenção, assinatura, pagamento, direitos, auditoria, eventos), registros de entrega do webhook na Vercel.
- Linha de base das organizações já homologadas (B, D, E, F) gravada em hashes (assinatura, cobranças, direitos): devem permanecer idênticos.

## Resultados possíveis e como cada um será interpretado
| O que acontece no Asaas | Esperado no iGrow | Veredito |
|---|---|---|
| **A.** A página do checkout recusa e permite tentar de novo; nenhuma assinatura/cobrança é criada | Intenção `awaiting_payment`; sem assinatura, pagamento ou direitos; tela "Aguardando o pagamento" com o botão para retomar o MESMO checkout; nova contratação só após o prazo (≈ 32 min) ou cancelamento/expiração | Aprovado: nada ativado, sem cobrança duplicada |
| **B.** O Asaas cria assinatura/cobrança e a cobrança falha (`PAYMENT_CREDIT_CARD_CAPTURE_REFUSED`/`OVERDUE`) | Assinatura `pending` → `canceled` sem ativar (`subscription.activation_failed`), `remote_cancel_pending`; direitos inalterados; tela "Pagamento não concluído" e nova tentativa liberada após o cancelamento remoto | Aprovado se o cancelamento remoto resolver sem cobrança |
| **C.** O Sandbox APROVA o cartão de recusa no checkout hospedado | Fluxo normal de aprovação (como nos testes anteriores) | **Limitação do Sandbox**: cenário não comprovável aqui; registrar e não declarar aprovado |
| **D.** Qualquer ativação, direito liberado ou assinatura duplicada sem cobrança confirmada | — | **Reprovado**: interromper e diagnosticar |

## Procedimento (você executa; eu acompanho em tempo real)
1. Entrar em `https://i-grow-reports-homolog.vercel.app/entrar` com `teste22g-dono@example.test` (senha no arquivo local), abrir `/dashboard/assinatura` e conferir a organização "TESTE-2.2G Org Cartão recusado".
2. Escolher "TESTE-2.2 Plano pago", **Mensal** (R$ 49,90), dados de cobrança fictícios e abrir o checkout.
3. Pagar com o cartão **Visa `4916561358240741`** (validade futura, CCV `123`, nome fictício). Se o cartão for recusado, **anote exatamente a mensagem** exibida e, se o Asaas permitir, **tente uma segunda vez** com o Mastercard `5184019740373151` (também de recusa) e depois **desista/volte** sem aprovar nenhum cartão. **Não use `4444…` nesta organização** antes de eu liberar (ele aprova).
4. Voltar ao iGrow (ou fechar a aba) e me avisar. Eu verifico: Asaas (assinaturas/cobranças), eventos e entregas do webhook, banco (intenção, assinatura, pagamento, direitos), tela, e a possibilidade de nova tentativa.
5. (Opcional, só com a sua autorização) concluir a nova tentativa com um cartão aprovado para provar que a organização consegue contratar depois da recusa.

## Critérios de parada
Parar e diagnosticar se: houver assinatura ativa ou direitos sem cobrança confirmada; mais de uma assinatura ou cobrança para a organização; evento de outra organização; falha no processamento do webhook. Nada será forçado ou corrigido por SQL.

## Observação operacional (cenário B)
Se o Asaas criar a assinatura e a cobrança falhar, o iGrow cancela a assinatura localmente e marca o cancelamento remoto como pendente; **quem o conclui no Asaas é a reconciliação do cron** (sem agendamento permanente, depende de uma chamada ao cron). Nesse caso a conclusão exigirá, no momento da execução, a sua autorização para UMA chamada manual (ou o agendador temporário). Até lá a assinatura recusada existe no Asaas sem direitos no iGrow; registrar o tempo.
