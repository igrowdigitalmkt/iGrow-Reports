# Homologação real: recuperação de pagamento SEM webhook (preparado, NÃO executado)

Status: ambiente e scripts preparados em 15/10/2026. **Nada financeiro foi feito:** nenhum checkout, pagamento, mudança no webhook do Asaas, agendamento ou deploy. Requer autorização explícita para iniciar.

## O que o teste prova (e o que não prova)
Prova que uma contratação paga no checkout hospedado do Sandbox, **sem nenhum webhook aceito pelo iGrow**, é encontrada na API do Asaas, vinculada por `checkoutSession`, validada (cliente, valor, ciclo, cartão, cobrança confirmada) e ativada **automaticamente por agendamento**. Três origens NÃO são equivalentes e têm evidências diferentes:

| Origem | Como é provada |
|---|---|
| **Webhook** | `subscription.activated` com `metadata.event_id` preenchido; evento gravado antes da ativação (`webhook_recebeu_antes = true` no monitor) |
| **Cron chamado manualmente** | `event_id` nulo, nenhum evento gravado antes; a requisição ao `/api/cron/billing` que ativou tem User-Agent `igrow-homolog-manual/1` nos registros da Vercel |
| **Agendamento automático** | `event_id` nulo, nenhum evento gravado antes; a requisição que ativou tem User-Agent `igrow-homolog-scheduler/1` (agendador temporário local) e nenhuma chamada manual no intervalo |

Esta rodada comprova a **terceira**. A recuperação por chamada manual é uma rodada separada (outra organização e outro pagamento). O agendador desta rodada é **local e temporário** (não é a VPS): prova o mecanismo, não o agendamento permanente.

## Estado preparado
- Organização `TESTE-2.2D Org Recuperação sem webhook`, proprietário fictício `teste22d-dono@example.test` (senha em `.env.homolog-teste22d`, ignorado pelo Git, nunca impressa); sem assinatura, sem intenção, sem cliente financeiro; plano "TESTE-2.2 Plano pago" disponível (R$ 49,90/mês, R$ 499,00/ano), `pode_contratar = true`.
- `scripts/homolog-webhook-gate.mjs` (status | snapshot | block | restore), `scripts/homolog-cron-loop.mjs`, `scripts/sql/billing-monitor.sql`.
- Webhook atual (somente leitura): 1 webhook `iGrow Reports — Homologação`, habilitado, fila ativa, sequencial, API v3, 18 eventos.

## Como impedir o webhook com segurança (recomendado)
**Trocar apenas o token de autenticação do webhook no Asaas Sandbox por um valor descartável** (`block`), e restaurar o original depois (`restore`).
- O iGrow recusa as entregas com 401 **antes de gravar qualquer coisa**: o teste fica limpo (nenhum evento persistido).
- O Asaas **retém** os eventos e reenvia ao restaurar; a fila só é interrompida após **15 falhas seguidas** (e reativada com `interrupted:false`, que o `restore` já faz); eventos ficam retidos até 14 dias. As tentativas se espaçam (observado: 10 falhas em ~23 min), então uma janela de 20 a 30 minutos fica longe do limite.
- Reversível: o estado anterior é gravado por `snapshot` (`.env.homolog-webhook-state`); o token original está em `.env.asaas-sandbox`. Nada é apagado; a URL e os eventos selecionados não mudam.
- Efeito colateral útil: após `restore`, os eventos retidos chegam e devem resultar em `noop`/`noop_duplicate` (prova de idempotência com a ativação já feita).
- **Não** recomendados: desabilitar o webhook (`enabled:false`: o comportamento dos eventos gerados nesse período não é garantido pela documentação, risco de perdê-los); alterar o token no projeto Vercel (exige novo deploy); pausar a fila manualmente.
- Riscos: fila sequencial presa enquanto bloqueada (afeta só este webhook de teste); se a janela passar de ~1 h, restaurar antes; esquecer de restaurar (o `status` e o monitor mostram).

## Procedimento exato (cada passo exige a sua autorização inicial para o teste)
0. **Base:** `node scripts/homolog-cron-loop.mjs --once --manual` (uma chamada manual ao cron, ANTES do teste, para o cron processar as intenções fictícias antigas que ele reconsulta; elas dão falha de cliente inexistente e um "em revisão"; fora da janela do teste). Rodar o monitor filtrando `TESTE-2.2D %` (deve estar vazio).
1. `node --env-file=.env.asaas-sandbox scripts/homolog-webhook-gate.mjs snapshot` e depois `block`.
2. **Você:** abrir `https://i-grow-reports-homolog.vercel.app/entrar` (sessão Vercel já logada), entrar com `teste22d-dono@example.test` (senha no arquivo local), abrir `/dashboard/assinatura`, escolher "TESTE-2.2 Plano pago" **mensal**, dados de cobrança fictícios, ir ao checkout, pagar com o cartão de teste e voltar ao iGrow. Esperado: "Verificando o pagamento" (nada ativado).
3. **Eu confirmo (leitura):** no Asaas a assinatura ACTIVE e a cobrança CONFIRMED com `checkoutSession` = checkout da intenção; no banco: intenção `awaiting_payment`, **nenhuma assinatura, nenhum evento**; nos registros da Vercel: tentativas do Asaas (`Asaas_Hmlg`) recusadas com 401.
4. **Iniciar o agendador temporário:** `node scripts/homolog-cron-loop.mjs --every=300 --max-minutes=30` (em segundo plano; primeira chamada imediata, depois a cada 5 min). O cron só reivindica a intenção ≥ 2 min depois do envio e no máximo de 4 em 4 min, então a ativação deve ocorrer na 1ª ou 2ª rodada após o pagamento.
5. **Verificar a ativação** com o monitor (`origem = sem webhook`, `webhook_recebeu_antes = false`), com a página de retorno (sai de "verificando" sozinha pelo acompanhamento leve) e nos registros da Vercel (UA do agendador).
6. **Restaurar o webhook:** parar o agendador e rodar `restore`; conferir `status`; aguardar o reenvio e verificar que os eventos retidos resultam em `noop`/`noop_duplicate` e que a assinatura continua única.
7. Tempo medido: do pagamento (horário que você informar / `confirmedDate`) até `subscription.activated`, e da 1ª chamada do agendador até a ativação.

## Critérios de aprovação
Ativação automática pelo agendador; nenhum evento gravado antes da ativação; um só registro de assinatura e de cobrança; direitos liberados; valor R$ 49,90 mensal; nenhuma nova cobrança ou checkout criado pela recuperação; após o `restore`, reenvios idempotentes; assinatura da primeira contratação e demais dados intactos. **Reprovação/parada:** ativação por qualquer outro caminho que não o vínculo por `checkoutSession`, duplicidade, ou webhook que tenha ativado antes do agendador.

## Limites e riscos conhecidos
Tempo de ativação depende da cadência (5 min + carimbo de 4 min); intenções fictícias antigas geram falhas "esperadas" no log do cron (clientes inexistentes) e devem ser desconsideradas; o agendador local só roda enquanto este computador/sessão estiver ativo; o teste não valida a VPS nem a produção.

## Resultado da execução (15/10/2026, homologação)
- **1ª tentativa (`TESTE-2.2D`) INVALIDADA:** o pagamento foi feito antes do bloqueio do webhook; os eventos chegaram e **falharam no processamento** por um defeito meu (regex de `dateCreated` sem barras invertidas recusava toda assinatura real do Asaas). Corrigido (campo removido, testes com respostas reais adicionados), publicado só na homologação; a organização foi recuperada pelo reprocessamento dos eventos gravados (não conta como "sem webhook").
- **2ª tentativa (`TESTE-2.2E`) VÁLIDA:** webhook bloqueado às 13:06:07 UTC (vigia de 50 min, independente da sessão); intenção criada 13:09:31; pagamento confirmado no Asaas (assinatura ACTIVE, cobrança CONFIRMED, `checkoutSession` igual ao da intenção); 6 entregas recusadas com 401 (13:09:38 a 13:16:15), nenhum evento gravado; agendador temporário iniciado 13:11 (1ª rodada cedo demais: 1,5 min após o checkout); **assinatura criada 13:16:05 e ativada 13:16:06 pela 2ª rodada do agendador** (User-Agent `igrow-homolog-scheduler/1`, 13:16:04), `event_id` nulo, intenção `completed`, direitos `subscription/full`. Checkout → ativação: 6,6 min. Webhook restaurado 13:17:01; reenvio do Asaas 13:21:18–13:21:24 (5 eventos): todos `noop`/`noop_duplicate`/ignorado, sem segunda assinatura nem pagamento.
- Efeito colateral registrado: a chamada manual de base (13:05) reconferiu a assinatura do primeiro teste (`last_reconciled_at`) e registrou a próxima cobrança PENDING dela (a fatura de novembro, que já existia no Asaas); nenhum campo financeiro mudou.
