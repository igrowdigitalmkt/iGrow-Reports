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
