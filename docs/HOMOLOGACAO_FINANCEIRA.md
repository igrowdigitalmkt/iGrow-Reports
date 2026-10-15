# Procedimento de homologação da fundação financeira (etapa 2.2A)

Ambientes: Supabase `igrow-homologacao` (ref `xvjvfvinnnrgnhskglvd`), Asaas **Sandbox**, projeto/ambiente de testes isolado na Vercel. **Produção do Supabase, do Asaas e da Vercel fica fora de qualquer passo.** Nada abaixo foi executado ainda.

## 0. Antes de começar (decisões e ressalvas)
- Autorização explícita para: aplicar a migration na homologação, criar a conta/chave do Sandbox, criar o ambiente de testes na Vercel e fazer pagamentos de teste.
- Confirmar o estado da homologação: deve ter as migrations até `commercial_catalog_0140004`. A nova migration só depende de tabelas que a 2.1 já exigiu.
- Cuidado já conhecido: `.env.production.local` aponta para produção e é lido por `next build/start`; use sempre o script de homologação (`scripts/homolog-start-app.mjs`) ou o projeto isolado da Vercel.

## 1. Migrations (homologação)
Aplicar **uma única vez**, só na homologação: `supabase/migrations/202610150001_billing_foundation.sql` (nome sugerido no registro: `billing_foundation_0150001`). Não reaplicar nenhuma anterior; não usar `supabase db push`. Conferir depois (somente leitura): 8 tabelas `private.billing_*`, funções `public.billing_*`, `agency_billing_restricted`, 0 assinaturas/intenções/testes e `billing_settings` com `live_enabled=false`. Procedimento de recuperação sem apagar dados: não há `drop`; reverter o código basta, pois a migration só acrescenta (um plano restrito por engano é liberado com `update private.agency_plan_assignments set access_state='full'` mediante autorização).

## 2. Configuração (nada disso é enviado no chat)
| Onde | Variável | Observação |
|---|---|---|
| Vercel (ambiente de TESTE) | `NEXT_PUBLIC_SUPABASE_URL`, chaves `...PUBLISHABLE_KEY`/`SUPABASE_SECRET_KEY` da **homologação** | nunca as de produção |
| idem | `ASAAS_ENVIRONMENT=sandbox`, `ASAAS_API_KEY=<chave do Sandbox>` | gerada em sandbox.asaas.com |
| idem | `ASAAS_WEBHOOK_TOKEN` | 32–255 caracteres, diferente da chave de API; mesmo valor no cadastro do webhook |
| idem | `CRON_SECRET`, `NEXT_PUBLIC_APP_URL` | a rotina financeira usa o mesmo mecanismo das automações |
| Computador local | arquivo `.env.asaas-sandbox` (fora do Git) | para os scripts de teste |
Preencher cada variável direto no painel da Vercel / arquivo local; nunca no chat.

## 3. Asaas Sandbox (você faz no painel)
1. Conta em sandbox.asaas.com (e-mails/dados de teste; o Sandbox envia e-mails de verdade, não use e-mails de terceiros).
2. Gerar a chave de API do Sandbox.
3. Integrações → Webhooks: URL `https://<ambiente-de-testes>/api/webhooks/asaas`, token = `ASAAS_WEBHOOK_TOKEN`, e-mail de aviso fictício, fila ativa; marcar eventos de **cobranças**, **assinaturas** e **checkout**. Se houver opção de envio sequencial, preferir. Registrar a opção escolhida.
4. Conferir "Logs de Webhooks" depois de cada teste (status HTTP, tentativas).
5. Agendar a chamada de `GET /api/cron/billing` (cabeçalho `Authorization: Bearer <CRON_SECRET>`) a cada ~5 minutos por um agendador externo (ou manualmente durante os testes). **Sem esse agendamento a recuperação de eventos e os prazos (tolerância, fim de período, teste) não acontecem**: é pré-requisito de qualquer ativação, inclusive futura em produção. O cron diário da Vercel não é suficiente.

## 4. Dados de teste na homologação
2 organizações fictícias com proprietário, um administrador e um editor; 1 plano "TESTE-2.2" **à venda** com preço mensal e anual e limites baixos; plano do teste gratuito em `billing_settings.trial_plan_version_id`; 1 organização legada sem plano (controle). Marcar tudo com "TESTE-2.2" para limpeza futura mediante autorização.

## 5. Roteiro de testes (marcar resultado real de cada item)
| # | Teste | Resultado esperado |
|---|---|---|
| 1 | Contratar mensal com cartão aprovado `4444 4444 4444 4444`, validade futura, CCV `123` (conforme a documentação) | assinatura `pending` → `active` só após o webhook e a leitura na API; plano e limites da versão contratada; auditoria |
| 2 | Contratar anual (ciclo `YEARLY`) | uma cobrança integral; período de 12 meses |
| 3 | Cartão recusado (Mastercard `5184019740373151`, Visa `4916561358240741`) | nenhuma assinatura; a intenção segue aguardando e expira; nada ativado |
| 4 | Fechar o checkout sem pagar / deixar expirar | intenção expira; nova tentativa permitida |
| 5 | Renovação | descobrir no Sandbox como antecipar o vencimento da próxima cobrança (ação de Sandbox ou alteração de `nextDueDate`); confirmar `payment.renewed` e período estendido |
| 6 | Atraso | forçar vencimento da cobrança; `past_due`; fim da tolerância = vencimento + 7 dias; acesso preservado |
| 7 | Suspensão | para não esperar 7 dias, em homologação ajustar `grace_ends_at` e executar `/api/cron/billing`; `suspended`, acesso restrito, dados visíveis, automações **não executam** (rotina `/api/cron/report-automations` registra "não realizada"), criação de cliente bloqueada, IA com mensagem de restrição |
| 8 | Regularização | confirmar o pagamento em atraso no painel do Sandbox; `active`; acesso restaurado; automações voltam no **próximo** horário futuro (sem reenviar o que passou) |
| 9 | Cancelamento (proprietário) | aviso ao Asaas (assinatura removida, cobranças pendentes removidas, pagas mantidas); acesso até o fim do período; depois restrito |
| 10 | Administrador/editor tentando contratar ou cancelar | recusado; administrador consulta a situação |
| 11 | Webhook duplicado: reenviar o mesmo evento (`curl` com o token) | `duplicate:true`; nada reprocessa; token errado → 401; sem token → 401 |
| 12 | Falha ao persistir: derrubar o banco de testes ou usar chave inválida | webhook devolve 503 (Asaas reenvia) / evento fica `failed` e é retomado pela rotina |
| 13 | Reinício: matar a função durante o processamento | reserva vence; outro processo retoma; resultado idêntico |
| 14 | Fora de ordem: reenviar evento antigo depois de um novo | ignorado (`stale_snapshot`) |
| 15 | Idempotência/duplicidade de contratação: duplo clique, duas abas, mesma chave | uma só intenção e **um só checkout** no painel do Asaas |
| 16 | Concorrência real (script com conexões independentes): 10 contratações simultâneas; 10 webhooks simultâneos do mesmo evento; 2 processadores reservando eventos ao mesmo tempo | 1 intenção; 1 linha de evento; nenhum evento processado duas vezes |
| 17 | Timeout simulado na criação do checkout (script que corta a resposta) | intenção `unknown` ("verificando"); nenhum segundo checkout; a reconciliação encontra a assinatura se foi paga, ou a intenção expira em até checkout+2 min |
| 18 | Concessão administrativa + assinatura | plano gratuito substituído; concessões especiais mantidas e auditadas |
| 19 | Isolamento: usuário de uma organização lendo/alterando a outra | recusado |
| 20 | Organização legada sem plano | segue idêntica durante todos os testes |

## 6. Como conferir no painel do Asaas Sandbox
Cobranças → Assinaturas (status, ciclo, valor, próxima cobrança); cada assinatura → cobranças (status, vencimento, forma de pagamento = cartão); Clientes (um por organização); Integrações → Webhooks → Logs (todos 200; sem fila pausada); Checkout (um por intenção). Comparar com `private.billing_subscriptions/payments/events` e a auditoria.

## 7. Critérios de aprovação
Todos os testes acima com o resultado esperado; zero cobrança duplicada; zero evento perdido; nenhuma ativação sem leitura na API; organização legada intacta; nenhum segredo em logs. Falhas ficam registradas e a etapa não avança.

## 8. Confirmações que dependem do Sandbox (contratos ainda não validados)
- O checkout aceita o campo `customer` (a referência o descreve no texto mas não no esquema)? Se não, o vínculo deverá usar `customerData` + `externalReference` e a atribuição muda.
- `items[].imageBase64` é realmente obrigatório? (a referência o lista como obrigatório; hoje só é enviado se fornecido.)
- Formato exato de `nextDueDate` (AAAA-MM-DD presumido) e comportamento da primeira cobrança no checkout recorrente; ciclo `YEARLY` no checkout.
- O checkout devolve `link` (documentado) e a assinatura nasce só depois do pagamento.
- Se a assinatura/cobrança carrega o `externalReference` do checkout (hoje o vínculo não depende disso).
- Quais eventos chegam na recusa em renovação (`PAYMENT_CREDIT_CARD_CAPTURE_REFUSED` está documentado) e o que acontece com o status da cobrança.
- Como antecipar vencimentos/renovações no Sandbox.
- Se existe forma de cancelar/consultar um checkout pelo identificador (reduziria o bloqueio por resultado desconhecido).

---

## Execução da homologação técnica (15/10/2026)
Ambientes usados: Supabase `igrow-homologacao` (ref `xvjvfvinnnrgnhskglvd`) e código local. Produção do Supabase, do Asaas e da Vercel **não foram tocadas**. Nenhum endpoint foi publicado e nenhum webhook ou agendamento externo foi configurado.

**Feito**
- Migration `202610150001_billing_foundation.sql` aplicada **uma única vez** só na homologação (registro `20261015014200 billing_foundation_0150001`). Antes: nenhum objeto financeiro existia, dependências presentes, único `drop` = troca imediata da regra `kind_check` (sem apagar dados). Depois: 8 tabelas com RLS, 18 funções, 0 privilégios de tabela para a API, `live_enabled=false`, dados da 2.1 intactos (3 organizações, 3 planos, 2 atribuições, 1 concessão), organização sem plano continua `unmanaged`.
- **180 verificações no PostgreSQL real do Supabase** (mesmo roteiro do pgTAP, executado como uma transação desfeita no fim; nada ficou gravado): contratação, duplicidade sequencial, permissões de proprietário/administrador/editor/outra organização, versão do plano, concessões, teste gratuito, tolerância, suspensão, regularização, cancelamento, eventos duplicados e processamento recuperável. Resultado: 180 aprovadas, 0 falhas. Observação: uma verificação ("dados existentes legíveis") é fraca por desenho (compara contagem >= 0).
- Fixtures fictícias comuns criadas na homologação (marcadas TESTE-2.2): 3 usuários, 5 organizações, plano pago (R$ 49,90/mês, R$ 499,00/ano) e plano do teste gratuito; `billing_settings.trial_plan_version_id` aponta para o plano do teste (`live_enabled` continua falso).

**Ainda não feito (depende de ação manual)**
- Concorrência real por conexões independentes (`pnpm check:billing-homolog`): precisa da chave SECRETA do projeto de homologação.
- Validação da API do Asaas Sandbox (`pnpm test:asaas-live`): precisa da chave do Sandbox.
- Webhooks reais: precisam de um endereço público de teste (próxima fase).

### Como configurar as chaves com segurança (você faz; nada vai para o chat)
1. Abra o arquivo `.env.asaas-sandbox` na pasta do projeto (já existe, vazio, e é ignorado pelo Git) com o Bloco de Notas ou o VS Code.
2. Em `ASAAS_API_KEY=` cole a chave do **Sandbox** logo depois do sinal de igual (sem aspas, sem espaço) e salve.
3. Em `HOMOLOG_SUPABASE_SECRET_KEY=` cole a **chave secreta do projeto igrow-homologacao** (painel do Supabase, projeto igrow-homologacao, Project Settings, API Keys). Confira o nome do projeto no topo do painel: tem de ser *igrow-homologacao*, nunca *iGrow Reports*.
4. Não renomeie o arquivo, não o envie por e-mail e não o copie para pastas sincronizadas. Avise no chat apenas "chaves configuradas".
Os scripts abortam sozinhos se a chave de produção for usada e nunca imprimem a chave.

### Comandos (executados por mim depois do aviso)
- `pnpm test:asaas-live`: contratos do Asaas Sandbox (cliente fictício, checkouts mensal e anual, assinaturas de teste, cobranças, cancelamento) e aplicação de fatos reais ao banco de homologação.
- `pnpm check:billing-homolog`: concorrência real (12 contratações simultâneas, 10 confirmações idênticas, 30 eventos e 6 processadores, corrida de teste gratuito).
Cada execução cria organizações e um usuário novos; registros financeiros são imutáveis por desenho e permanecem na homologação (inofensivos, marcados TESTE-2.2).

## Agendamento financeiro (recomendação; nada foi configurado)
- **Como as automações são agendadas hoje:** pelo cron do sistema na VPS (a mesma da Evolution API): `infra/evolution/run-automations.sh`, a cada 5 minutos, com `flock` (evita sobreposição) e o `CRON_SECRET` em `/opt/igrow/cron.env` (permissão 600), chamando `https://i-grow-reports.vercel.app/api/cron/report-automations` com `Authorization: Bearer`. O `vercel.json` só tem dois crons diários (coleta Meta 09:00 e retenção do WhatsApp 07:30); o comentário do código registra que o cron da Vercel só roda uma vez por dia (indício do plano Hobby; o plano não pôde ser confirmado pela API por falta de permissão).
- **Reutilizar o mecanismo existente:** sim. Basta um segundo script na mesma VPS, com trava e log próprios, chamando `/api/cron/billing` a cada 5 minutos com o mesmo `CRON_SECRET` (já validado por `authorizeWorkerRequest`, comparação em tempo constante). Não é preciso nova infraestrutura nem plano pago. Exemplo (não instalado):
```
#!/bin/sh
# /opt/igrow/run-billing.sh  | /etc/cron.d/igrow-billing:  */5 * * * * root flock -n /run/igrow-billing.lock /opt/igrow/run-billing.sh >> /var/log/igrow-billing.log 2>&1
set -eu
. /opt/igrow/cron.env
status=$(curl -s -m 110 -o /tmp/igrow-billing.json -w "%{http_code}" -H "Authorization: Bearer $CRON_SECRET" https://i-grow-reports.vercel.app/api/cron/billing || echo 000)
echo "$(date -Is) HTTP $status $(head -c 300 /tmp/igrow-billing.json 2>/dev/null)"
```
- **Viabilidade de 5 em 5 minutos:** sim. A rotina leva menos de 1 s sem trabalho; tem orçamento de 90 s (limite da função: 120 s) com lotes de 10 eventos e 5 conferências, e o que sobrar é retomado na rodada seguinte. Com 288 chamadas por dia o custo é desprezível.
- **Detectar falhas e atrasos:** (1) o log da VPS registra o HTTP de cada rodada (200 = ok; 401/503 = segredo ausente/serviço indisponível; 000 = sem resposta); (2) a rotina escreve um resumo (`console.info`) nos logs da Vercel; (3) `platform_billing_overview` já expõe `events_pending`, `events_needing_review` e `oldest_pending_event_at` (o Super Admin vê se algo está parado); (4) opcional futuro: ping de um monitor externo (ex.: Healthchecks.io) ao fim de cada rodada bem-sucedida para alertar por e-mail se parar por mais de 15 minutos. Sem esse agendamento, os prazos (tolerância, fim do período pago, teste) e a recuperação de eventos não andam sozinhos: é pré-requisito de qualquer ativação.
- **Em homologação:** chamar `/api/cron/billing` do ambiente de testes manualmente (curl com o segredo de testes) ou por um agendador temporário do computador.

---

## Resultados da homologação técnica (15/10/2026, com as chaves locais)
**Confirmações antes de executar:** `.env.asaas-sandbox` ignorado e não rastreado pelo Git; ambiente `sandbox` com chave de Sandbox (a de produção é recusada pelo código); Supabase = `xvjvfvinnnrgnhskglvd` (igrow-homologacao), sem o ref de produção; URL do Asaas fixa no Sandbox; nenhum segredo impresso (só presença, tamanho e classe).

**Concorrência real** (`pnpm check:billing-homolog`, conexões HTTP independentes, 27 verificações; 3 execuções finais consecutivas sem falhas):
- 12 contratações simultâneas com chaves diferentes → 1 só intenção; 12 reenvios da mesma chave → 1 só intenção; administrador, outro dono e ambiente de produção recusados (42501).
- 10 aplicações simultâneas da mesma assinatura → 1 criação; 10 confirmações simultâneas do mesmo pagamento → 1 ativação; retrato antigo ignorado; pagamento que não é de cartão não ativa; contratação com assinatura viva recusada (23505); 5 cancelamentos simultâneos consistentes; 5 manutenções simultâneas sem erro.
- 12 entregas simultâneas do mesmo evento → 1 gravação; 30 eventos em paralelo; 6 processadores reservando ao mesmo tempo → nenhum evento entregue duas vezes; teste gratuito: 6 inícios simultâneos (2 organizações, mesmo usuário) → exatamente 1 sucesso.
- **Defeito real encontrado e corrigido:** na primeira execução correta, 1 de 10 aplicações simultâneas da mesma assinatura respondeu `duplicate_subscription` (quem esperava a trava achava a própria assinatura já criada). Corrigido por migration incremental `202610150002_billing_subscription_race.sql` (aplicada só na homologação como `billing_subscription_race_0150002`); permissões conferidas; 3 execuções seguintes sem falha. (Um erro anterior era do script, que ignorava se a intenção vencedora era anual.)

**Asaas Sandbox** (`pnpm test:asaas-live`, 9 testes aprovados): contratos em `docs/FINANCEIRO_ASAAS.md`. Incompatibilidade corrigida: o checkout exige dados de cobrança completos no cliente.

**Objetos criados (fictícios, sem dinheiro real):** no Sandbox, clientes, checkouts (expiram em 30 min), assinaturas de teste (todas removidas pelo próprio teste) e cobranças; na homologação, organizações/usuários "TESTE-2.2" e registros financeiros imutáveis por desenho.

**Não feito (próxima fase):** pagamento pelo checkout hospedado por uma pessoa (cartões aprovado e recusado), webhooks reais (exigem endereço público de teste), renovação/atraso reais, agendador do cron.
