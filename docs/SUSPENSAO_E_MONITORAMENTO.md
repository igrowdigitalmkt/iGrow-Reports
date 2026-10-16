# Suspensão financeira completa e monitoramento do cron (etapa 2.2D, 15/10/2026)

Status: **implementado e testado localmente; NÃO publicado.** Nada foi aplicado em banco remoto (migrations 0007 e 0008 são só arquivos), não houve deploy, commit, agendamento, pagamento ou cobrança. Complementa `docs/RESTRICOES_OPERACIONAIS.md`.

## 1. Política aplicada (aprovada)
Tolerância (7 dias): todos os direitos do plano. Depois da suspensão (ou período pago encerrado):
- **Continua liberado (leitura/regularização):** conta, dashboards e histórico de campanhas (dados já coletados), relatórios existentes e download dos já gerados, conversas anteriores do WhatsApp, portal do cliente (leitura), área de assinatura e regularização.
- **Bloqueado no SERVIDOR:** IA, novos relatórios, envio manual de WhatsApp, agendamentos/automações/envio automático, novas sincronizações com anúncios, criar clientes, novos convites.
- **Nunca feito:** apagar dados, excluir integrações, desligar números de WhatsApp, remover usuários, desfazer configurações.
Controle único: o estado financeiro central (`agency_billing_restricted` / `agency_plan_assignments.access_state`) já usado pelo runner, pela IA e pelos limites. **Nenhum direito novo no catálogo e nenhum segundo sistema de permissões.** Organizações antigas (sem plano atribuído), concessões administrativas e exceções continuam liberadas porque o estado só é "restrito" quando existe assinatura/teste vencido.

## 2. Pontos protegidos (todos no servidor, antes de qualquer efeito externo)
Trava reutilizável: `src/modules/billing/guard.ts` (`ensurePaidOperation`, `paidOperationBlock`, `BillingRestrictedError`). Estado desconhecido (banco/RPC indisponível) **bloqueia** por segurança; organização sem plano atribuído (antiga) é sempre liberada.
| Operação | Onde | Resposta quando bloqueada |
|---|---|---|
| Envio manual de WhatsApp: resposta, extras (enquete, contato, figurinha...), reação, nova conversa | `api/whatsapp/inbox/[id]/send`, `send-extra`, `react`, `inbox/new` | 403 `billing_restricted` (503 se não confirmável); nada é enviado nem gravado |
| Relatório do cliente por WhatsApp (PDF) | `api/whatsapp/send` | idem |
| Gerar relatório manual / publicar versão / salvar relatório do painel (PDF) | `reports/actions.ts` (`generateManualReport`, `publishReportVersion`), `client-portal/report-actions.ts` (`generateDashboardReport`) | `{ error }` com a mensagem de restrição |
| Sincronizar contas e coletar dados da Meta; atualização ao vivo de agregados, status, saldo e audiência | `meta/server.ts`: `collectMetaClientInsights`, `syncMetaAccountsForClient`, `refreshMetaDashboardScope`, `getClientAccountBilling`, `getClientAudienceBreakdowns`, `getMetaEntityStatuses` (devolve vazio) | erro com a mensagem; nenhuma chamada à Meta |
| Atualização automática ao abrir o painel | `collectDashboardData` | automática: pausa em silêncio e o painel mostra os dados guardados com aviso; manual: mensagem |
| Sincronizar contas do Google Ads | `google-ads/server.ts` (`syncGoogleAccounts`) | mensagem |
| Coleta agendada (job da fila e rotina diária) | `runOneIntegrationJob` (gancho `isBlocked`, sem marcar falha do provedor), `listActiveMetaClients` (pula organizações restritas via `billing_restricted_agency_ids`) | job encerrado como `billing_restricted`; sem chamada à Meta |
| Já protegidos antes | IA (`runGuardedGeneration`), agendamentos/aprovação/executar agora (`executeAutomation`), limites e convites (gatilhos do banco) | — |

**Leitura preservada:** nenhuma rota de leitura, download (`getSavedReportDocument`), portal, histórico ou conversas passa pelo guard. `getFreshClientAnalytics` devolve os dados guardados quando a atualização está pausada.

## 3. Não bloqueado de propósito / decisões pendentes
- **Apagar para todos** (WhatsApp, `messages/actions` revoke): é remoção de mensagem própria, não envio; mantido liberado.
- **Visualização do Google Ads:** os números do Google são lidos ao vivo (não há cópia no banco). Bloquear a leitura esconderia o painel inteiro; por isso só a sincronização/vínculo de contas e os envios/relatórios do Google são travados. Decisão: manter assim ou passar a bloquear a leitura ao vivo.
- **Conectar nova integração** (`connectMetaForClient`, conectar WhatsApp): limitado por gatilhos de plano (contas, números), sem trava financeira própria; novas contas de anúncio/números/portal já são barrados pelos limites zerados.
- **Portal do cliente:** leitura existente liberada (política). Novos convites/ativações barrados pelo gatilho.

## 4. Regularização
Pagamento confirmado → `sync_access` volta a `full` e o guard passa a liberar na mesma hora (o estado é consultado a cada operação). Nada é refeito: execuções perdidas ficam `skipped` (o horário é consumido antes da execução) e a coleta volta a ocorrer na próxima rodada normal. Nenhuma mensagem acumulada é disparada.

## 5. Monitoramento persistente do cron (migration `202610150007_billing_cron_monitor.sql`, NÃO aplicada)
- Tabela `private.billing_cron_runs` (somente servidor): `id`, `environment`, `started_at`, `finished_at`, `status` (`running|success|partial|failed`), `duration_ms`, `items_processed`, `failures`, `counts` (só números, ≤1,5 KB), `error_code` (identificador curto). **Nada de segredo, token, payload ou dado de cliente.** Retenção 30 dias; execução "running" esquecida há 10 min vira `failed/cron_timeout`.
- RPCs só do servidor: `billing_cron_start`, `billing_cron_finish`, `billing_cron_health`, `billing_restricted_agency_ids`.
- `/api/cron/billing` registra cada execução (falha do registro nunca derruba o cron; sem a migration ele funciona como antes). Nova rota **`/api/cron/billing/health`** (mesma autenticação `Bearer CRON_SECRET`): 200 = saudável, **503 = alerta**, com as marcas: `never_ran`, `no_recent_success` (>15 min sem sucesso), `consecutive_failures` (≥3 execuções seguidas sem sucesso), `events_backlog` (>50 pendentes ou o mais antigo >30 min), `reconcile_backlog` (>20 assinaturas em atraso/pendentes sem conferência há >2 h), `intents_backlog`, `monitor_unavailable`.
- **Estratégia de alerta (nada enviado nesta etapa):** (1) agendamento QStash do próprio cron com callback de falha; (2) um segundo agendamento leve (ou monitor externo) que chama `/health` a cada 10 min e dispara o aviso quando recebe 503; (3) aviso por e-mail/WhatsApp interno. Limiares ajustáveis na função SQL. Alertar também no painel do operador é um próximo passo (não feito).

## 6. QStash: proposta final (nada criado)
- **Método:** a rota só aceita **GET** → `Upstash-Method: GET` (o worker da Meta usa POST na sua rota; não se altera).
- **Autenticação:** `Upstash-Forward-Authorization: Bearer <CRON_SECRET do ambiente>` (já validado em tempo constante, 401 sem segredo). A verificação da assinatura `Upstash-Signature` (chaves `QSTASH_CURRENT/NEXT_SIGNING_KEY`, listadas no `.env.example`) **não existe hoje em nenhuma rota**; como segunda camada é recomendada e exigiria código novo (não feito, não indispensável: o segredo já impede chamadas indevidas).
- **Homologação com proteção de deployment:** confirmado em HTTP real que o cabeçalho `x-vercel-protection-bypass` (enviado via `Upstash-Forward-x-vercel-protection-bypass`) alcança a rota sem colocar segredo na URL; sem ele a Vercel bloqueia; com ele e sem `Authorization` o app responde 401 "Acesso negado" (nenhum trabalho executado). Os segredos ficam só nos cabeçalhos do agendamento, protegidos com `Upstash-Redact-Fields: header[Authorization],header[x-vercel-protection-bypass]`.
- **Execuções simultâneas:** seguras (reivindicação com `skip locked` e lease de 120 s; manutenção idempotente). Idempotência: eventos e conferências repetíveis.
- **Timeouts/retentativas:** a rota termina em até ~120 s (`maxDuration 120`, orçamento de 90 s). `Upstash-Retries: 2` (padrão do QStash é 3; falha = qualquer resposta não 2xx; retries contam como mensagens), `Upstash-Timeout` explícito, `Upstash-Failure-Callback` para o aviso. Recuperação: a rodada seguinte retoma o que ficou.
- **Ambientes:** um agendamento por ambiente (IDs distintos, destino e `CRON_SECRET` próprios); nunca compartilhar.
- **Capacidade do cron:** 15 assinaturas e 10 eventos por rodada de 5 min.
- **Continuidade:** agendamento vive no QStash (não depende de computador pessoal nem de reinício de servidor).

## 7. Consumo estimado do QStash
Limites públicos do plano gratuito (consultados hoje na página de preços da Upstash; **o plano real da conta não foi verificado**: não há `QSTASH_TOKEN` nesta sessão): 1.000 mensagens/dia, resposta HTTP até 15 min, 10 agendamentos, logs/DLQ 3 dias. Planos gratuitos podem mudar: reconfirmar no console antes de produção.
| Origem | Frequência | Mensagens/dia |
|---|---|---|
| Cron financeiro de homologação | */5 | 288 (só durante os testes) |
| Cron financeiro de produção | */5 | 288 |
| Worker da Meta existente | */15 | 96 |
| Verificação de saúde (opcional) | */10 | 144 |
| Retentativas e callbacks | só em falha | depende (cada retry e callback conta) |
Total simultâneo ≈ 816/dia + retries (~86% do limite). **Risco real:** com os dois ambientes ligados e a verificação de saúde, a margem é pequena. Opções: ligar o cron de homologação apenas na janela do teste, usar `*/10` na homologação, juntar monitor externo gratuito em vez do segundo agendamento, ou contratar plano pago antes de produção.

## 8. Inventário de registros financeiros FICTÍCIOS (leitura em 15/10/2026; nada alterado)
Comparação do banco de homologação com o Asaas Sandbox (9 assinaturas ACTIVE e 13 clientes na conta):
| Grupo | Organizações | Contrapartida no Asaas? | Risco com o cron ligado |
|---|---|---|---|
| Reais no Asaas (evidências) | B, D, E, F, G, I, J, K, M (ativas); H (cancelada) | sim | nenhum: são conferidas e batem |
| Reais, já removidas no Asaas | "Org Asaas real" ×3 (assinaturas e clientes do Asaas; assinaturas já com cancelamento pedido) | cliente sim; assinatura removida | conferência vê 404 e confirma o cancelamento já registrado |
| Só no banco: etapa 2.2A/B | "contratação" ×5 organizações (4 assinaturas `sub_c22…` ativas com cancelamento no fim do período; clientes `cus_c22…`) | não | 404 → "removida" (já com cancelamento pedido); intenções expiradas ainda reconferidas |
| Só no banco: recuperação 2.2C | "TESTE-2.2C" r1 ×2 ativas com cancelamento pedido, r3/r8 canceladas; clientes `cus_RC_…`; intenções expiradas (2 NÃO verificadas) | não | 404/erros do Asaas; as 2 intenções não verificadas seriam reconferidas a cada 30 min |
| Só no banco: ciclo de vida | "TESTE-2.2L" ×3 (canceladas) | não | pouco (canceladas não são reconferidas) |
| Só no banco: restrições | **O** (cancelada, cancelamento remoto pendente) e **P** (ATIVA sem pedido de cancelamento) | não | **P seria "removida" (404) e receberia cancelamento no fim do período; O chamaria `DELETE` no Asaas** |
Intenções de cliente fictício: 24 `expired/completed` (9 expiradas; 2 não verificadas).
**Estratégia (aguarda autorização):** (A, recomendada) aplicar as migrations 0007 e 0008 em homologação e, **antes de ligar o agendamento**, marcar como fictícias (`billing_mark_synthetic`) as organizações "só no banco" acima — assim a reconciliação as ignora e nada é alterado nem cancelado; a lista exata é a da tabela. (B) encerrar essas pendências antes pelo fluxo normal de cancelamento (altera dados de teste, perde a evidência). (C) aceitar a alteração (P e O mudariam sozinhas). Nenhum registro foi marcado ou alterado ainda.

## 9. Testes desta etapa
- **Mocks (vitest, 1.111 testes):** guard central; rotas de WhatsApp (nova conversa, relatório): restrito = 403/503 sem enviar nem gravar, regularizado volta a enviar, isolamento por organização; ações de relatório e coleta; funções reais de Meta/Google (barram antes do provedor); painel com acesso restrito (histórico + aviso); jobs; filtro da rotina diária; monitor e rotas do cron (autenticação, sucesso/parcial/falha, nenhuma informação sensível, cron funciona sem a migration).
- **Banco local (PGlite, pgTAP):** migrations 0007/0008, saúde (sem execução, parada >15 min, 3 falhas seguidas, acúmulo de eventos), ambientes separados, retenção, lista de restritos, exclusão dos fictícios da reconciliação (assinaturas, cancelamento remoto, intenções) e desmarcar.
- **Operacional real em homologação (opt-in, `tests/billing-operational-restrictions.homolog.test.ts`):** seis fases anteriores (ativa, tolerância, suspensa, regularizada, cancelada vigente, encerrada) com API direta, IA e agendamentos reais com provedor falso; nesta etapa foi acrescentado o guard real contra o banco real (fase encerrada: restrita barrada, controle liberado). As demais fases do novo teste do guard **não** foram repetidas (a organização O está encerrada).
- **Não provado:** HTTP real nas rotas de WhatsApp/relatório com sessão de navegador (só chamadas de rota simuladas), execução real do cron monitorado (migration 0007 não aplicada), entrega externa real (nenhuma foi feita, por desenho).

## 10. Procedimento de homologação (depois da sua autorização)
1. Aplicar 0007 e 0008 em `igrow-homologacao` (uma por vez, conferindo) e publicar a versão com as travas na Vercel de homologação.
2. Marcar as organizações fictícias do inventário (§8) com `billing_mark_synthetic`.
3. Provar as rotas na homologação com uma organização fictícia restrita (HTTP real com sessão): bloqueios e leitura preservada.
4. Ligar o QStash de homologação (`*/5`, GET, bypass e segredo só em cabeçalhos) e conferir `/health`, a tabela de execuções e uma falha provocada (segredo errado → 401 no QStash, sem alterar dados).
5. Iniciar o teste real de sete dias (organização N) com o cron monitorado.

---

# Homologação em `igrow-homologacao` e na Vercel de homologação (etapa 2.2E, 15/10/2026)
Classificação: **HOMOLOGAÇÃO COM RESSALVAS** (ressalvas em §14, §16 e §18). Nada em produção, VPS, Evolution API ou QStash; nenhum pagamento, cobrança, cancelamento, cron financeiro real, commit ou push.

## 11. Migrations 0007 e 0008 (aplicadas SOMENTE em `xvjvfvinnnrgnhskglvd`)
- Projeto remoto confirmado antes de aplicar (`igrow-homologacao`, `ACTIVE_HEALTHY`), sem `db push`, sem reset, sem reaplicar anteriores. Registradas como `billing_cron_monitor_0150007` e `billing_synthetic_records_0150008`.
- Revisão: incrementais; a única operação destrutiva é a retenção de 30 dias do próprio histórico de monitoramento; a 0008 recria `billing_reconcile_work` com a MESMA lógica da 0005 mais três exclusões (`diff` conferido: intenções, assinaturas e cancelamento remoto de clientes marcados). Privilégios: todas as funções novas só `service_role`; tabela `billing_cron_runs` com RLS e sem grants para usuário/anônimo (conferido no banco real).
- **0008 reforçada antes de aplicar:** `billing_mark_synthetic(agência, bool, motivo)` exige motivo (≥10 caracteres), **recusa organização com cliente financeiro no formato real do Asaas (`cus_` + 12 dígitos)**, exige cliente financeiro existente e grava `billing.synthetic_marked/unmarked` na auditoria imutável; `billing_synthetic_report()` lista as marcadas. Só servidor: usuário comum, anônimo e operador não têm acesso (HTTP anônimo = 401 comprovado).
- Preservação (antes × depois): assinaturas, pagamentos e direitos com hashes idênticos; contagens iguais.

## 12. Registros fictícios: identificação individual e marcação
Critérios: (1) identificador financeiro fora do formato real do Asaas; (2) **57 identificadores (clientes, assinaturas e cobranças) consultados individualmente no Asaas Sandbox: todos 404**; (3) nenhuma organização com cliente real marcada (a função recusa).
**Marcadas (24 organizações, 24 registros na auditoria):** "TESTE-2.2 contratação" ×5 (2.2A/B), "TESTE-2.2C" r1 ×2, r3 ×2, r6 ×2, r7x ×2, r7y ×2, r8 ×2, r9 ×2 (recuperação), "TESTE-2.2L" atraso/cancel/renov (ciclo de vida), TESTE-2.2O e TESTE-2.2P (restrições). Cada uma tem o motivo gravado.
**NÃO marcadas (13, reais no Asaas):** "TESTE-2.2 Org Asaas real" ×3 (clientes reais; assinaturas já removidas no Asaas), B, D, E, F, G, H, I, J, K, M. Criadas depois, só para o teste HTTP: Q (DB-only, marcada) e R (legada, sem plano e sem cliente financeiro).
Nada foi excluído, cancelado ou alterado nos pagamentos.

## 13. PostgreSQL real (transações revertidas e conexões independentes)
- Saúde: sem execuções = `ok=false`, `never_ran` (**nunca é "saudável"**); após um sucesso = `ok=true`; produção separada (continua `never_ran`); parada >15 min = `no_recent_success`; 3 não-sucessos seguidos = `consecutive_failures`.
- Restritos: `billing_restricted_agency_ids` = exatamente as atribuições `restricted`.
- Reconciliação real com a marcação ativa: assinaturas devolvidas = só a real elegível; **0 fictícias** entre elas, **0 cancelamento remoto fictício** (a O tinha uma pendência), **0 intenções fictícias**.
- Proteções: marcar organização real recusado (42501), motivo curto recusado (22023); auditoria imutável (update e delete recusados).
- Concorrência real (8 conexões): 8 inícios simultâneos → 8 identificadores distintos; 8 conclusões simultâneas sem erro; 5 repetições da mesma execução não alteram o resultado. As linhas de teste foram removidas (só o monitoramento) e a saúde voltou a `never_ran`.

## 14. Restrições comerciais: HTTP REAL na aplicação de homologação (deploy `dpl_HeEJDw5U…`, Ready)
Script: `scripts/check-billing-restrictions-http-homolog.mjs` (sessões fictícias dos proprietários; bypass da Vercel em cabeçalho; sem segredo impresso). Operações pagas liberadas falham DENTRO do app (HTTP 502: sem WhatsApp/Meta conectado e sem credenciais de provedor): nenhum efeito externo.
| Organização / estado | WhatsApp nova conversa, relatório por WhatsApp, Meta ao vivo (saldo, audiência) | Leitura (conversas, assinatura, painel do cliente, visão geral) | Cliente de outra organização |
|---|---|---|---|
| P: ativa | liberado (502 interno) | 200 | 307 (recusado) |
| Q: ativa → em atraso (tolerância) | liberado | 200 | 307 |
| Q: tolerância encerrada (`suspended`/`restricted`) | **403 `billing_restricted` nas 4** | 200 | 307 |
| Q: regularizada | liberado de novo | 200 | 307 |
| O: assinatura e período encerrados | **403 nas 4** | 200 | 307 |
| R: legada, sem plano comercial | liberado | 200 | 307 |
Limitações honestas: (a) as tabelas de conversas/mensagens do WhatsApp **não existem** no banco de homologação (o inbox não foi migrado nesse banco), então `send`, `send-extra`, `react` e o histórico de conversas só foram provados com mocks; (b) as ações de servidor (gerar/publicar relatório, atualização do painel) não são chamáveis por HTTP simples: provadas com mocks e com as funções profundas reais; (c) IA e agendamentos: provados antes com o mecanismo real e provedor/remetente falsos (nenhum crédito usado, nenhuma mensagem enviada); (d) "retroativo": as execuções do período restrito permanecem `skipped` e nada é refeito.

## 15. Rota de saúde, webhook, cron e financeiro (pós-deploy)
- `/api/cron/billing/health`: sem autenticação 401; segredo errado 401; autenticada **503 `never_ran`** (nenhuma execução registrada porque o cron real NÃO foi executado); a resposta só tem horários, estados e contagens. `/api/cron/billing`: sem segredo e com segredo errado 401, sem executar nada.
- Webhook: token original 200 (duplicado), token errado 401; fila do Asaas habilitada e não interrompida.
- Asaas Sandbox: 9/9 assinaturas ACTIVE; nenhuma cobrança criada nesta etapa (total de cobranças na conta = 24, igual ao esperado após a renovação anual); no banco, assinaturas reais, pagamentos e direitos de B, D, E, F, G, H, I, J, K, M inalterados (hashes iguais ao início).
- Deploy: cópia do código sem `crons`; `vercel.json` sem agendamentos permanentes; 4.200 arquivos (`src`, migrations, `public`, configuração) conferidos com o repositório, 0 diferenças.
- `pnpm check`: lint, typecheck, 156 arquivos de teste (1.124 testes passaram, 6 do teste opt-in ignorados), SQL no PGlite e build; saída 0.

## 16. Google Ads: avaliação (nada implementado)
1. **Somente ao vivo:** todas as métricas do Google (série diária de cada conta, série do período anterior e tabela de campanhas) são lidas da API a CADA visualização do painel do cliente e a cada execução de agendamento/relatório (`loadGoogleSections`, sem cópia). Os PDFs do Google são montados no navegador a partir dessas leituras.
2. **Guardado:** só conexão (`google_connections`), catálogo de contas (`google_ad_accounts`) e vínculos cliente×conta (`client_google_accounts`). Não existe tabela de métricas.
3. **Cache reutilizável:** não há (nem em banco nem de aplicação).
4. **Preservar a visualização histórica sem novas consultas:** hoje **não é possível**, porque nada foi guardado.
5. **Menor alteração para respeitar a política:** (B) em `client-analytics-screen.tsx`, com o acesso restrito, não chamar `loadGoogleSections` e mostrar um aviso ("Google Ads: atualização ao vivo indisponível enquanto o acesso estiver restrito; conexão e contas preservadas"). Sem efeito nos dados nem nas integrações; efeito: **a seção do Google (e o PDF dela) some do painel durante a suspensão**, enquanto o histórico da Meta continua. A alternativa (A) é manter a leitura ao vivo liberada até existir armazenamento (não gera custo do iGrow, só usa a cota do Google). Recomendação: **A por enquanto, sem mudança de código, e planejar o armazenamento diário das métricas do Google (arquitetura nova) para depois adotar B sem perder o histórico**; se a política exigir bloqueio imediato, B (cerca de 10 linhas). Em homologação há 3 vínculos ativos; produção não foi consultada.

## 17. WhatsApp
"Apagar para todos" permanece disponível durante a suspensão (decisão aprovada); nenhum código dele foi alterado. Novas mensagens, reações, relatórios enviados e automações continuam bloqueados; a consulta ao histórico continua (provada só por mocks, por causa da limitação 14a).

## 18. QStash: pré-requisitos e ativação posterior (nada criado)
Preparado: `scripts/billing-cron-schedule.mjs` (revisão sem argumentos; ativação só com `--apply --confirm=<scheduleId>`), com testes de rede simulada. Verificações que **dependem de você**, pois não há `QSTASH_TOKEN` em nenhum arquivo local nem na Vercel de homologação: plano da conta, mensagens/dia consumidas pelos agendamentos existentes (Meta `*/15` = 96/dia), limite de agendamentos e chaves `QSTASH_CURRENT/NEXT_SIGNING_KEY`. Fatos conferidos hoje: a rota aceita só GET; autenticação `Bearer CRON_SECRET`; **nenhuma rota verifica `Upstash-Signature`** (camada extra opcional, ainda não implementada); o bypass da proteção da Vercel funciona por **cabeçalho** (sem segredo na URL); callback de falha e `Upstash-Retries` são suportados pelo QStash.
Procedimento (depois da sua autorização): (1) conferir plano e franquia no console; (2) definir `BILLING_CRON_ORIGIN=https://i-grow-reports-homolog.vercel.app`, `BILLING_CRON_ENVIRONMENT=homolog`, `CRON_SECRET` de homologação, `VERCEL_BYPASS_SECRET`, `QSTASH_TOKEN` e, opcionalmente, `BILLING_ALERT_CALLBACK_URL`, só no ambiente do comando (nunca em arquivo versionado); (3) revisar o plano (`node scripts/billing-cron-schedule.mjs`); (4) ativar com `--apply --confirm=<scheduleId>`; (5) acompanhar 3 rodadas em `/health`; (6) provocar uma falha controlada (segredo errado → 401, sem efeito); (7) só então o teste de sete dias.
