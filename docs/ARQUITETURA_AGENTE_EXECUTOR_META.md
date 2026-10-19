# Groow Ads — primeiro agente executor de campanhas (Meta Ads)
**Levantamento técnico inicial: 18/10/2026 | Estado: arquitetura proposta, sem ações reais, migrations ou deploy.**
**Diretriz-mãe:** [Visão estratégica](VISAO_ESTRATEGICA_GROOW_ADS.md). Este documento é a primeira tradução técnica daquela decisão e não substitui evidência de homologação.

## 1. Problema de produto e resultado mínimo

A Groow Ads deve executar o trabalho de marketing. A IA que apenas sugere modificações deixa o usuário com a tarefa operacional. **Primeiro ciclo comercial indispensável:** o usuário descreve seu negócio, define objetivo/limite de investimento, conecta uma conta e delega escopos. A IA observa dados, toma uma decisão fundamentada, **altera uma campanha real quando autorizada**, confirma o efeito na API e continua acompanhando.

Indicador principal: horas e ações humanas substituídas, não número de gráficos ou sugestões. A delegação prévia cobre ações rotineiras dentro do envelope; não pedir aprovação humana a cada execução autorizada.

## 2. Inventário verificado no código do repositório

| Componente existente | Evidência localizada | Consequência para execução |
| --- | --- | --- |
| Meta Graph API client | `src/modules/meta/client.ts`: `requestPage` faz `GET`; `listCampaigns`, `listAdSets`, `listAds`, `getObjects` | **Somente leitura.** Não há `POST` para campanhas/anúncios nem método de confirmação pós-escrita específico. |
| Autorização de conexão | `src/modules/meta/server.ts`: `connectMetaForClient` exige `ads_read`, valida contas, armazena `grantedScopes` em `meta_connections.scopes` | A validação na conexão **só exige** `ads_read`, mas uma checagem agregada no Supabase de produção em 18/10 identificou **3 conexões, todas com `ads_management` registrado**. Falta verificar se os tokens e o aplicativo ainda dispõem de acesso efetivo de escrita em contas elegíveis. |
| Login Meta | `src/modules/meta/facebook-login.tsx`, `login-config.ts`: Facebook Login configurado por `META_LOGIN_CONFIG_ID` | Confirmar no painel Meta quais permissões a configuração realmente solicita e quais foram aprovadas; não basta alterar o backend. |
| Credenciais Meta | `src/modules/meta/server.ts`: token protegido por `storeAccessToken`/`loadAccessToken`, conexão escopada a organização+cliente | Reaproveitar. Jamais enviar token ao modelo, cliente HTTP do navegador ou logs. |
| Isolamento e entidades | `integrations`, `meta_connections`, `meta_ad_accounts`, `client_ad_accounts`; `requireAgencyContext` | Vincular cada plano/ação ao mesmo `agency_id`, `client_id`, `account_id`, `connection_id`; confirmar vínculo **de novo** no executor. |
| IA atual | `src/modules/ai/guarded-text.ts`, `report-comment.ts`, `actions.ts`: geração de texto, limites comerciais e registro de tokens/custo | **Não reutilizar texto livre como comando.** Criar saída estruturada com schema e validação, reaproveitando custeio e permissões, se tecnicamente compatível. |
| Metas e contexto | `src/modules/clients/profile*`, `src/modules/reports/report-facts.ts`, dados/analytics Meta | Reaproveitar como contexto, mas exigir objetivo do negócio, teto em moeda da conta e janela de decisão. |
| Cobrança e direitos | `src/modules/billing/guard.ts` e regras comerciais | Ações executoras devem ser bloqueadas para agência/assinatura inelegível e se ultrapassarem limites do plano. |
| Google Ads | Integração separada; não considerada homologada para escrita neste levantamento | **Fora do primeiro corte**. Aplicar arquitetura ao Google quando um adaptador específico estiver pronto. |

**Conclusão:** a base de dados e consulta é reaproveitável, mas **não existe ainda o caminho confirmado IA → decisão estruturada → política de delegação → escrita Meta → verificação → aprendizado**.

## 3. Bloqueio externo mais importante: Meta

A Meta exige `ads_management` para criação/gestão; `ads_read` não substitui. **Achado de leitura em produção:** as três conexões atualmente registradas armazenam `ads_management` em `meta_connections.scopes` (sem expor tokens, usuários ou contas); isso é um bom sinal, mas não comprova permissão de escrita atual nem autorização para executar ações. A Meta também separa a **permissão ads_management** da categoria **Marketing API Access Tier (Limited/Full)**, cujo nível aplicável a outras empresas e limites deve ser conferido no app real. Os acessos concedidos no painel, função da pessoa na conta e eventuais revisões do aplicativo influenciam as ações disponíveis.

**Conferir sem modificar produção:** permissões aprovadas do aplicativo de anúncios, configuração de Facebook Login, modo de produção, scopes efetivamente válidos no Graph API para uma conexão de teste, elegibilidade de conta de anúncios e limites da API. Evitar reconexões desnecessárias se o token vigente já for suficiente. Não inferir acesso de escrita só porque campanhas são visíveis.

Fontes técnicas para revalidar ao implementar: [Meta — nomenclatura e requisitos de Marketing API Access Tier](https://developers.meta.com/blog/updates-to-ads-management-standard-access-feature/), [Meta — coleção oficial Marketing API](https://www.postman.com/meta/facebook-marketing-api/overview) e [Meta Business SDK](https://github.com/facebook/facebook-nodejs-business-sdk).

## 4. Primeira capacidade comercial que recomendo

**Agente de Otimização Meta com autonomia delegada**, inicialmente por conta de anúncios, evoluindo para uma organização com várias contas.

### Degraus técnicos (todos necessários antes de prometer autonomia completa)

1. **Pausar/reativar campanhas elegíveis**: validar contexto/status e impedir reativação que ultrapasse orçamento. Tratar status configurado e status efetivo separadamente.
2. **Ajustar orçamento diário** de campanha ou conjunto **onde a estrutura de orçamento o permite**; validar moeda/unidades menores, mínimos da Meta, estratégia de orçamento, diferença relativa e teto absoluto autorizado. Não presumir orçamento em todos os níveis simultaneamente.
3. **Criar campanha completa**: a API normalmente exige criar campanha + conjunto + criativo + anúncio. Coletar criativo/página/pixel/destino/objetivo somente quando necessário, criar primeiro em `PAUSED`, verificar toda a hierarquia antes de autorizar ativação segundo a delegação.
4. **Executar repetidamente**: agendador decide quando reavaliar, evita mudanças oscilatórias e ciclos de aprendizagem; audita e aprende dos resultados, sem reavaliar a cada minuto por padrão.

O primeiro marco técnico é **uma ação de escrita real comprovada em conta de teste do proprietário, sem alterar despesas**, seguida de mudança de orçamento dentro de um teto baixo. A **primeira oferta comercial divulgada**, porém, deve incluir um ciclo útil de execução e acompanhamento, não apenas um botão “pausar”.

**Cuidado:** trocar o objetivo de campanha existente pode não ser suportado; nesses casos o agente propõe/cria substituta, nunca promete edição impossível.

## 5. Arquitetura alvo: fluxo em seis estágios

`Contexto confiável + Meta insights` → **Planejador IA (JSON schema)** → **Validador determinístico** → **Fila/ledger com idempotência** → **Executor Meta (server-only)** → **Leitura de verificação e acompanhamento**.

### 5.1 Briefing e delegação

`agent_business_context` (proposta): perfil do negócio, segmento, produtos/serviços, metas, mercados, restrições, sazonalidade, objetivos por campanha; aproveitar `client_profiles`.

`agent_delegations` (proposta): agência/cliente/conta, concedente, estado, expiração/revogação, ações permitidas, limites absolutos e percentuais, teto acumulado por período, tetos diários, janela de execução, políticas de risco, versão de consentimento. Autorização natural no onboarding, mas verificável pelo servidor.

Separar **orçamento de anúncios na moeda da conta Meta** do orçamento de **tokens de IA em USD**, que já existe. Não misturar os dois.

### 5.2 Decisão estruturada

IA retorna um objeto validado com: `agencyId`, `clientId`, `adAccountId`, `actionType`, `entityId`, `desiredValue`, `factsSnapshotId`, `rationale`, `expectedDirection`, `confidence`, `expiresAt`.

O servidor não confia no modelo: IDs de organização/conta e escopo são resolvidos no banco e na credencial, não aceitos livremente do JSON gerado. `confidence` não substitui limites nem prova de eficácia. A IA não computa custos ou KPIs por conta própria.

### 5.3 Política determinística e prevenção de danos

Antes de qualquer ação: verificar agência e assinatura, delegação ativa, usuário e conta elegíveis, `ads_management` efetivamente concedido, status atual da Meta, dados não obsoletos, limites do plano e orçamento, restrições legais/setoriais/Meta e ausência de decisão conflitante em andamento.

Bloquear por padrão: ação sem política, gasto sem teto, moeda indefinida, dado incompleto, status incerto, conta divergente, consentimento vencido, limite excedido, objetivo não suportado ou execução duplicada.

Ações dentro do envelope já autorizado podem seguir automaticamente; fora dele exigem ajuste da delegação ou aprovação específica. Não fazer a interface pedir confirmação para toda operação permitida.

### 5.4 Ledger e executor

`agent_actions` (proposta): evento imutável por transição, `idempotency_key`, `proposal`, `policy_version`, `status`, `before`, `after`, `request_id`, `provider_ref`, timestamps, erro sanitizado, `verified_at`, origem e custo IA.

Estados sugeridos: `proposed → authorized → queued → executing → verifying → verified`; alternativas `rejected`, `expired`, `unknown_outcome`, `failed`, `needs_attention`.

Fila por conta/entidade para evitar decisões concorrentes. **Não repetir POST automaticamente** quando a API falhar após envio: o resultado pode ter sido aplicado. Primeiro consultar o estado externo; criação deve ter estratégia explícita para deduplicar e reconciliar IDs.

Reutilizar `MetaClient` para `GET`; adicionar um adaptador de escrita server-only, com allowlist de operações e parâmetros, separado dos métodos de leitura. Nenhuma rota pública deve aceitar payload arbitrário para repassar à Graph API.

### 5.5 Verificação e memória

Confirmar depois da ação na própria Meta (`GET`), e não só pelo retorno HTTP da escrita. Medir mudanças dentro de janelas adequadas, levar em conta atribuição, learning phase, atraso de conversões e volume suficiente. Registrar diferença antes/depois e evidência. Evitar afirmar causalidade onde só há correlação.

A UI principal deve informar **“o que a Groow Ads fez”** e **“o que mudou”**, não exigir que o cliente navegue entre ferramentas para entender isso.

## 6. Sequência de implementação isolada do site de vendas

| Pacote | Entrega concreta | Prova mínima |
| --- | --- | --- |
| A. Viabilidade Meta (primeiro) | Conferir permissão `ads_management`, configuração de Login e elegibilidade de escrita no app real | Evidência de scopes aprovados/concedidos sem revelar tokens |
| B. Contrato de ações/política | Tipos de ações, validação estrita, delegação, limites, teste sem servidor | Testes: sem delegação, conta trocada, orçamento excedido, duplicação, expiração |
| C. Persistência segura | Migrations para delegações/ações/auditoria + RLS e políticas server-only | PgTAP/PGlite/homolog, sem acesso cruzado |
| D. Adaptador Meta | Escrita limitada para pausa/status, orçamento e criação `PAUSED` + leitura de verificação | Testes com cliente HTTP mock e consulta real autorizada |
| E. Decisor IA | Facts → proposta estruturada (sem execução direta); consumo contabilizado | Exemplos reais, outputs inválidos rejeitados |
| F. Loop autônomo | Enfileirar, executar, verificar, registrar, cooldown, parar e informar | Teste ponta a ponta controlado e observabilidade |
| G. Primeira oferta comercial | Onboarding objetivo/delegação, atividade da IA e controles de interrupção | Usuário consegue delegar e perceber trabalho executado sem operar dashboards |

Os pacotes são **etapas de implantação**, não sete produtos diferentes. Evitar novas telas genéricas fora desta jornada.

## 7. Convivência com o Codex e limites desta entrega

Esta documentação está sendo elaborada em **worktree separado** (`docs/groow-ads-ia-executora-20261018`). O Codex pode continuar o site de vendas no checkout principal. Não editar simultaneamente o mesmo arquivo, não executar `git reset --hard`, não fazer merge automático para `master` nem deploy. O Codex não deve copiar promessas de execução autônoma para a página comercial enquanto ela não estiver homologada.

Nenhuma migração aplicada, credencial alterada, campanha editada ou cobrança executada nesta etapa.

## 8. Decisão necessária para iniciar ações reais

Antes da primeira escrita na Meta, o responsável deverá escolher ou fornecer uma **conta de anúncios própria apropriada para homologação**, autorizar escopo e teto de investimento, e confirmar a permissão de escrita da integração. A escolha do negócio-modelo e limites pode ocorrer depois que os pacotes A–D estiverem prontos para teste.

**Próxima tarefa técnica recomendada:** pacote A, seguido dos contratos/políticas do pacote B, em branch isolada. Não voltar a polir dashboards antes desse caminho de execução.

## 9. Implementação iniciada em 18/10/2026 — núcleo técnico isolado

**Implementado neste trabalho (branch de funcionalidade separada do Codex):**

- `src/modules/agent-executor/policy.ts`: contratos de ações estruturadas, delegações e contexto de execução, com decisão determinística **fail-closed** para pausa/reativação e alteração de orçamento em campanha/conjunto. Confere agência, cliente, conta, entidade, tipos, prazos, permissão de escrita, elegibilidade comercial, teto por entidade e conta, percentual de aumento e atualização dos dados.
- `src/modules/agent-executor/meta-write.ts`: adaptador **server-only**, sem importação por rota/job, que consulta estado da entidade e verifica tipo e titularidade da conta Meta, reavalia a política, envia exclusivamente `status` ou `daily_budget` e consulta novamente para confirmar o efeito. Falha de rede após POST é **resultado incerto**, nunca tentativa automática de repetir a mutação.
- `tests/agent-executor-policy.test.ts` e `tests/agent-executor-meta-write.test.ts`: simulações de permissões, revogação, contas divergentes, orçamento, estado antigo, tipo de entidade e confirmação da Meta. Nenhum token nem anúncio real utilizado nos testes.

**Evidência local:** 30 testes direcionados passaram; TypeScript `--noEmit` e ESLint direcionado passaram. Ambiente local reportou Node 26.7.0, enquanto `package.json` exige Node 24; homologar sob Node 24 no CI antes de integrar.

**Ainda NÃO implementado:** delegações persistidas no banco; cálculo completo e confirmado do orçamento ativo de uma conta; fila/ledger transacional e chave de idempotência; RPC/RLS do agente; cron de decisão; integração real do `MetaClient`/credentials com o executor; interface para objetivo, permissão e histórico; criação completa de campanhas; ação de IA conectada ao fluxo; escrita testada numa conta de anúncios real.

**Não confundir base do executor com agente autônomo pronto.** Nenhum importador chama `executeMetaWrite` hoje. Uma futura chamada deve resolver contexto, vínculo Meta, direitos comerciais e delegação **no servidor**, nunca aceitar esses campos diretamente do modelo/navegador. A execução deve passar pelo ledger com idempotência e confirmação independente da Meta.

**Próximos passos de código:** (1) confirmar efetividade da permissão Meta `ads_management` sem escrever campanhas; (2) implementar persistência/RLS e ledger; (3) encaixar o adaptador em um executor que consulte dados reais e revalide o estado; (4) adicionar camada planejadora estruturada e primeiro loop com acompanhamento; (5) homologar uma ação controlada na conta de anúncios do proprietário, com autorização de escopo.

**Limite operacional:** não executar escritos na Meta, não aplicar migrations, não alterar contas/financeiro nem fazer deploy de produção sem autorização específica. Este pacote pode coexistir com o trabalho do Codex no site de vendas.

## 10. Segunda entrega técnica — persistência e travas do executor (18/10/2026)

**Preparado em código, NÃO aplicado a produção:**

- `supabase/migrations/202610180001_agent_delegations_and_actions.sql`: tabelas `public.agent_delegations`, `public.agent_action_jobs` e `public.agent_action_events`. Todas com RLS e leitura restrita a owner/admin/editor da própria organização, sem grants de escrita a `authenticated` ou `anon`. Escritas por servidor privilegiado somente após checagem de autorização.
- Delegação com relacionamento composto que vincula `agency_id + client_id + ad_account_id` a contas associadas, identidade do usuário que concedeu a permissão, escopos de ações, moeda, validade/revogação e limites financeiros.
- Jobs com chave de idempotência única por organização, relacionamento obrigatório com a delegação correta e **índice parcial único que proíbe uma segunda alteração concorrente sobre a mesma conta enquanto a primeira está queued/executing/verifying/needs_verification**.
- Máquina de estados validada por trigger: ações novas só começam como `proposed`; transições fora de ordem, saltos para `verified` ou mudanças em proposta já registrada são bloqueados. Função `private.agent_claim_action` é restrita a `service_role` e faz transição atômica queued → executing sem permitir que outro worker adquira a mesma ação.
- Eventos append-only via trigger após cada transição, protegidos por RLS. Um `unknown_outcome` permanece como `needs_verification` e impede novas alterações na conta até reconciliação.
- `supabase/tests/agent-executor.test.sql`: 23 testes fictícios de relações, RLS entre organizações, grants, idempotência, claim, rejeição de saltos, auditoria, limites de fila e tratamento de resultado incerto.

**Verificado localmente:** todas as migrations históricas + a migration nova foram executadas em PGlite descartável; todos os testes SQL/RLS/pgTAP da suíte aprovaram, inclusive os 23 testes novos. Ainda NÃO foi homologado isolamento/concurrency no Supabase real nem foi executada uma única operação Meta real.

**Próxima frente técnica:** serviço server-only que resolve vinculações, contrato de permissão e cota comercial em banco, valida a delegação, obtém token de forma segura e registra/atualiza jobs transacionalmente. Em seguida, planejador IA estruturado e reconciliação de ações. Antes do primeiro deploy ou aplicação de migration, revisão do SQL e autorização específica do proprietário.

**Coordenação:** o site de vendas permanece na branch/checkout do Codex. Não juntar estas alterações na master nem publicar até a integração estar pronta e revisada.


## 11. Terceira entrega - integracao segura entre banco, delegacao e executor (18/10/2026)

**Escopo realmente implementado nesta branch (sem deploy):**

- `src/modules/agent-executor/queue.ts`: entrada server-only para proposta estruturada (sem dados de agencia/limites vindos da IA). O ciclo de observacao e timestamp sao informados pelo servidor. Valida vinculo entre organizacao/cliente/conta, concedente atual, delegacao, escopos persistidos, configuracao e direito comercial. Gera idempotency key SHA-256 do ciclo+acao e faz transicoes propostas -> autorizadas -> fila. Duplicatas nao geram nova acao.
- `src/modules/agent-executor/runtime.ts`: consulta novamente job e delegacao, integracao, conexao Meta ligada ao cliente, conta e vinculo ativo, concedente owner/admin, moeda, limites, expiracao/revogacao e elegibilidade. Recupera segredo existente via `loadAccessToken` de `meta/server.ts`, sem fornecer token ao modelo. Faz **GET /me/permissions** e exige `ads_management` concedido ao vivo; armazenar scope nao basta.
- `src/modules/agent-executor/worker.ts`: usa RPC de claim atomica `queued -> executing` e executa o adaptador ja existente. Antes do POST, revalida a delegacao e persistencia do before-state; depois da confirmacao real, persiste after-state e so entao chega a `verified`. Resultado incerto -> `needs_verification` ou `executing` travado, nunca novo POST automatico.
- `supabase/migrations/202610180002_agent_execution_gate.sql`: nova feature `agent_executor_meta` **globalmente desligada** por padrao e RPCs `agent_meta_execution_allowed` e `agent_claim_action` restritas a `service_role`. Controle comercial bloqueia mesmo que a delegacao exista. Migration ainda **nao aplicada em producao**.
- Tipos das novas tabelas/RPCs registrados em `src/types/database.ts`. Nenhuma rota, cron ou interface comercial foi ligada ao executor.

**Bloqueio deliberado de seguranca:** neste corte, somente a acao de **pausar** campanha/conjunto e elegivel para fila. Reativacao e mudanca de orcamento ficam bloqueadas ate existir inventario financeiro **integral** diretamente da Meta, comprovando orcamentos ativos, cobertura, contas e moedas. A pausar tambem depende de escopo, plano, delegacao e permissao efetiva. A feature global continua OFF, portanto nenhuma operacao real sera disparada nesta entrega.

**Evidencias locais:** 48 testes automatizados do executor passaram (incluindo 18 novos testes de runtime, worker, fila e persistencia antes/depois). TypeScript --noEmit passou. Todas as migrations, incluindo 002, e a suite SQL/RLS/pgTAP passaram em PGlite descartavel. ESLint direcionado passou. Nao houve acesso de escrita nem teste com credencial Meta real.

**Lacunas seguintes, antes de homologacao comercial:** decisor Anthropic com schema/guardrails e fatos reais, levantamento financeiro Meta completo para resume/orcamentos, reconciliacao independente e conservadora de estados incertos, tests de integracao PostgREST/Supabase real de forma autorizada, checagem do app Meta/permissoes de escrita com conta de homologacao e fluxo de controle de delegacao para o cliente. **Nao abrir o gate em producao, aplicar migrations nem usar conta real sem autorizacao especifica.**


## 12. Quarta entrega — regra de aprovacao humana obrigatoria para toda mudanca financeira da IA (18/10/2026)

**Nova decisao do proprietario, superior as delegacoes antigas:** operacoes de campanha podem ser iniciadas **manualmente** pelo usuario ou **por IA**, em canais separados e identificaveis. Acoes de IA que alterem gasto/veiculacao **sempre** precisam de confirmacao humana especifica por acao, inclusive dentro de teto delegado, sem aprovacao antecipada generica. A iniciacao manual e o proprio ato explicito do usuario, com autorizacao de papel e escopo; nao pode servir para a IA disfarcar seu pedido. O fluxo manual de edicao de campanhas ainda requer implementacao/homologacao propria.

**Implementacao protegida, sem ativar producao:**
- Migration `202610180003_agent_financial_user_approval.sql` adiciona `execution_origin` (padrao `ai`), `requested_by`, `approved_by`, `approved_at` e `approval_expires_at`, mais estado `awaiting_approval`. O trigger do ledger rejeita saltos IA para autorizado/queued, aprovacao forjada por service_role, reclassificacao de origem e aprovacao vencida. A aprovacao tem janela curta de 15 minutos. A transicao `awaiting_approval -> authorized -> queued` ocorre na **mesma transacao** em RPC autenticada por owner/admin, com fingerprint SHA-256 calculado sobre agencia, cliente, conta, job, acao, alvo, valor e justificativa; a rejeicao registra `user_rejected`.
- `queue.ts` deixa a IA apenas **propor** e aguardar autorizacao do usuario. Nenhuma acao financeira entra na fila automaticamente; campanha/conjunto pausados tambem sao tratados como alteracoes com efeito financeiro, por prudencia.
- `runtime.ts` rejeita acoes sem aprovacao humana registrada, aprovadores removidos/rebaixados, aprovacao expirada e jobs manuais enviados ao worker da IA; o controle e revalidado imediatamente antes de POST.
- `approval-actions.ts` e `src/app/(workspace)/agente/aprovacoes/page.tsx`: funcoes server-side e tela interna (fora do menu ate homologacao) para owner/admin visualizar alvo, orcamento quando aplicavel, motivo e vencimento; permite aprovar ou recusar via RPC com JWT autenticado. Nao usa service_role para consentimento humano nem expoe token Meta. Interface ainda nao foi homologada com uma conta real.
- `financial-approval.ts`: contrato fail-closed de classificacao; seis mutacoes atuais e tipos futuros desconhecidos exigem aprovacao. As criacoes/publicacoes da IA serao abrangidas quando forem implementadas.
- Migracoes permanecem NAO aplicadas em producao, gate global OFF e nenhuma chamada Meta real executada. Nao existe ainda decisor LLM autonomo nem interface manual completa.

**Proxima implementacao:** homologar a interface curta de aprovacao com dados controlados, construir um caminho de modificacao MANUAL explicitamente iniciado por usuario autenticado, o decisor estruturado com fatos comprovados e, depois, a reconciliacao segura e homologacao. Para permitir acoes nao financeiras autonomas, sera necessario classificacao explicita e testes; acoes desconhecidas continuam bloqueadas sem aprovacao.


## 13. Quinta entrega - motor de analise e decisao (18/10/2026)

**Implementado em codigo (desligado por padrao: `AGENT_DECISION_ENGINE_ENABLED=true` e necessario; nenhuma rota, cron ou UI o chama):**

- `decision-facts.ts`: fatos deterministicos a partir da hierarquia de metricas ja confirmadas. O modelo recebe so referencias opacas (`c1`, `a2`) e metricas; IDs Meta, conta e organizacao ficam num mapa server-side.
- `decision-contract.ts`: schema estrito da saida do modelo (tool use forcado). Nao ha campo para ids, permissao, delegacao, aprovacao ou prazo; campos extras sao rejeitados. Orcamento so como `budgetChangePercent`; o valor absoluto e calculado no servidor a partir do orcamento confirmado.
- `decision-validator.ts`: validacao pura. Confere alvo existente, evidencia, nivel x acao, estado atual, numeros citados (reusa `verifyNumbers`), conflito de acoes na mesma entidade, frescor dos fatos. Roteamento nunca e escolha do modelo: `aiChangeRequiresHumanApproval` (fail-closed) => `needs_human_approval`.
- `decision-engine.ts` e `anthropic-decision-model.ts`: provedor injetavel (testes usam dublê, sem chamada real). Saida que nao seja tool use estruturado vira erro.
- `decision-bridge.ts`: leva decisoes validadas a `stageMetaDecision`. Apenas pausas entram, sempre como `awaiting_approval`; retomar/orcamento ficam como `recommendation_only` ate o inventario financeiro Meta (mesma trava de `queue.ts`).

**Decisoes:** nenhuma acao automatica nao financeira existe ainda (a classificacao atual trata tudo como financeiro). Nao foi criada feature `ai_usage` nova (exigiria migration); tokens/requestId voltam no resultado do motor, mas **o custo ainda nao e contabilizado em `ai_usage` nem sujeito a cota mensal** - pendencia obrigatoria antes de ligar o motor.

**Evidencia:** 14 testes novos; 73 testes do agente, `tsc --noEmit` e ESLint direcionado passaram. Nenhuma migration, chamada Meta/Anthropic real ou dado de producao usado.

**Pendente:** (1) leitor server-side que monta `FactsInput` (hierarquia, orcamentos confirmados na Meta, perfil/objetivos) com o escopo confiavel; (2) cota/custo de IA e registro em `ai_usage`; (3) reconciliacao de `needs_verification`/`unknown_outcome`; (4) inventario financeiro Meta para liberar resume/orcamento; (5) chamada orquestrada (cron) e UI de recomendacoes.


## 14. Sexta entrega - ciclo de decisao com dados ao vivo e custo contabilizado (19/10/2026)

**Implementado (motor continua OFF por padrao; sem rota, cron ou UI; migration NAO aplicada):**

- `decision-live-state.ts`: leitura somente GET do status e do `daily_budget` atuais na Meta (token via `loadAccessToken`, nunca exposto). Orcamento ausente no nivel => `null`, nunca presumido. Falha/integracao offline => `null`.
- `decision-cycle.ts`: orquestra por cliente. Ordem fail-closed: flag do motor -> delegacao vigente (sem ela, nao ha gasto de IA) -> cota/plano/liga-desliga de IA -> hierarquia de metricas via `service_client_hierarchy` (14 dias + 14 anteriores) -> leitura AO VIVO da Meta (sem ela a conta e pulada) -> motor -> registro em `ai_usage` (inclusive saidas rejeitadas, pois os tokens foram gastos) -> fila. O status vivo substitui o do cache; entidade sem confirmacao viva e descartada.
- `observationId` derivado do hash dos fatos: mesmos fatos geram a mesma chave de idempotencia (sem jobs duplicados).
- Migration `202610190001_agent_decision_ai_usage.sql` inclui `agent_decision` no check de `ai_usage`; tipo em `database.ts` atualizado.
- Correcao: o alvo carrega o UUID interno da conta (a hierarquia nao traz `act_...`); a ponte usa a conta do fato resolvido no servidor.

**Decisao tecnica:** a verificacao de cota duplica a de `runGuardedGeneration` (marcada com TODO) para nao alterar o caminho de IA de texto em producao.

**Evidencia:** 82 testes do agente, tsc, ESLint e suite SQL/RLS/pgTAP (PGlite, com a migration nova) passaram. Nenhuma chamada real a Meta/Anthropic, nenhum dado de producao.

**Pendente:** reconciliacao de `needs_verification`/`unknown_outcome`; inventario financeiro Meta (liberar retomar/orcamento); disparo agendado e tela de recomendacoes; homologacao com conta de teste; `ai_usage` real exige aplicar a migration com autorizacao.


## 15. Setima entrega - reconciliacao de resultados incertos (19/10/2026)

**Implementado (`reconciler.ts`; sem rota, cron ou UI; sem migration nova - usa a maquina de estados existente):**

- Alcance: jobs de origem `ai` em `needs_verification` e `executing` parado ha mais de 10 min. Lotes de 25, ordem de criacao.
- **Somente GET.** Nunca envia POST, nunca reaplica, nunca aprova. Nova tentativa exige nova proposta e nova aprovacao humana individual.
- `executing` sem `before_state`: o snapshot e gravado antes do POST, logo nada foi enviado -> `failed` (`reconciled_not_sent`), sem consultar a Meta.
- Com `before_state`: leitura ao vivo (status configurado e `daily_budget`) conferindo que a entidade pertence a conta esperada. Estado final = pretendido e != anterior -> `verified` (passando por `verifying` se estava `executing`), com `after_state.reconciled = true`. Estado = anterior ha pelo menos 15 min do inicio -> `failed` (`reconciled_not_applied`), liberando a trava da conta. Antes disso -> `too_soon`.
- Qualquer outra situacao (leitura indisponivel, conta divergente, valor de terceiros, estados ambiguos) -> `inconclusive`: job permanece bloqueando a conta. Transicoes por CAS; perda de corrida e relatada, nunca forcada.
- `decision-live-state.ts` passou a ler e normalizar `account_id` da entidade para conferir titularidade.

**Limite conhecido:** se um humano alterar a entidade para o mesmo valor pretendido durante a janela, a conciliacao nao distingue autoria (o efeito financeiro e o mesmo; `reconciled: true` marca a origem da prova).

**Evidencia:** 10 testes novos (92 do agente), tsc e ESLint direcionado passaram. Nenhuma chamada real a Meta.

**Pendente:** agendar o reconciliador e alertar sobre jobs `inconclusive` antigos; inventario financeiro Meta (retomar/orcamento); disparo agendado do ciclo de decisao e tela de recomendacoes; homologacao com conta de teste e aplicacao autorizada das migrations.


## 16. Oitava entrega - inventario financeiro Meta e retomada/orcamento sob aprovacao (19/10/2026)

**Implementado (gate global continua OFF; nenhuma escrita Meta real; migrations nao aplicadas):**

- `financial-inventory.ts` + `MetaClient.listBudgetInventory` (somente GET, paginacao completa; pagina nao avancada lanca erro): soma o orcamento diario que pode gastar agora. Orcamento de campanha (CBO) cobre os conjuntos; sem ele soma os conjuntos ativos. Pausados/arquivados/excluidos e conjuntos encerrados sao ignorados; status desconhecido conta como ativo. Orcamento vitalicio, ausente ou malformado, conjunto orfao ou falha de leitura => `coverageComplete=false` e total `null`.
- `runtime.ts`: para retomar e alterar orcamento le o inventario imediatamente antes da escrita e preenche o contexto da politica (`confirmedActiveDailyBudgetMinor`, `budgetCoverageComplete`). Pausa dispensa a leitura (nao aumenta gasto). A politica ja existente continua negando cobertura incompleta, teto da conta/entidade e variacao percentual.
- `queue.ts` e `decision-bridge.ts`: retomar e orcamento agora chegam ao ledger como `awaiting_approval` com `daily_budget_minor` (consistencia acao x valor exigida). **Continuam sem executar sem aprovacao humana individual**, que vale o fingerprint incluindo o valor.

**Limites conhecidos:** o inventario considera so o orcamento diario (gasto real pode variar ate 25% acima do diario na Meta; os tetos delegados devem considerar essa folga); campanhas CBO com orcamento vitalicio e contas com muitos objetos dependem de homologacao.

**Evidencia:** 100 testes do agente (8 novos), 131 de Meta, tsc e ESLint passaram. Nenhuma chamada real.

**Pendente:** agendar ciclo de decisao e reconciliador, alertas de jobs `inconclusive`, tela de recomendacoes; homologacao em conta de teste com aplicacao autorizada das migrations; fluxo manual de edicao.


## 17. Nona entrega - agendador, execucao da fila, fluxo manual e atividade (19/10/2026)

**Implementado (tudo desligado por padrao; migrations nao aplicadas; nenhuma chamada Meta/Anthropic real):**

- `scheduler.ts` + `GET /api/cron/agent` (`vercel.json`, a cada 15 min, `CRON_SECRET`): so roda com `AGENT_SCHEDULER_ENABLED=true`. Um passe: (1) expira aprovacoes/fila vencidas da IA (libera a conta), (2) reconciliador, (3) executa jobs `queued` (antes, o ledger enfileirava mas **nada os executava**) conferindo o gate comercial por organizacao ANTES do claim, na origem correta (`ai` ou `manual`), (4) ciclo de decisao apenas para clientes com delegacao vigente, sem aprovacao pendente e fora de um cooldown de 12 h (gasto de IA limitado a 5 clientes por passe), (5) lista jobs `needs_verification` com mais de 24 h como atencao.
- **Fluxo manual** (`manual-actions.ts`, tela `/agente/manual`, fora do menu): proprietario/administrador autenticado pausa/reativa/altera orcamento; o servidor cria job `execution_origin = 'manual'`, `requested_by`, sem delegacao, `proposed -> authorized -> queued`, compartilhando fila, trava de uma mutacao por conta e auditoria. Nao se registra como aprovacao de IA. `runtime.ts` ganhou `origin`: o worker da IA continua rejeitando jobs manuais e vice-versa; no manual o solicitante precisa ser owner/admin na hora da execucao e o envelope e sintetico (tetos da delegacao da IA nao se aplicam; conta, titularidade, estado, frescor, permissao e inventario continuam). Percentual maximo de aumento do manual: 1000%.
- Migration `202610190002_agent_manual_origin.sql`: `delegation_id` anulavel somente para origem manual (IA continua exigindo delegacao por CHECK).
- `/agente/aprovacoes` agora mostra "Exige atencao" e "Atividade recente" (IA e manual) com explicacoes das falhas.

**Decisoes/limites:** retomar e orcamento manuais tambem exigem inventario financeiro completo (sem ele a politica nega) - contas com orcamento vitalicio ficam restritas a pausa; orcamento e informado em unidade minima da moeda (sem presumir casas decimais). Alerta ativo (e-mail/WhatsApp) para `needs_attention` nao existe; hoje aparece na tela e no retorno do cron.

**Evidencia:** 109 testes do agente (9 novos), tsc, ESLint e SQL/RLS/pgTAP (PGlite, com as duas migrations novas) passaram. Suite completa: 1403 passaram; `whatsapp-native-label-sync-provider` falha tambem na base sem estas alteracoes (WhatsApp, fora do escopo) e `whatsapp-labels-browser` e intermitente.

**Para homologar:** aplicar migrations 001-003 do agente + 20261019 0001/0002 (autorizacao especifica), definir `AGENT_SCHEDULER_ENABLED`, `AGENT_DECISION_ENGINE_ENABLED`, `CRON_SECRET`, abrir o gate `agent_executor_meta` somente para a organizacao de teste, delegar uma conta de teste do proprietario com teto baixo, e acompanhar a primeira pausa real ponta a ponta.


## 18. Migrations aplicadas na HOMOLOGACAO (19/10/2026)

Por autorizacao expressa do proprietario ("Autorizo", 19/10/2026) para base de teste, as cinco migrations do agente foram aplicadas **somente** no projeto Supabase `igrow-homologacao` (`xvjvfvinnnrgnhskglvd`), em ordem: `202610180001`, `202610180002`, `202610180003`, `202610190001`, `202610190002` (registradas pelo MCP com nomes `agent_*_18_000x` / `agent_*_19_000x`; versoes de timestamp proprias da ferramenta). **Producao (`qlopniyghvpbgwxuwxrl`) NAO foi tocada.** Nao reaplicar.

Conferencia pos-aplicacao (somente leitura): 3 tabelas com RLS ativo; `agent_executor_meta` com `globally_enabled = false`; zero jobs e delegacoes; `delegation_id` anulavel (so origem manual); `ai_usage` aceita `agent_decision`. Advisor de seguranca: unico achado novo e a RPC `agent_decide_financial_action` executavel por `authenticated`, que e intencional (verifica owner/admin e fingerprint internamente). O restante dos avisos ja existia na base.

Ainda NAO feito: dados de teste, conta Meta de homologacao, abertura do gate, deploy com `AGENT_SCHEDULER_ENABLED`, nenhuma escrita real na Meta.
