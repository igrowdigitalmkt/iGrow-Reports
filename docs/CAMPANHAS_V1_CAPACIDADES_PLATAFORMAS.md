# Campanhas V1: capacidades por plataforma e matriz funcional

Consulta às fontes oficiais em **20/10/2026**. Onde a fonte não pôde ser lida ou não confirma um ponto, está escrito **"não confirmado"**: nada abaixo deve ser tratado como disponível só porque existe um campo parecido na API. O registro executável dessas estruturas está em `src/modules/campaigns/platforms/registry.ts`.

## 1. Fontes consultadas

| Plataforma | Fonte oficial | O que confirmou |
|---|---|---|
| Meta | [Campaign structure](https://developers.facebook.com/docs/marketing-api/campaign-structure) | Hierarquia campanha › conjunto › anúncio; criativo é reutilizável por conta e **não pode ser alterado depois de criado**. |
| Meta | [Campaign (ad-campaign-group)](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/) | Campos atualizáveis por POST, create-only e duplicação (`/copies`). |
| Meta | [Ad set](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/) | Duplicação e regras de orçamento/ lance (parcial: o trecho de campos atualizáveis não foi lido). |
| Meta | [Ad](https://developers.facebook.com/docs/marketing-api/reference/adgroup/) | O que se atualiza em anúncios, `effective_status`, duplicação, revisão e motivos. |
| Google | [API structure](https://developers.google.com/google-ads/api/docs/concepts/api-structure) | Hierarquia, Performance Max com grupos de recursos, mutates, IDs. |
| Google | [Campaigns overview](https://developers.google.com/google-ads/api/docs/campaigns/overview) | Tipos de campanha, status na criação, orçamento como objeto próprio em micros. |
| TikTok | [TikTok API for Business](https://business-api.tiktok.com/portal/docs) | O portal exige renderização e **não pôde ser lido**; só índices de busca confirmam a existência de operações de atualizar status e orçamento de grupos (v1.3). |
| LinkedIn | [Create and Manage Campaigns](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-campaigns) (versão 2026-10, atualizada em 14/10/2026) | Grupos de campanhas, campanhas, criativos, orçamentos, status, escopo `rw_ads`. |

## 2. Meta Ads

- **Hierarquia:** Campanha › Conjunto de anúncios › Anúncio; o **criativo** é um objeto separado (biblioteca da conta). Orçamento, lance, programação e público ficam no conjunto, salvo campanha com orçamento no nível da campanha (detalhe de CBO: **não confirmado** nas páginas lidas; o código do projeto já trata orçamento ausente na campanha como "definido nos conjuntos").
- **Campanha (POST em `/{id}`):** atualizáveis `name`, `status`, `daily_budget`, `lifetime_budget`, `bid_strategy`, `start_time`, `stop_time` (e `objective`, que consta na tabela de atualização, mas **deve ser tratado como restrito**: não prometer mudança de objetivo; investigar). **Somente na criação:** `buying_type`, `special_ad_categories`. `effective_status` é leitura.
- **Duplicação:** `POST /{id}/copies` em campanha, conjunto e anúncio; `status_option` padrão **PAUSED** (aceita ACTIVE e INHERITED_FROM_SOURCE); `deep_copy` copia filhos (limite de **3** filhos em chamada síncrona e **51** em assíncrona); `rename_options`; na cópia de anúncio, `creative_parameters` sobrescreve o criativo e sem ele o criativo é idêntico. Campanha com objetivo legado copiada para `OUTCOME_*` pode falhar.
- **Anúncio:** só campos usados na criação são atualizáveis; `name` e `status` são os exemplos documentados. `adset_id` não muda. ARCHIVED: só `name`/`status` (status só para DELETED). DELETED: só `name`. Anúncio em conjunto com `creative_sequence` não pode ir para PAUSED/ARCHIVED/DELETED. **Alterar texto, título, CTA, mídia ou destino de um anúncio existente exige criar um novo criativo** e associá-lo (a edição direta do criativo não é suportada); a página lida não detalha esse fluxo ("não confirmado": investigar `adcreatives` e a troca de `creative` no anúncio).
- **`effective_status`:** ACTIVE, PAUSED, DELETED, PENDING_REVIEW, DISAPPROVED, PREAPPROVED, PENDING_BILLING_INFO, CAMPAIGN_PAUSED, ARCHIVED, ADSET_PAUSED, IN_PROCESS, WITH_ISSUES (a tela já separa estado configurado de efetivo e mostra restrições).
- **Revisão e rejeição:** campos de leitura `ad_review_feedback` (com `review_feedback_breakdown=true`), `issues_info` e `failed_delivery_checks`. A página não lista os motivos possíveis.
- **Permissões:** `ads_management` para escrever e `ads_read` para ler (conhecimento do projeto, já verificado em produção: a leitura ao vivo de `/me/permissions` confirma a permissão). Uso por usuários sem função no aplicativo exige Acesso Avançado (App Review): **verificar no painel**.
- **A/B e breakdowns:** testes A/B oficiais (Experiments/Ad Studies) **não foram pesquisados nesta rodada** (classe F). Breakdowns já existem na coleta de públicos do Dashboard; falta levá-los à tabela por nível.

## 3. Google Ads

- **Hierarquia:** Cliente › Campanha › Grupo de anúncios › Anúncio do grupo; critérios na campanha ou no grupo. IDs de campanha, grupo e orçamento são globais; IDs de anúncio e critério só são únicos dentro do pai (a chave de entidade da Groow precisa de conta + pai).
- **Performance Max:** **não tem grupos de anúncios nem anúncios criados manualmente**: usa **grupos de recursos** (`AssetGroup`) com recursos (`AssetGroupAsset`) e sinais de público (`AssetGroupSignal`). A interface não pode mostrar grupo de recursos como grupo de anúncios nem recurso como anúncio equivalente ao da Meta.
- **Tipos de campanha** (`advertising_channel_type`): SEARCH, DISPLAY, PERFORMANCE_MAX, DEMAND_GEN, APP, SHOPPING, LOCAL_SERVICES (alguns exigem subtipo). Search, Display e Shopping têm estruturas próprias (não detalhadas nas páginas lidas: classe F). Seleção que misture tipos estruturalmente diferentes deve separar por estrutura.
- **Orçamento:** objeto `CampaignBudget` separado, em micros, com possibilidade de compartilhamento entre campanhas: orçamento da campanha pode ser compartilhado (afeta edição em lote).
- **Mutates:** síncronos por serviço, `GoogleAdsService.Mutate` atômico entre recursos, `validate_only` disponível, `BatchJobService` assíncrono; edição concorrente pode gerar `CONCURRENT_MODIFICATION_ERROR` e a API não oferece bloqueio. **Não confirmado:** máscaras de atualização, enums de status e campos imutáveis (ler a referência do recurso Campaign).
- **Estado no projeto:** existe leitura agregada para o Dashboard (`src/modules/google-ads`); não há navegação por entidades nem escrita.

## 4. TikTok Ads

- **Hierarquia (conhecimento do projeto, não confirmado na fonte oficial):** Campanha › Grupo de anúncios › Anúncio. Só índices de busca confirmaram operações separadas para **atualizar status** e **atualizar orçamento** de grupos de anúncios, e o campo `operation_status` (ENABLE/DISABLE) em respostas de anúncios, no caminho `/open_api/v1.3/`.
- **Pendente (classe F):** ler no portal as páginas de campanha, grupo e anúncio (campos, orçamento por nível, imutáveis), Spark Ads, permissões e limites. Nenhum recurso do TikTok está implementado.

## 5. LinkedIn Ads (fonte oficial lida)

- **Hierarquia:** Conta › **Grupo de campanhas** › **Campanha** › **Criativo**. Não existe conjunto de anúncios: segmentação, orçamento, programação e lance ficam na **campanha**.
- **Permissões:** escopo `rw_ads` (escrita) ou `r_ads` (leitura); papéis de conta (VIEWER é somente leitura mesmo com `rw_ads`; CREATIVE_MANAGER entre os papéis).
- **Campanha:** `account` é imutável; `campaignGroup` obrigatório na criação; orçamento `dailyBudget` e/ou `totalBudget` (moeda igual à da conta; total é descontinuado fora de ritmo vitalício); `runSchedule.start/end`; `status` (ACTIVE, PAUSED, ARCHIVED e outros); `servingStatuses` é leitura; `pacingStrategy` só na criação; `test` é imutável. Atualização por PATCH parcial (conforme a página; detalhes por tipo de campanha variam). Orçamento dinâmico no grupo de campanhas interage com o da campanha.
- **Criativos:** devem corresponder ao formato da campanha; no máximo 15 criativos ativos e 85 inativos por campanha.

## 6. Estados de integração no produto

| Plataforma | Leitura de entidades | Navegação por níveis | Escrita |
|---|---|---|---|
| Meta | Real (catálogo ao vivo + métricas coletadas) | Real (três abas, esta entrega) | Parcial e real: pausar, retomar e orçamento de campanha e conjunto, em lote; ledger e aprovação |
| Google Ads | Só métricas agregadas (Dashboard) | Estrutura no registro, sem dados | Nenhuma |
| TikTok Ads | Nenhuma | Estrutura no registro, sem dados | Nenhuma |
| LinkedIn Ads | Nenhuma | Estrutura no registro, sem dados | Nenhuma |

Nada disso é anunciado como integração concluída; a interface só oferece Meta.

## 7. Matriz funcional da V1

Classes: **A** implementada e validada · **B** implementável com API e contratos atuais · **C** exige ampliação de coleta ou executor · **D** exige nova permissão ou integração · **E** não suportada/restrita pelo provedor · **F** exige investigação adicional.
"Validada" = testes automatizados e fixtures locais; **homologação real** é um critério separado (campo "Real").

### Meta Ads

| Funcionalidade | Nível | Classe | Situação | Real | Dependência e próximo passo | Critério de aceite |
|---|---|---|---|---|---|---|
| Três abas (Campanhas, Conjuntos, Anúncios) com contagens | todos | A | Implementada (esta entrega) | pendente de conferir em produção | — | Abas independentes, sem expansão por seta |
| Seleção contextual entre abas (campanha→conjuntos→anúncios, precedência, invalidação, isolamento por cliente) | todos | A | Implementada, 18 testes de lógica + verificação no navegador | — | — | Cenários 1–30 do prompt |
| Filtros por estado efetivo e configurado, busca por nome/conjunto/campanha, ordenação, colunas por nível | todos | A | Implementada | — | Filtros por campanha/conjunto por lista pesquisável: B | Comparar anúncios de campanhas diferentes |
| Paginação (100 por página) e "selecionar esta página" × "todos os filtrados" | todos | A | Implementada | — | Virtualização se passar de milhares: F | Seleção correta com paginação |
| Exportação CSV do resultado filtrado | todos | A | Implementada (todos os filtrados, colunas escolhidas, vazio ≠ zero, proteção contra fórmulas) | — | XLSX/agendada: B | Arquivo bate com a tabela filtrada |
| Detalhes por entidade e histórico do ledger | todos | A | Existente | — | — | — |
| Pausar campanha / conjunto | campanha, conjunto | A | Pausa de campanha homologada de verdade em 19/10; conjunto com mocks | campanha: sim | Homologar conjunto real | Estado confirmado na Meta |
| Retomar campanha / conjunto | campanha, conjunto | B | Implementada e testada com mocks; exige orçamento diário confirmado no nível (regra do executor) | não | Homologação real; caminho para orçamento nos conjuntos: B | Retomada confirmada |
| Alterar orçamento diário | campanha, conjunto | B | Implementada e testada com mocks; limite igual ao do executor | não | Homologação real | Valor confirmado |
| Pausar/retomar em lote (até 20, sequencial, resultado por entidade) | campanha, conjunto | B | Implementada (esta entrega), testada com mocks | não | Homologação real | Sucesso parcial por entidade |
| Configurações reais sob demanda (campanha, conjunto, anúncio) | todos | A | Implementada: lista permitida de campos, um GET principal e um por grupo, falha de grupo vira limitação | — | Ampliar campos conforme o contrato de escrita | Dado ausente nunca vira zero |
| Pausar/retomar em lote de anúncios | anúncio | B | Implementada (mesmo limite de 20, sequencial, resultado por anúncio); testada com mocks | não | Homologação real | Sucesso parcial por anúncio |
| Painel de edição lateral | campanha, conjunto | A | Reutiliza o cartão de operações | — | Novos campos conforme novas ações | — |
| Pausar/retomar anúncio (tabela, painel Editar, detalhes e lote) | anúncio | B | **Implementada (21/10/2026):** ação manual do executor (`pause_ad`/`resume_ad`), migração aditiva aplicada em produção e homologação, desabilitada automaticamente se o banco não a aceitar; testada com mocks | não (homologação real pendente) | Homologar com anúncio de teste; atenção a `creative_sequence` | Estado do anúncio confirmado na Meta |
| Renomear (campanha, conjunto, anúncio) | todos | B | **Implementada (21/10/2026):** `rename_campaign/adset/ad`, nome validado (1–200 caracteres, sem controle), confirmação pela leitura posterior do nome; testada com mocks | não (homologação real pendente) | Homologar com entidade de teste | Nome confirmado na Meta |
| Orçamento vitalício e compartilhado | campanha, conjunto | C | Reconhecido e bloqueado com explicação; edição pendente | não | Coleta de `lifetime_budget` e regras; executor | — |
| Orçamento por nível (painel Editar e detalhes) | campanha, conjunto | A | **Implementado sob demanda:** diário, vitalício e "não retornado neste nível" (com atalho para os conjuntos). Coluna na tabela ainda pendente (C) | — | Incluir orçamento na leitura ao vivo do catálogo | Orçamento confirmado, sem inventar |
| Programação (início e término) | campanha, conjunto | C | Pendente | não | Nova ação com validação de datas | — |
| Estratégia de lance / otimização | campanha, conjunto | C/F | Pendente | não | Pesquisa de `bid_strategy` por objetivo; ação própria | — |
| Segmentação, posicionamentos, públicos | conjunto | C/F | **Leitura resumida implementada** (somente leitura, sob demanda); escrita pendente | não | Contrato de escrita por campo e diff antes/depois; Advantage+ | Sem apagar campos por omissão |
| Criativo, texto, título, CTA, destino, rastreamento | anúncio | C | **Leitura resumida implementada** (somente leitura); edição pendente | não | Fluxo "novo criativo" com comparação antes/depois | Nada substituído silenciosamente |
| Motivo de reprovação / revisão | anúncio | B | **Leitura implementada** (`ad_review_feedback`, `issues_info`) no editor e nos detalhes | — | Categorias tipadas | Motivo exibido |
| Duplicar campanha, conjunto, anúncio | todos | C | Contrato tipado e planejamento prontos (`duplication-contract.ts`); execução pendente | não | Plano em `docs/DUPLICACAO_CRIACAO_META_PLANO.md` | Cópia criada pausada e conferida |
| Criar campanha, conjunto, anúncio | todos | C/D | Pendente | não | Fluxos próprios por etapa; páginas e pixel exigem permissões adicionais (D) | Estado inicial pausado |
| Teste A/B oficial | campanha | F | Não pesquisado | — | Ler a documentação de experimentos | Não confundir com duplicação |
| Detalhamento (idade, gênero, posicionamento…) por nível | todos | C | Parte existe no Dashboard | — | Levar à tabela, respeitando combinações permitidas | Sem somar métrica não aditiva |
| Operações propostas pela IA sobre as novas ações | todos | C | Não ampliada | — | Contratos estruturados + aprovação específica por ação | Aprovação humana sempre |
| Aprovação humana de propostas financeiras da IA | todos | A | Existente | sim (homologado até a decisão) | Homologar execução aprovada | — |

### Outras plataformas

| Funcionalidade | Plataforma | Classe | Situação | Próximo passo | Critério de aceite |
|---|---|---|---|---|---|
| Navegação por níveis próprios (Grupos de anúncios; grupos de recursos; grupos de campanhas) | Google, TikTok, LinkedIn | B | Estrutura no registro e demonstração local; **sem dados** | Integração de leitura por plataforma | Níveis reais, sem hierarquia da Meta |
| Leitura de campanhas, grupos e anúncios | Google | D | Só agregado no Dashboard | GAQL por nível; separar tipos de campanha | Tabela por estrutura |
| Performance Max (grupos de recursos e recursos) | Google | D/F | Estrutura registrada | Ler referência de `AssetGroup`; não tratar como anúncios | Navegação própria |
| Escrita (status, orçamento, edição) | Google | D | Nenhuma | Credenciais e escopo de escrita; ler máscaras de atualização | Mutate confirmado |
| Integração completa | TikTok | D/F | Nenhuma | Ler o portal oficial; permissões | — |
| Integração completa | LinkedIn | D | Nenhuma | Escopo `rw_ads`, mapeamento de grupos de campanhas | — |

## 8. O que impede declarar a V1 comercial hoje

Itens A–T do critério de lançamento ainda sem cobertura completa: edição de mais campos que status e orçamento (G), gestão de anúncios individuais (H), duplicação (J), criação (K), configurações de conjuntos (L), criativos e destinos (M), testes de escrita real autorizados (P) e documentação de limites por plataforma além da Meta (Q). A navegação (A, B, C), filtros (E), lote (I, parcial), auditoria (N), aprovação financeira (O) e a segurança entre organizações (S) estão cobertas, ressalvando a homologação real.
