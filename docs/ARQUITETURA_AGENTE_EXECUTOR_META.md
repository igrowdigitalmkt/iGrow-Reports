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
