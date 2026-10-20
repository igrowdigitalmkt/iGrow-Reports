# Gestão operacional de Campanhas (ciclo de 20/10/2026)

Integridade dos dados, controle financeiro global da IA, operações manuais e análise operacional assistida por IA.
Estado: implementado e testado localmente. Publicação e homologação real: ver a seção "Publicação" ao final.

## A. Integridade dos dados

### A1. De onde vêm os zeros
- Zero por **linha da Meta** é legítimo: `periodInsightValues` produz zero quando a linha da entidade existe e a entrega (impressões e alcance) vem omitida/zerada. Foi o que vimos nos payloads de produção (`meta_dashboard_scopes`: p. ex. 276 de 291 entidades com gasto zero, todas com linha).
- Zero por **ausência de linha** só existia em um ponto: `analytics-hierarchy-loader.ts` preenchia com `confirmedEmptyPeriodValues` toda campanha do catálogo ao vivo sem linha, usando o agregado confirmado da CONTA como prova. Isso é inferência no nível errado.
- Correção (commit `c803cec` + ajuste): Campanhas (catálogo completo ou somente catálogo) **nunca** infere zero; a campanha sem linha fica desconhecida ("—"). O painel (Dashboard) mantém o contrato anterior, protegido por teste próprio (`tests/analytics-live-status.test.ts`): zero só com a resposta completa e confirmada do período, porque a Meta omite entidades sem entrega.
- Testes: `tests/campaign-hierarchy-catalog.test.ts` (nova regressão, falha sem a correção), `tests/analytics-live-status.test.ts`.

### A2. Divergência de R$ 0,31 no Dashboard
- Conta com R$ 1.597,64 no agregado da Meta (coletado 20/10 12:05 UTC) contra R$ 1.597,33 na soma das linhas diárias (coletadas 20/10 09:00 UTC). A outra conta bate exatamente (R$ 2.860,48). Total mostrado R$ 4.290,69 = agregado da Meta menos o período comparado; a soma diária daria R$ 4.290,38.
- Causa: duas leituras independentes da Meta em momentos diferentes (e arredondamento por dia em centavos contra agregado do período). Não é erro de soma: a soma de contas usa decimais exatos (`Decimal`), o que ficou coberto por teste (`tests/meta-insight-values.test.ts`).
- Decisão: **não forçar** os números a coincidirem. O agregado da Meta é o valor oficial exibido; o carimbo de coleta aparece na tela. Divergência de centavos entre agregado e soma diária é esperada quando as coletas diferem.

## B. Controle financeiro global da IA
- `runGuardedGeneration` (comentário de relatório, resumo da carteira, resumo do WhatsApp) agora **reserva antes de chamar** (`reserve_ai_usage`, estimativa conservadora: toda a saída permitida mais a entrada por byte), liquida com o consumo conhecido (`settle_ai_usage`), mantém a estimativa como consumo desconhecido em falha sem informação e libera a reserva só em recusa certa do provedor (4xx). Falha ao liquidar **retém o texto** (nunca sucesso silencioso). `requestId` opcional dá idempotência.
- `decision-cycle` (`agent_decision`): somente contabilidade; reserva por conta analisada (identificador determinístico por conta, fatos e hora), liquidação com uso real inclusive quando o validador rejeita a saída (o motor passou a devolver o uso). Falha de liquidação interrompe o ciclo. Regras de decisão, aprovação e execução não foram tocadas.
- Consumidores de IA no sistema: relatório, carteira, WhatsApp, decisão do agente, assistente de Campanhas. **Todos** passam por reserva. Limitações honestas: o teto é do banco de dados (soma de `ai_usage` do mês, incluindo reservas), mas a estimativa de reserva não é garantia contratual do provedor (é um limite superior prático); consumo desconhecido permanece contado pela estimativa até conciliação.
- Testes: `tests/ai-report-comment.test.ts` (reserva antes da chamada, recusas, liquidação, falha de liquidação, idempotência), `tests/agent-decision-cycle.test.ts`.

## C. Operações manuais
- Reutiliza `manual-actions.ts` (ledger `execution_origin = 'manual'`, mesma fila, trava de uma mutação por conta) e `executeMetaWrite` (GET → política → POST → GET). Nenhuma infraestrutura de escrita nova.
- Ações: pausar/retomar campanha e conjunto; alterar orçamento diário de campanha e conjunto (o executor já suporta). Sem operações em anúncios.
- Servidor (`src/modules/campaigns/manual/control.ts`): papel proprietário/administrador, cliente da organização, vínculo ativo, conta, conexão com `ads_management`, interruptor do ambiente **e** direito comercial, leitura **ao vivo** da entidade na Meta (titularidade e tipo vêm do provedor), operação em andamento na conta, estado que o usuário viu (recusa se a Meta mudou), valor do orçamento (moeda, casas decimais, limite de aumento de 1000%, igual ao do executor). Orçamento só aparece se confirmado no nível; compartilhado, vitalício ou ausente nunca vira controle e nunca é derivado do gasto.
- Resultados mapeados: confirmado, aguardando verificação (conta bloqueada), bloqueio de segurança antes do envio, serviço indisponível, duplicado, ocupado, estado desatualizado.
- Interface: cartão "Operações" nas páginas de campanha e conjunto, caixa de confirmação (entidade, conta, operação, consequência, valores anterior e novo, reconhecimento explícito para ações financeiras), estados de permissão/executor/conta/estado desconhecido e histórico do ledger (origem manual ou IA, aprovação, confirmação). A tela só atualiza os dados depois da confirmação efetiva da Meta.
- **Correção (21/10):** o executor NÃO está desligado em produção: o direito `agent_executor_meta` está ligado globalmente e há um override da organização iGrow Digital válido até 26/10/2026 13:07 UTC (homologação controlada, Colégio Crescer, teto R$ 100,00/dia, autorizada em 19/10). Os controles manuais funcionam de verdade nesse escopo. Nenhuma campanha real foi alterada neste ciclo.

## D. Análise operacional com IA
- "Analisar oportunidades" (acima da lista de Campanhas) chama o `runDecisionCycle` existente, só para proprietário/administrador, com mecanismo habilitado, IA configurada, plano/cota, conta vinculada e **delegação vigente**.
- Cinco estados: Observação, Recomendação, Proposta operacional, Aguardando aprovação, Executada. Toda proposta financeira entra em `awaiting_approval` pelo caminho existente e só executa com a aprovação humana específica (`/agente/aprovacoes`); a tela nunca aprova nem executa.
- Impacto: orçamento proposto (valor conhecido) e gasto confirmado do período; sem dado, "impacto não calculado".
- Escopo real declarado na tela e no Assistente Groow (consultivo): campanhas e conjuntos, 14 dias contra os 14 anteriores, pausar/retomar/orçamento; anúncios, criação, públicos e criativos fora.
- Testes: `tests/campaign-opportunities.test.ts` (18).

## Paridade da homologação (decisão)
- A homologação (`xvjvfvinnnrgnhskglvd`) e a produção divergem: a homologação tem 34 migrations com histórico próprio e não tem o esquema analítico, de WhatsApp e coleta Meta; a produção não registra no histórico as migrations iniciais. **Replay das migrations sobre a homologação existente não é seguro** (nomes/versões divergentes, funções com versões diferentes).
- Caminho incremental recomendado (não executado, exige autorização e custo): (1) criar um projeto/branch Supabase **novo e vazio**; (2) aplicar a cadeia completa do repositório em ordem (`supabase/migrations`), a mesma que `node supabase/tests/rls-smoke.mjs` já replica do zero em PGlite; (3) rodar a bateria de testes de banco e a aplicação apontada para ele; (4) só então aposentar a homologação antiga. Nenhum reset nem migração em massa na homologação atual.

## Publicação
Ver `docs/PROJECT_STATUS.md` (registro de commits, deploy e verificações).
