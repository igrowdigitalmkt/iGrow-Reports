# iGrow Reports — estado do projeto (14/10/2026)

Resumo para continuar o desenvolvimento sem o histórico da conversa. Detalhes datados em `docs/IMPLEMENTACAO.md`; plano multiplataforma em `docs/MULTIPLATAFORMA.md`; IA em `docs/VISAO_IA.md`; PDF em `docs/RELATORIO_PDF.md`. Leia também `CLAUDE.md`, `AGENTS.md` e `docs/CONTINUIDADE_PROJETO.md`.

## Ambiente e rotina
- Next.js 16 (App Router, server actions), React 19, TypeScript, Supabase (projeto `qlopniyghvpbgwxuwxrl`, RLS), Vercel (deploy automático a cada push em `master`; produção `https://i-grow-reports.vercel.app`), pnpm.
- Validação completa: `pnpm check` (lint, typecheck, vitest, testes SQL em PGlite, rollout, build). Último resultado: 134 arquivos / 800 testes passando. Com o servidor de dev ligado no Windows o build pode falhar por trava do módulo `sharp`; pare o dev e rode de novo.
- Migrations: testar em PGlite (`pnpm test:db`) e aplicar em produção pelo MCP `apply_migration`. **Nunca reaplicar** as já aplicadas (lista abaixo).
- Autorizações do responsável: decidir e avançar, commit/push em `master`, aplicar migrations, leitura do banco de produção. Ações com dinheiro real, senhas, chaves e envio a clientes reais são sempre dele.
- Preferências: PDF em A4; linguagem neutra (não chamar o usuário de "agência"); nunca usar "resultado principal" (todos os tipos de resultado, cada um com custo próprio); IA nunca calcula números.

## Migrations aplicadas em produção (não reaplicar)
`202610120002_ai_layer`, `…0003_client_profiles`, `…0004_ai_usage_features`, `…0005_remove_primary_result_warning`, `202610130001_report_settings`, `…0002_ai_whatsapp_approval`, `…0003_service_client_hierarchy`, `…0004_account_separation`, `202610140001_google_ads_foundation`, `…0002_google_account_login`, `202610140003_platform_admin` (Super Admin).

## Funcionalidades implementadas
**IA (Anthropic, `claude-sonnet-5-5`)** — caminho único `src/modules/ai/guarded-text.ts` (configuração, orçamento mensal padrão US$ 5, verificador de números, registro em `ai_usage`). Comentário do relatório, Resumo do dia (carteira), perfil do cliente, e análise `{{analise_ia}}` nas mensagens de WhatsApp com **aprovação antes de cada envio** (status `awaiting_approval`, painel "Aprovações pendentes" em Agendamentos). Na análise por WhatsApp: até 3 melhores/piores anúncios, conta sem investimento resumida, sem comparar custos entre contas ou plataformas.

**PDF novo** (`src/modules/reports/pdf/`, @react-pdf, A4) — escolhido por organização em Configurações → Layout do PDF (clássico/novo). Um arquivo único com **seções por conta e por plataforma**, cada seção com **capa** centralizada (empresa, cliente, conta, plataforma, período) e linha pequena de cabeçalho nas páginas. Saldo só das contas do relatório; rótulo "Cliques no link das campanhas de tráfego" para o resultado de tráfego.

**Contas separadas por padrão** — dashboard mostra "Resultados por conta"; caixa "Consolidar resultados" no filtro de contas (parâmetro `consolidar=1`). Agendamentos têm `consolidate_accounts` (padrão falso): mensagem com bloco por conta; PDF do número oficial (layout novo) com seção por conta. Exportar PDF com contas separadas gera um relatório salvo por conta e baixa um PDF único.

**Dashboard do cliente** — cabeçalho fixo (normal e Apresentar) com fundo próprio de ponta a ponta e linha de divisão; corpo com fundo mais escuro. Seções por plataforma (Meta, Google) na ordem do seletor de plataformas (preferência no navegador; vale também no PDF exportado). Filtro de contas e "Qualidade dos dados" dentro da seção Meta. "Análise por conta" (página `/snapshots`) foi removida.

**Multiplataforma** — `src/modules/platforms/` (registro e contrato de conector). **Google Ads** (`src/modules/google-ads/`): OAuth (`/api/google/oauth/start|callback`), token cifrado em `private.integration_secrets`, contas pelo gerente (MCC, opcional) **e** por acesso direto, vínculo conta↔cliente em Integrações, leitura ao vivo da API (sem cópia no banco), seção no painel, PDF e mensagem. Resultados: Conversões e Visualizações de vídeo (`metrics.video_trueview_views`). Versão da API padrão `v25` (`GOOGLE_ADS_API_VERSION` opcional). Token de desenvolvedor é opcional (o Google o desativou em 9/9/2026; o acesso vem do projeto do Google Cloud).

**Integrações** — botão "Desconectar" padronizado (`src/components/ui/connected-card.tsx`) em Seu WhatsApp (QR), WhatsApp API oficial, Google Ads (revoga, apaga token, desvincula, arquiva contas) e Meta por cliente (revoga, apaga token; histórico e vínculos ficam). Toda integração nova deve usar esse componente.

## Configuração externa atual (Google)
- Projeto Google Cloud `igrow-reports`: Google Ads API ativada; nível de acesso **Exploração** (2.880 operações/dia em contas reais). Tela OAuth criada (externo, modo **Testando**, escopo `auth/adwords`, usuário de teste `igrowdigitalmkt@gmail.com`). Cliente OAuth web com retorno `https://i-grow-reports.vercel.app/api/google/oauth/callback`.
- Vercel: `GOOGLE_ADS_CLIENT_ID` e `GOOGLE_ADS_CLIENT_SECRET` cadastrados; `NEXT_PUBLIC_APP_URL` existente.
- Google Ads: gerente `592-657-6842` (sem contas vinculadas); conta `744-464-3364` (iGrow Digital) acessada diretamente, com campanha de teste "Website traffic-Search-1" ativa, R$ 10/dia. Para teste, essa conta foi vinculada ao cliente **Colégio Crescer** — desvincular após o teste.

## Pendências (ordem sugerida)
1. Validar com dados reais do Google: seção no painel do Colégio Crescer, PDF com Meta+Google, mensagem de WhatsApp; depois pausar a campanha de teste e desvincular a conta do cliente.
2. Testar "Desconectar" do Google e reconectar (fluxo do usuário novo) e o "Desconectar" da Meta num cliente sem importância (não testado em produção).
3. Sair do modo teste do Google: domínio próprio → Vercel/`NEXT_PUBLIC_APP_URL`/retorno OAuth → branding e verificação de domínio → publicar app → Acesso básico da API (verificação de marca) → verificação do app (escopo sensível).
4. Ordem das plataformas por organização (hoje só no navegador; envios automáticos usam Meta primeiro).
5. Conectores TikTok e LinkedIn (dependem de aprovações externas); E-mail.
6. Pendências antigas: reduzir `entity_rows` salvos por versão (~3,8 MB); remover de vez `client_metric_mappings`/`primaryMetricKey`; congelar público/saldo no relatório salvo; apelido/descrição por conta para a IA.

## Super Admin — etapa 1: implementada, publicada e homologada (14/10/2026)
- **Estado:** commit `c7b4fd2` na `master` (deploy Vercel Ready), migration `202610140003_platform_admin` aplicada em produção, proprietário real provisionado, dois autenticadores TOTP cadastrados e acesso ao `/admin` validado. Homologação em projeto Supabase separado (`docs/SUPERADMIN_HOMOLOGACAO.md`, `scripts/check-admin-homolog.mjs`, 9/9 verificações); verificação final em produção só com leitura: 1 proprietário ativo, 2 autenticadores validados, auditoria sem falhas, `/api/health` e rotas existentes OK.
- **Arquitetura:** `private.platform_operators` e `private.platform_audit_log` (append-only) sem acesso direto da API; funções `platform_operator_status`, `platform_record_audit`, `platform_recent_audit` (aal2 lido do JWT no banco); `private.provision_platform_owner` e `private.deactivate_platform_operator` só pelo dono do banco. Código em `src/modules/platform-admin/` (guardas de página/ação/API, MFA TOTP, auditoria, `proxy-gate.ts` para 404/307 reais), rotas `/admin`, `/admin/mfa`, `/api/admin/session`. Operador ≠ `agency_users`.
- **Operação:** recuperação de MFA = remover os fatores da conta no painel do Supabase e recadastrar (sem acesso alternativo); desativar operador com `private.deactivate_platform_operator` (recusa o último proprietário). Sem service role no Super Admin.
- **Limitações:** só o papel `owner`; sem tela de gestão de operadores; auditoria só de MFA e provisionamento; teto de 30 eventos/hora sem MFA. Recomendado: ativar proteção contra senhas vazadas no Supabase Auth e manter a verificação em duas etapas do Google.
- **Próxima etapa (2): ARQUITETURA COMERCIAL E GATEWAY DE PAGAMENTO.** Requisito obrigatório: a V1 terá pagamentos automatizados, sem cobrança, ativação ou assinatura manual. O gateway deve permitir contratação, cobrança recorrente e atualização automática das assinaturas (webhooks autenticados e idempotentes). Primeiro comparar gateways (Asaas, Mercado Pago, Stripe, Pagar.me e outros) por recorrência, cartão, Pix, boleto, taxas, API/webhooks, segurança, cancelamento/reembolso, troca de plano e sustentabilidade; depois modelar planos, preços versionados, assinaturas, limites e `getEntitlements`. Não iniciada.

## Etapa 2.1 — catálogo comercial e direitos de uso: PUBLICADA em produção (14/10/2026)
- Decisão: gateway **Asaas**, cobrança sempre automatizada (nada manual). Esta etapa **não** cria cobrança nem assinatura paga. Detalhes, regras e roteiro de homologação em `docs/COMERCIAL_CATALOGO.md`.
- **Publicação (14/10/2026):** migration `202610140004_commercial_catalog.sql` aplicada em produção (registro `20261014234415 commercial_catalog_0140004`), commit `6032545` na `master` e no GitHub, deploy Vercel `dpl_HtXVYwK4191NyTPTENFKk6mTFca8` (`n6zrry69w`) Ready/success. Deploy anterior (para rollback do código): `dpl_HG8hLk29NwenZjYUFUJLFsX2ob4R` (`hp4tu4in6`, commit `c7b4fd2`). Produção segue com 0 planos, 0 atribuições, 0 concessões e todos os interruptores ligados: as 2 organizações reais continuam sem plano (sem restrição). Não aplicar de novo.
- Implementado: migration `202610140004_commercial_catalog.sql`; planos com versões imutáveis, catálogo de recursos, atribuição de plano por organização, concessões, interruptor global; limites aplicados por gatilhos no banco e IA no servidor; telas `/admin/planos`, `/admin/recursos`, `/admin/organizacoes`. Organizações existentes e o cadastro público não mudam (sem plano atribuído = sem restrição).
- Homologação (projeto `igrow-homologacao`): 34 testes reais de concorrência/segurança OK, fluxos de interface e responsivo OK; ressalvas e procedimento de publicação em `docs/COMERCIAL_CATALOGO.md`. Decisão registrada: QR Code do WhatsApp será funcionalidade por plano + interruptor global (sem quantidades definidas; nada alterado em produção).
- Próxima etapa (aguarda autorização): 2.2 núcleo financeiro com o Asaas em sandbox (cliente, checkout de cartão, webhook verificado, estados da assinatura, reconciliação).

## Etapa 2.2A — fundação financeira com o Asaas (branch `feat/billing-foundation`, local; sem commit)
- Implementada só no código local: migration `202610150001_billing_foundation.sql` (**NÃO aplicada em nenhum banco**), módulo `src/modules/billing`, rotas inertes `/api/webhooks/asaas` e `/api/cron/billing` (sem agendamento), testes (pgTAP + vitest). **Não validada no Sandbox do Asaas.** Detalhes, estados e pendências em `docs/FINANCEIRO_ASAAS.md`.
- **Homologação técnica (15/10/2026):** migrations `202610150001` e `202610150002` aplicadas **só** em `igrow-homologacao`; 180 verificações no PostgreSQL real, concorrência real (27 verificações, 3 execuções limpas) e 9 testes contra o Asaas Sandbox real aprovados; 1 defeito de concorrência e 1 incompatibilidade do Asaas (dados de cobrança exigidos pelo checkout) encontrados e corrigidos. Pagamento pelo checkout hospedado e webhooks reais ainda NÃO homologados. Resultados em `docs/HOMOLOGACAO_FINANCEIRA.md` e `docs/FINANCEIRO_ASAAS.md`. Nada em produção; sem commit.
- Próximo passo (aguarda autorização): concluir a validação no Sandbox e webhooks reais, depois checkout e Minha Assinatura.

## Etapa 2.2B: contratação e checkout (branch `feat/checkout-contratacao`, local; sem commit)
- Tela `/dashboard/assinatura` + retorno do checkout, ação de servidor, eventos de checkout no processador, vínculo checkout↔assinatura reforçado, migration `202610150003_billing_checkout_link.sql` (**NÃO aplicada em nenhum banco**). Commit da 2.2A: `365f86f`. Detalhes em `docs/FINANCEIRO_ASAAS.md`; procedimento de homologação real e do ambiente Vercel isolado em `docs/HOMOLOGACAO_CHECKOUT.md`.
- NÃO homologada: falta pagar pelo checkout hospedado e receber webhooks reais no Sandbox. Nada em produção.

## Etapa 2.2B.1: ambiente de homologação do checkout (15/10/2026)
- Commit local `07a9d64` (sem push); migration 0003 aplicada só em homologação; projeto Vercel isolado `i-grow-reports-homolog` publicado e protegido; webhook verificado, **não cadastrado no Asaas**; sem cron; nenhum pagamento. Detalhes em `docs/HOMOLOGACAO_CHECKOUT.md` seção 6. Próximo: 2.2B.2 (aguarda autorização).

## Recuperação financeira (15/10/2026): aplicada e publicada SOMENTE em homologação
- Webhook real corrigido (id de evento com `&`) e primeiro pagamento mensal ativado em ~3 s. Revisão de segurança: só `checkoutSession`/`externalReference` ativam (coincidência vai para revisão), sem prazo para o vínculo por identificador, sem liberação de nova contratação por decurso de prazo (conferência conclusiva ou operador auditado), `billing_reconcile_work` com reivindicação atômica. Migration `202610150004_billing_recovery.sql` aplicada em `igrow-homologacao` (`billing_recovery_0150004`); deploy de homologação feito. Testes reais: PostgreSQL de homologação (75 asserções em transação revertida + concorrência por conexões independentes, 21 verificações) e leitura real do Asaas Sandbox. **NÃO feito:** recuperação por cron de ponta a ponta com pagamento real sem webhook; agendamento permanente; commit; produção. Detalhes: `docs/RECUPERACAO_FINANCEIRA.md`.

## Recuperação sem webhook: homologada em 15/10/2026 (homologação)
- Pagamento real do Sandbox, webhook bloqueado e restaurado, ativação em 6,6 min pelo agendador temporário local (não é o agendamento permanente). Defeito encontrado e corrigido no caminho (regex de `dateCreated`). Detalhes em `docs/HOMOLOGACAO_RECUPERACAO_SEM_WEBHOOK.md`. Pendente: agendamento permanente na VPS, cron manual como origem separada, decisões de política financeira, commit/produção.

## Etapa 2.2C / 2.2C.1: ciclo de vida das assinaturas (15/10/2026): aplicada e publicada SÓ em homologação
- Cancelamento pelo proprietário (ação de servidor + confirmação na tela), resumo da assinatura, estados novos, reconferência horária de atraso/vencimento e auditoria da confirmação remota. Migration `202610150005_billing_lifecycle.sql` aplicada em `igrow-homologacao`, deploy de homologação feito; testada em PostgreSQL real e no navegador, **sem cancelamento real no Asaas ainda**. Detalhes: `docs/CICLO_DE_VIDA_ASSINATURAS.md`. Pendente: homologação real (cancelamento, renovação, atraso), cron permanente, reativação antes do fim do período, upgrade/downgrade.

## Problemas e limitações conhecidos
- Google: sem saldo e sem melhores/piores anúncios; "Conversões" soma todas as ações de conversão; "Consolidar" só vale para a Meta; cliente só com Google (sem Meta) não abre o painel; em modo teste a conexão expira em ~7 dias e só usuários de teste conectam.
- Layout clássico do PDF não monta arquivo único (baixa um por conta) e ignora seções por conta/plataforma.
- Comentário da IA entra só na primeira seção do PDF combinado.
- O classificador de segurança do ambiente bloqueia ações do assistente que movimentam dinheiro (ex.: criar campanhas); o responsável faz essas etapas.
- Capturas de tela do navegador de teste às vezes falham; verificar por medição (JS) quando necessário.

## Decisões técnicas
- Números sempre calculados por código; a IA só redige e passa por verificador de números.
- Formato comum de dados: `AnalyticsDashboardData`; conectores novos só precisam produzir esse formato por conta.
- Contas e plataformas nunca têm resultados somados ou comparados entre si; só investimento, cliques e impressões entram em totais.
- Envios de IA por WhatsApp sempre aguardam aprovação humana; nunca enviar teste a clientes reais.
- Dados do Google lidos ao vivo (sem tabelas de coleta); dados da Meta seguem o pipeline de coleta existente.

## Fechamento da V1 (15/10/2026)
Ver `docs/LANCAMENTO_V1.md` (checklist de produção) e `docs/SUSPENSAO_E_MONITORAMENTO.md`. Código local pronto e homologado; produção NÃO tocada (migrations 0001–0008, variáveis, webhook, cron e chaves do Asaas de produção dependem de autorização). Teste gratuito no cadastro, seleção de plano sem pré-seleção, Google ao vivo sob a restrição e suporte a produção do Asaas (travado por padrão) entraram nesta rodada.

## Gestão de Campanhas no menu do cliente (20/10/2026): implementada no worktree `feat/campaign-management`, local, sem commit

- **Navegação:** Campanhas saiu da barra principal e vive no menu do cliente (`/clientes/ID/campanhas`, rota estática que vence o catch-all). Entrar ou sair dela usa a navegação do Next (`ROUTED_SECTIONS` em `client-sections.ts`); entre Dashboard, Métricas e Relatórios continua o `history.pushState`. `/campanhas` (global) só redireciona. O layout do cliente responde 404 para cliente inexistente ou de outra organização.
- **Dashboard preserva a seleção de campanhas** que antes era a aba Campanhas (alimenta o Dashboard): agora é o painel "Selecionar campanhas" do próprio Dashboard. Na demonstração a aba antiga continua.
- **Detalhes:** `/clientes/ID/campanhas/meta/CONTA/(campanha|conjunto|anuncio)/ID-EXTERNO`; cliente da organização, conta vinculada, nível e identificador validados no servidor; sem dados confirmados aparece "—" (não zero); orçamento, públicos, posicionamentos e programação não são coletados e não aparecem. O assistente é o mesmo da lista (`assistant/session.tsx`: conversas por contexto compartilhadas no layout de Campanhas; contexto inicial = entidade aberta).
- **Colunas:** preferência local (só chaves, ordem escolhida, por organização + usuário). Índice de filhos em memória na tabela.
- **Validação:** `tests/campaign-navigation.test.ts` e demais `tests/campaign*`; navegação, segurança de URL e capturas (`docs/capturas-campanhas/4.0-*`) verificadas com fixtures locais temporárias (removidas). Não há commit, deploy, migration aplicada nem chamada paga. O assistente segue desligado (`CAMPAIGN_CHAT_ENABLED` não definido); migrations `202610200001/2` continuam NÃO aplicadas (ver `docs/HOMOLOGACAO_CHAT_CAMPANHAS.md`).

## Campanhas e Assistente Groow: PUBLICADOS em produção (20/10/2026)

- **Código:** `master` = `bc65aa5` (fast-forward de `feat/campaign-management`, sem conflitos); deployment de produção `i-grow-reports` (domínio `groowads.com`) com `CAMPAIGN_CHAT_ENABLED=1` definido SÓ em produção. A Vercel está ligada ao `master`; a CLI da Vercel autenticada no computador do proprietário (`npx vercel`) funciona (o conector MCP da Vercel dá 403).
- **Banco:** migrations `202610200001/2` aplicadas em homologação (`xvjvfvinnnrgnhskglvd`) e em produção (`qlopniyghvpbgwxuwxrl`), com `ai_usage_supports_feature('campaign_chat')` e `ai_reservations_ready()` verdadeiros, permissões e índices conferidos, 25 linhas anteriores de `ai_usage` preservadas.
- **Concorrência real (PostgreSQL de homologação):** 23 verificações aprovadas (12 reservas simultâneas, idempotência, conflito, liquidação simultânea, isolamento, consumo desconhecido, reservas abandonadas), executadas por uma função temporária (já neutralizada) que usa a chave de serviço do próprio runtime.
- **Anthropic (real, homologação):** `claude-sonnet-5-5`, fatos de fixture local e reserva/liquidação reais no banco de homologação (organização sintética, orçamento US$ 1,00, gasto total ≈ US$ 0,30). Bloqueio por orçamento comprovado sem chamada ao modelo. Ajustes feitos: prompt conciso e `effort: low` (antes 1 de 4 respostas esbarrava no limite de saída e outras eram bloqueadas pelo verificador); amostra final: 11 de 12 respostas entregues, a bloqueada digitou um número.
- **Limitação importante:** o banco de homologação NÃO tem o esquema analítico completo (faltam, por exemplo, `get_client_analytics*` e as tabelas do WhatsApp/coleta Meta): a aplicação de Campanhas não roda nele. A homologação de aplicação completa exige antes levar a homologação à paridade com a produção (dezenas de migrations; funções divergentes).
- **Pendente:** validação autenticada em produção (login, Campanhas, detalhes, primeira pergunta real) por quem tem sessão; desligar o chat = remover `CAMPAIGN_CHAT_ENABLED` e fazer redeploy.

## Validação real em produção (20/10/2026, sessão autenticada do proprietário no Chrome)

- **Teste real autenticado (somente leitura):** Clientes → Colégio Crescer → Campanhas (78 campanhas, 2 contas) → detalhes de campanha, conjunto e anúncio, breadcrumbs, Campanhas ↔ Dashboard, painel "Selecionar campanhas" e aplicação da seleção (Dashboard R$ 4.457,81 → R$ 4.290,69 sem uma campanha de R$ 167,43), troca para RM Imobiliária (183 campanhas, sem dados do cliente anterior). A barra principal não tem Campanhas.
- **Conferência com o banco:** gasto total do período = soma da tabela nos dois clientes (R$ 4.457,81 e R$ 4.872,33, BRL) e impressões, cliques e resultados de campanhas amostradas iguais ao banco. Observação: o agregado ao vivo da Meta na seleção difere R$ 0,31 da soma diária (comportamento anterior do painel).
- **Isolamento:** UUID aleatório, conta de outro cliente, nível ou ID malformados e IDs adulterados respondem "não encontrado", sem nome de entidade. Corrigido: conta de outro cliente chegava à camada de dados (42501 no log); agora o vínculo é conferido antes (commit `ded3b03`, deploy Ready). Texto do estado vazio do assistente corrigido.
- **Assistente:** duas perguntas reais já constam em produção (organização iGrow Digital, Colégio Crescer): reservado US$ 0,029 e 0,031, custo real US$ 0,0107 e 0,0112, `status=ok`, verificador aprovado, sem pendências. As perguntas deste ciclo não foram feitas pela automação (a digitação foi negada pelo classificador de segurança do ambiente); falta uma conferência da qualidade das respostas por quem as leu.
- **Logs (2 h):** nenhum aviso de `campaign_chat`, nenhuma falha de liquidação; os únicos erros foram os do teste de URL adulterada, já corrigido.
- **Homologação, diferenças que impedem testar Campanhas:** faltam as funções `get_client_analytics`, `get_client_analytics_hierarchy`, `get_campaign_scoped_analytics`, `get_client_report_header`, `warm_client_analytics`, `persist_meta_insight_slice`, `persist_meta_detailed_slice`, `request_meta_collection_refresh`, `claim_meta_collection_job` e as tabelas `meta_period_insights`, `meta_collection_runs`, `meta_dashboard_scopes`, `integration_*` (e as de WhatsApp usadas no layout). Vêm das migrations `202610010015` a `0031`, `202610040001` a `0013` e `202610050001` a `0006` (e as de WhatsApp `202610070011` em diante); além disso, várias funções comuns têm versões diferentes das de produção.

## Assistente Groow validado em produção com sessão real (20/10/2026)

- Quatro perguntas reais no navegador embutido (organização iGrow Digital, Colégio Crescer, campanha PROCESSO SELETIVO, período 20/09 a 19/10): uma bloqueada pelo verificador (número digitado, registrada como `rejected_numbers`) e, depois do ajuste do prompt (contagens por extenso, commit `1a8294f`), três respondidas ("Analise o desempenho desta campanha", "Qual conjunto apresentou mais resultados?", "E por que ele teve esse desempenho?"). Valores conferem com a tela e o banco (R$ 1.537,17; 206.373 impressões; 3.384 cliques; 2.627 resultados = 1.217 + 1.024 + 386 por conjunto), a continuidade resolve "ele" pelo histórico e as limitações são citadas (sem dados de público/criativo, conta sem veiculação).
- Contabilização: reserva US$ 0,062 a 0,067, custo real US$ 0,023 a 0,026, todas liquidadas, nenhuma pendência; gasto da organização no mês US$ 0,63 de US$ 2,00. Trocar de cliente por navegação normal descartou a conversa (6 mensagens para 0).
- Taxa de bloqueio do verificador observada: 1 de 7 respostas reais em produção (as outras 6 entregues); acompanhar pelo log `campaign_chat unverified_numbers` (só números, sem texto).


## Gestão operacional de Campanhas (20/10/2026)
- Detalhes, causas e decisões em `docs/GESTAO_OPERACIONAL_CAMPANHAS.md`: zeros por ausência de linha corrigidos em Campanhas; divergência de R$ 0,31 explicada (duas coletas da Meta em horários diferentes), sem forçar números; reservas atômicas em todos os consumidores de IA (relatório, carteira, WhatsApp, decisão do agente, assistente); operações manuais (pausar/retomar/orçamento) em campanha e conjunto pelo executor existente; "Analisar oportunidades" com cinco estados e aprovação humana específica.
- Execução real de anúncios continua DESLIGADA (interruptor da organização); nenhuma campanha real foi alterada.
- Capturas: `docs/capturas-campanhas/6.0-*` (fixtures locais, removidas).
- **Publicação (20/10/2026):** `master` em `3c86990` (fast-forward de `18ecfc0`), deploy Vercel de produção Ready, `/api/health` ok. Verificação autenticada somente leitura: Campanhas mostra a seção "Análise operacional com IA" (sem clicar em Analisar); a página de campanha mostra o cartão "Operações" no estado "conta sem permissão de gerenciamento de anúncios" (a conexão atual não tem `ads_management`), sem oferecer nenhuma escrita. Nenhuma migration nova; nenhuma campanha alterada. Testes: 1679 aprovados, 1 teste de etiquetas do WhatsApp já falhava antes (`whatsapp-native-label-sync-provider`) e outro oscila sob carga.

## Preparação para operações reais (21/10/2026)
- Detalhes em `docs/PREPARACAO_OPERACOES_REAIS.md`. **Correção:** as três conexões Meta têm `ads_management` guardado; o "indisponível" visto em produção era da conta Escola Crescer (`account_status` 3). Campanhas agora separa conta restrita, conexão e permissão, com leitura ao vivo de `/me/permissions` antes de oferecer ações.
- Limite percentual de orçamento: a interface era um passo mais restritiva que o executor (10x contra 11x); agora usa a fórmula e o limite do executor (fonte única `policy.ts`), com teste de paridade.
- Análise operacional: estágios vazios recolhidos, motivo e conta nas propostas, atalho do Assistente (só navega; nunca cria operações).
- Painel de IA (Configurações): consumo liquidado, reservado, desconhecido e disponível separados; tipos do banco atualizados.
- WhatsApp: `whatsapp-native-label-sync-provider` falhava de forma determinística no Windows (checkout CRLF fazia o teste capturar o arquivo inteiro); corrigido no teste. `whatsapp-labels-browser` é um teste de navegador que oscila sob carga da suíte completa (passa isolado repetidas vezes).
- **Executor:** conferido que NÃO está desligado em produção (direito global ligado e override da iGrow Digital até 26/10/2026 13:07 UTC, escopo de homologação do Colégio Crescer); os botões manuais executam de verdade nesse escopo. Nenhuma campanha foi alterada neste ciclo e nenhuma migration nova.
- Correção da leitura da entidade na tela de operações: o `getObjects` (nunca usado antes) falhou em produção; agora usa o mesmo GET direto do executor.
