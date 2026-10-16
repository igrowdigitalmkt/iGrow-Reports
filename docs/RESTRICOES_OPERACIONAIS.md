# Restrições financeiras: validação operacional e agendamento (etapa 2.2C, 15/10/2026)

Status: **investigação, testes em homologação e proposta.** Nenhuma correção de código foi necessária; nenhum deploy, migration, commit, cron permanente, pagamento ou cobrança nesta etapa.

## 1. Onde a restrição é aplicada (backend)
| Operação | Mecanismo | Tipo |
|---|---|---|
| Assistente de IA, comentário de relatório, resumo da carteira, resumo de WhatsApp | `runGuardedGeneration` → `agency_ai_entitlement` (`billing_restricted`) **antes** de montar a chamada ao provedor; todos os usos passam por ele (único `new Anthropic` do código) | servidor + banco |
| Agendamentos (automáticos, "executar agora" e aprovação) | `executeAutomation` consulta `agency_billing_restricted` antes de resolver remetente, ler números, chamar IA ou enviar. Estado desconhecido → não executa | servidor |
| Criar cliente / desarquivar | gatilho `enforce_clients_limit` | banco (vale para app, API e jobs) |
| Convites e membros | gatilhos `enforce_team_members_limit` em `agency_invitations` e `agency_users` | banco |
| Contas de anúncios (Meta/Google), números de WhatsApp, ativar agendamento, portal do cliente (convite/ativação) | gatilhos de limite/recurso | banco |
| Limites por plano | `resolve_entitlement` (plano, concessões, `billing_restricted` → limites 0, recursos desligados) | banco |
Organizações sem plano atribuído continuam "não gerenciadas": nada muda para as antigas.

> **Atualização (etapa 2.2D):** os itens 1, 3 e parte do 2 abaixo foram tratados no código; ver `docs/SUSPENSAO_E_MONITORAMENTO.md` (política aprovada, travas, monitoramento do cron, proposta QStash e inventário de fictícios).

## 2. Operações SEM restrição financeira (decisão de produto — não há direito no catálogo)
1. **Resposta manual na caixa de entrada do WhatsApp** (`/api/whatsapp/inbox/.../send`, `react`): só valida membro e papel; organização suspensa continua conversando.
2. **Portal do cliente já ativo:** a restrição vale só para criar convite/ativar usuário; clientes finais já ativos continuam lendo (`has_client_access`/RLS não consultam `client_portal`).
3. **Coleta/sincronização** (Meta, Google, workers e crons diários) segue para organizações suspensas (custo de API; dados continuam atualizados).
4. **Geração manual de relatório/PDF** e leitura de painéis: sem direito comercial (dados preservados por política).
5. **E-mail:** não há envio de e-mail de relatório no código.
Se a política quiser bloquear algum item, criar a chave no catálogo e o gatilho/consulta no ponto correspondente (exige migration; não feito).

## 3. Testes operacionais (homologação; organizações fictícias TESTE-2.2O estado variável e TESTE-2.2P controle sempre ativo)
Arquivo opt-in `tests/billing-operational-restrictions.homolog.test.ts` (ignorado no `pnpm test`; exige `HOMOLOG_OPERATIONAL_PHASE` e os arquivos locais de homologação). Assinaturas fictícias só no banco (nenhuma chamada ao Asaas), plano TESTE-2.1 v2; transições por funções do próprio fluxo (`billing_apply_payment`, `billing_run_maintenance`, `billing_request_cancel`).
| Fase | Estado | Cliente (API direta, sessão do proprietário) | Convite (servidor) | IA (mecanismo real, provedor falso) | Agendamento (mecanismo real, remetente falso) |
|---|---|---|---|---|---|
| active | ativa | permitido | permitido | provedor chamado 1× | passou da trava; pediu o remetente |
| tolerance | atraso (`past_due`) | permitido | permitido | provedor 1× | passou da trava |
| suspended | tolerância encerrada (`suspended`/`restricted`) | **53400** | **53400** | **0 chamadas**, `blocked_disabled` | `skipped` "acesso restrito", remetente **0** pedidos, 0 entregas |
| restored | regularizada | permitido | permitido | provedor 1× | passou da trava |
| canceled_vigent | cancelada com período pago vigente | permitido | permitido | provedor 1× | passou da trava |
| ended | período encerrado (`canceled`/`restricted`) | **53400** | **53400** | **0 chamadas** | `skipped`, 0 pedidos |
Também em todas as fases: dados existentes legíveis; sessão do proprietário de O não insere em P (RLS) nem consulta direitos/cobrança de P (42501); P (controle) sempre permitido; `agency_billing_restricted` recusada para sessão e anônimo; convite direto pela sessão do usuário recusado (RLS 42501). Nenhuma execução de agendamento ficou `sent`; as execuções do período restrito permanecem `skipped` e não são refeitas (o horário é consumido antes da execução).
Níveis de prova: **chamada real à API do Supabase** (clientes, convites, direitos), **execução real de mecanismo interno com dependências falsas** (IA e agendamentos), **banco** (gatilhos), **nenhuma entrega externa** (nem WhatsApp, nem créditos de IA). **Não** provado: HTTP real nas rotas da aplicação com sessão de navegador (rotas de IA/agendamento), execução do cron real de agendamentos, ad accounts/WhatsApp/portal/ativação de agendamento por API direta (cobertos pelos testes pgTAP de `commercial-catalog`).

## 4. Agendamento permanente do `/api/cron/billing` (proposta; nada configurado)
Infra já usada: (a) agendador do servidor de WhatsApp (VPS) chama `/api/cron/report-automations` com `CRON_SECRET`; (b) **QStash (Upstash)** agenda o worker da Meta (`scripts/worker-schedule.mjs`: cron `*/15`, `Upstash-Forward-Authorization`, retries 0); (c) Vercel Cron só diário (Hobby; `vercel.json`).
**Recomendação: QStash, um agendamento por ambiente**, no mesmo molde do worker da Meta: `*/5 * * * *`, método GET, `Upstash-Forward-Authorization: Bearer <CRON_SECRET do ambiente>`, `Upstash-Schedule-Id` derivado da origem (homologação e produção nunca compartilham), `Upstash-Redact-Fields` para o cabeçalho, `Retries: 2` (rota idempotente), `Upstash-Failure-Callback` para um aviso. Roda sem computador pessoal, sem VPS e sobrevive a reinícios; limite gratuito 1.000 mensagens/dia (≈ 288/dia por ambiente a cada 5 min, mais 96 da Meta; retentativas contam).
- **Autenticação:** já existe (`Bearer CRON_SECRET`, comparação por hash em tempo constante, 401 sem segredo, 503 se não configurado). Segredos distintos por ambiente (já são).
- **Concorrência:** segura por desenho: eventos reivindicados com `for update skip locked` e lease de 120 s; assinaturas reivindicadas com janela de 4 min; manutenção idempotente. Duas execuções simultâneas não duplicam.
- **Timeouts:** rota com `maxDuration 120` e orçamento interno de 90 s; o que sobra é retomado na rodada seguinte. Confirmar o limite de duração da função no plano Vercel do projeto antes de produção.
- **Falhas:** retries do QStash + DLQ (retenção 3 dias no plano gratuito). A rota devolve 500 genérico e loga `billing-cron-failed` sem dados sensíveis.
- **Monitoramento da última execução:** hoje a rota **não grava heartbeat**. Sem migration, usar `max(reconcile_attempted_at)` (assinaturas em atraso são reconferidas de hora em hora) e os logs do QStash. Recomendado para produção: tabela/linha de heartbeat com a última execução e resultado + alerta quando passar de ~15 min (exige migration; não feito).
- **Alertas:** callback de falha do QStash para e-mail/WhatsApp interno e verificação "última execução > 15 min".
- **Capacidade:** 15 assinaturas e 10 eventos por rodada (orçamento 90 s) = ~180 assinaturas/hora de reconferência prioritária; suficiente para a fase inicial. Aumentar `limit` ou frequência antes de centenas de assinaturas.
- **Atenção em homologação:** com o cron ligado, a reconciliação trata como "removida" (404) toda assinatura fictícia sem correspondente no Asaas (TESTE-2.2L e as assinaturas `sub_OP*_FICT` de O/P); isso cancela essas assinaturas fictícias. Termine os testes que dependem delas antes de ligar o cron.
- **Não utilizar** laço local nem tarefa agendada no computador pessoal para o teste longo.

## 5. Preparação do teste real de sete dias (TESTE-2.2N) — NÃO iniciado
1. **Agendador:** schedule QStash `*/5` do ambiente de homologação apontando para `https://i-grow-reports-homolog.vercel.app/api/cron/billing` (com o bypass de proteção da Vercel e o `CRON_SECRET` de homologação). Criar só depois de autorização; precisa de `QSTASH_TOKEN` (hoje ausente em `.env`).
2. **Acompanhamento:** consulta diária (leitura) com `scripts/check-billing-renewal-homolog.mjs n` + `max(reconcile_attempted_at)`, logs do QStash (eventos/DLQ) e a fila de eventos do banco. Interrupção = nenhuma execução registrada no QStash por > 15 min ou `reconcile_attempted_at` da N > 2 h.
3. **Isolamento:** a N é a única organização com atraso real; as demais assinaturas de teste só são reconferidas (somente leitura no Asaas, mesmos valores). Antes de ligar, decidir o destino das fictícias que serão "removidas" (§4).
4. **Fluxo:** contratar plano mensal (você paga) → `paymentBook` (mês 11/2026) → `overdue` → observar `past_due` e tolerância até D+8 00:00 (Brasília) → aguardar o cron suspender (`suspended`/`restricted`) → verificar direitos suspensos (testes operacionais acima, fase `suspended`, contra a N) → `confirm` na cobrança atrasada (ou pagar pela fatura) → verificar reativação. Desligar o schedule ao terminar.
5. **Sem alterar relógio nem datas.**

## 6. Riscos que ainda impedem produção
- Cron permanente inexistente e **sem heartbeat/alerta** (suspensão, fim de período e recuperação dependem dele).
- Migrations 0004–0006 só em homologação; produção não tem o ciclo de vida.
- Itens da seção 2 sem decisão de política (WhatsApp manual, portal ativo, sincronizações).
- Cobrança automática real e suspensão por expiração real nunca observadas.
- Chaves/webhook/URL do Asaas de produção e `live_enabled` desligado (decisão e checklist de go-live).
- Teste de ponta a ponta no navegador das telas de atraso/suspensão com usuários reais.
