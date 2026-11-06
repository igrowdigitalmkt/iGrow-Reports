# Análise de desempenho — Groow Ads (06/11/2026)

Escopo: análise de código, build real e leitura do banco de produção (Supabase `qlopniyghvpbgwxuwxrl`, somente leitura). Nenhum código de produto foi alterado e nenhuma migração foi aplicada. Base: `master` @ `3ed1373` (branch `feat/ai-credits-menu`, idêntica à `master` no momento da análise).

## 1. Resumo executivo (para o proprietário)

A plataforma está lenta por **três motivos que se somam**, e nenhum deles é "o servidor ser fraco":

1. **Cada clique faz muitas viagens ao banco, uma depois da outra.** Antes de mostrar qualquer tela, o sistema confirma quem você é na rede (1 viagem), busca suas organizações (1), conta clientes (1), confere permissões (1), conta conversas não lidas (1) e calcula os créditos de IA (3). São cerca de 7 a 8 viagens em fila só para desenhar o menu. Isso se repete em toda navegação e em toda atualização automática.
2. **O painel do cliente consulta a Meta e o Google "ao vivo" enquanto a página carrega**, e o Google não tem nenhum cache: toda abertura do painel e das campanhas chama a API do Google de novo (4 chamadas por conta). A Meta tem cache de 24 h, mas, quando vence, quem abre o painel espera as chamadas (até 25 s por tentativa). Além disso, o painel reconsulta o banco **a cada 60 s** enquanto estiver aberto.
3. **O navegador baixa JavaScript demais.** Todas as telas da área de trabalho (Clientes, Integrações, WhatsApp, Relatórios, Agendamentos, Entregas, Modelos, Equipe, Configurações) carregam **o mesmo pacote de ~643 KB comprimidos (2,4 MB descomprimidos)**, incluindo o WhatsApp inteiro, dados de demonstração e relatórios, mesmo quando você só abre "Clientes". Uma página simples (ex.: Termos) carrega 143 KB.

O banco em si **está saudável e pequeno** (maior tabela: 41 MB). O custo está na **quantidade de chamadas** e em **três funções de análise** (`get_client_analytics`, `get_client_analytics_hierarchy`, `warm_client_analytics`) que, juntas, consumiram ~2.500 s de tempo de banco, com média de 330–1.200 ms e picos de 6–8 s.

**Ganhos mais prováveis (resumo):** (a) montar o menu com 1 viagem em vez de ~8 e reaproveitar a identidade já validada; (b) tirar o Google Ads do caminho crítico (cache curto + carregamento em segundo plano com "esqueleto"); (c) dividir o pacote de JavaScript por tela; (d) reduzir o ritmo e o custo das atualizações automáticas (Leads a cada 5 s, painel a cada 60 s, WhatsApp com ~5 laços); (e) paralelizar as consultas sequenciais das páginas de Clientes/Integrações/Relatórios.

> Distinção exigida pelo projeto: tudo abaixo é **análise do código atual publicado na `master`**. Os ganhos esperados são **estimativas** — nada foi implementado nem homologado nesta etapa.

---

## 2. Diagnóstico por área, com evidências

### 2.1 Caminho da requisição

| Fato | Evidência |
|---|---|
| O `proxy` (antigo middleware) roda `supabase.auth.getClaims()` em toda rota de área logada. É barato quando a chave de assinatura é assimétrica (verificação local), mas é uma chamada de rede se o projeto usa chave simétrica (HS256). **Não verificado qual é o caso.** | `src/proxy.ts`, `src/lib/supabase/proxy.ts:42` |
| Depois, **o servidor chama `auth.getUser()` de novo**, que é sempre uma ida à API de autenticação da Supabase. Isso ocorre em toda página, rota `/api` e Server Action. | `src/modules/agencies/context.ts:22` |
| `requireAgencyContext` é deduplicada por requisição com `cache()` do React (bom), mas faz 2 viagens seguidas: `getUser` → `agency_users` com join. | `context.ts:41-50` |
| **`requireClientDashboardAccess` não é deduplicada** e refaz `getUser`, `clients` e `agency_users` a cada chamada — inclusive a cada Server Action de atualização do painel. | `src/modules/client-portal/context.ts:49-73` |
| O layout da área de trabalho, depois do contexto, executa **em fila**: contagem de clientes → permissões → conversas não lidas (`select("*")`, limite 500, só para contar) → créditos de IA (3 consultas, em paralelo entre si, mas depois das anteriores). | `src/app/(workspace)/layout.tsx:15-23`, `src/modules/ai/credits-usage.ts` |
| O menu do cliente (`clientes/[clientId]/layout.tsx`) faz mais uma consulta (`clients`) além do contexto. Layout e página renderizam em paralelo no Next, então isso não é cascata pura, mas soma carga ao banco. | `src/app/(workspace)/clientes/[clientId]/layout.tsx` |
| `force-dynamic` e `maxDuration = 300` em praticamente todas as páginas. Não há **nenhum** `use cache`, `unstable_cache` ou `revalidate` no código de produto; `cacheComponents` está desligado em `next.config.ts`. Toda página é renderizada no servidor a cada visita. | `grep` em `src/app`; `next.config.ts` |
| `loading.tsx` existe nos níveis principais (workspace, cliente, campanhas) e há `Suspense` no portfólio. Isso melhora a *percepção*, mas o conteúdo só chega depois da cascata acima. | `src/app/**/loading.tsx`, `workspace-page.tsx` |
| Resposta do `proxy` inclui `Cache-Control: private, no-store` em tudo (correto para dados privados; impede cache de borda, mas não afeta os estáticos). | `src/lib/supabase/proxy.ts:15` |

**Estimativa de viagens por navegação** (layout + página típica): ~8 no layout + 2–6 na página. Com cada viagem Vercel→Supabase entre 5 e 30 ms mais o tempo de execução, o menu sozinho custa algumas centenas de milissegundos; as chamadas de autenticação (`getUser`) são geralmente as mais lentas (50–200 ms).

### 2.2 Dados por tela

**Painel do cliente** (`ClientAnalyticsScreen`, `src/modules/client-portal/client-analytics-screen.tsx`) — a tela mais cara. Sequência dentro de uma única renderização, tudo com `await` em fila:
1. `requireClientDashboardAccess` (3 viagens) →
2. RPC `get_client_portal_data_context` →
3. RPC `get_client_analytics` (330–560 ms em média) →
4. histórico de relatórios (`getReportsAdminSnapshot`, que lê **todas** as versões da organização em páginas e filtra por cliente em memória) →
5. possível **segunda** `get_client_analytics` (quando o período não termina no último dia completo) →
6. `getFreshClientAnalytics`: verifica o cache da Meta (`meta_dashboard_scopes`, linha de até vários MB, só lê metadados) e, se vencido (>24 h), chama a Meta ao vivo: por conta, **6 chamadas** (atual, anterior, campanhas anteriores, campanha/conjunto/anúncio), timeout 25 s, depois uma **terceira** `get_client_analytics` para reler. `analytics-live.ts`, `meta/server.ts:97-126`.
7. Se "contas separadas" estiver ligado: repete (6) para cada conta.
8. `loadGoogleSections`: 4 consultas à API do Google **por conta, sem cache algum**, a cada abertura. `google-ads/provider.ts` (função `loadGoogleSections`).
9. RPC `get_client_report_header`; no portal do cliente, mais uma contagem de `lead_pages`.

No navegador, `analytics-dashboard.tsx:814` agenda `refresh()` **a cada 60 s e a cada retorno de visibilidade**. Cada execução é uma Server Action que repete o passo 1 (3 viagens), o passo 3 (e potencialmente o 6) e chama `get_client_analytics_hierarchy` (média 394 ms, máx. 7,6 s). Essa é a **maior fonte isolada de tempo de banco**: 1.680 chamadas = 662 s no total.

**Campanhas** (`clientes/[clientId]/campanhas/page.tsx`): `force-dynamic`, `maxDuration 60`, leitura ao vivo da Meta (campanhas, conjuntos e anúncios) e depois, em fila, do Google (`loadGoogleCampaignRows`). Há cache curto injetado só no catálogo operacional (comentário em `analytics-hierarchy-loader.ts:30`); o Google não tem.

**Leads** (`src/modules/lead-pages/hub-query.ts`, `src/app/api/leads/clients/[clientId]/route.ts`): cada atualização (a cada **5 s** por aba aberta, `leads-board.tsx:15`, `lead-feed-view.tsx:10`) faz: autorização (`authorizeLeadsClient`), `lead_pages`, `lead_forms`, **até 5.000 linhas de `leads`** (`AGGREGATE_LIMIT`, linha 12) trazidas para contar status/formulário/canal/campanha **em memória do servidor**, mais a lista de 200 e, em segundo plano (`after`), `syncStaleSources`. Com poucos leads é aceitável; cresce linearmente com o volume e com o número de abas/usuários. O polling respeita `document.hidden` (bom).

**Clientes / Integrações / Relatórios / Entregas / Agendamentos / Modelos** (`src/modules/operations/workspace-page.tsx:40-100`): a página monta tudo com `await` sequenciais — permissões → contagem → clientes (paginado de 500 em 500) → acessos do portal → snapshot Meta → snapshot de relatórios → resumo WhatsApp → destinatários → entregas → automações → modelos. Várias dessas leituras são independentes e poderiam correr em paralelo (`Promise.all`).

**Caixa do WhatsApp** (`inbox-read.ts:45-85`, `inbox-view.tsx`): carrega **todas** as conversas com `select("*")` em páginas de 1.000 (até 10 páginas) e filtra "recentes" **depois**, no servidor. Atualização por *delta* (`updated_at`), o que é bom. Em contrapartida, a aba aberta mantém ao menos 5 laços de atualização: caixa (10 s), controles nativos (10 s), leitura (8 s), listas (15 s), bloqueio de contato (15 s), mais o contador de não lidos no menu (15 s, `app-shell.tsx:124`). Cada chamada `/api` paga a autenticação completa (`getUser` + `agency_users`). Estimativa: **>30 requisições/min por usuário com a aba aberta** (o contador de não lidos e os demais respeitam aba oculta; confirmado em `inbox-view.tsx:252,302,313`).

**Banco de dados — sinal indireto:** `whatsapp_conversations` tem 63.014 varreduras sequenciais (tabela de só 95 linhas — irrelevante hoje, mas o padrão `select *` + filtros no servidor não escala); `users` (59.077 seq scans, 10 linhas) idem.

### 2.3 Cliente (navegador)

Medido com `next build` (Turbopack) e `.next/diagnostics/route-bundle-stats.json`, gzip calculado por mim:

| Rota | JS inicial (descomprimido) | JS inicial (gzip) |
|---|---|---|
| `/` (página de vendas) | 2.519 KB | **664 KB** |
| `/clientes`, `/integracoes`, `/whatsapp`, `/relatorios`, `/agendamentos`, `/entregas`, `/equipe`, `/templates`, `/configuracoes` | 2.433 KB | **643 KB** (idêntico em todas) |
| `/clientes/[id]` (painel) | 1.236 KB | 387 KB |
| `/cliente/[id]` (portal do cliente) | 1.190 KB | 371 KB |
| `/clientes/[id]/campanhas` | 1.151 KB | 330 KB |
| `/clientes/[id]/leads` | 703 KB | 217 KB |
| menor rota (Termos) | 474 KB | 143 KB |

Causas verificadas:
- **`DashboardWorkspace` importa estaticamente todas as seções** (`src/modules/operations/dashboard-workspace.tsx:4-40`): `WhatsAppInbox` (2.211 linhas), `ReportManager`, `AutomationsView`, `TemplatesView`, `TeamView`, `IntegrationsHub`, **dados de demonstração** (`demo-data`, `inbox-demo`, `automations/demo`, `team/demo`), `motion`. Não há `next/dynamic`/`lazy` ali. Resultado: abrir "Clientes" baixa o WhatsApp inteiro.
- **A página de vendas (`/`) tem o maior pacote do produto (664 KB gz)** — afeta a primeira impressão de visitantes e o custo de anúncios.
- `analytics-dashboard.tsx` (1.305 linhas, "use client") importa `jspdf` estaticamente via `pdf-download.ts:3` (o `@react-pdf` é carregado sob demanda, bom; o `jspdf` não). O `echarts` já é carregado por `import()` dinâmico (`analytics-charts.tsx:61`, bom).
- **CSS:** ~510 KB descomprimidos no total (maiores: 123 KB, 106 KB, 84 KB). `globals.css` tem 106 KB; há ~25 arquivos CSS de módulo, 12 só do WhatsApp (inbox.css 46 KB, platform-theme 22 KB, inbox-menus-fidelity 21 KB, inbox-fidelity 20 KB…), vários explicitamente "fidelity/correções" que provavelmente se sobrepõem. O CSS bloqueia a renderização; vale consolidar e carregar o do WhatsApp só nessa rota. Não medi a duplicação regra a regra.
- **Imagens:** `public/photos` 1,8 MB, `public/product` 2,4 MB, `public/whatsapp-emojis` **16 MB** (servido sob demanda, só importa se carregado em massa pelo seletor de emoji — não medido), fontes 833 KB (Geist + Roboto Variable; confirmar se as duas famílias são realmente usadas nas telas logadas).
- **Polling** (resumo): Leads 5 s (board e feed); QR 3 s só durante a conexão; painel 60 s; WhatsApp ver 2.2; menu 15 s. Os laços respeitam aba oculta, exceto os do painel do cliente (que dispara de novo ao voltar à aba).

### 2.4 Banco (Supabase, us-east-2, Postgres 17, ACTIVE_HEALTHY)

Tamanho: o maior é `meta_daily_actions` (91.850 linhas, 41 MB), depois `meta_daily_insights` (20 MB), `meta_dashboard_scopes` (**17 MB em 18 linhas** — carga JSON por linha, ~1 MB cada), `client_analytics_cache` (15 MB / 76 linhas), `report_versions` (13 MB / 14 linhas). Nada é grande para Postgres; o problema não é volume, é a forma de consultar.

`pg_stat_statements` (acumulado desde o início do monitoramento):

| Função / consulta | Chamadas | Média | Máximo | Tempo total |
|---|---|---|---|---|
| `get_client_analytics_hierarchy` | 1.680 | 394 ms | 7,6 s | 662 s |
| `get_client_analytics` (duas assinaturas) | 1.924 + 1.086 | 328 / 557 ms | 6,3 s | 631 + 605 s |
| `warm_client_analytics` | 498 | 1.205 ms | 8,0 s | 600 s |
| `billing_*` (cron de cobrança, ~a cada 9 min) | 6.057 | 62 ms | 2,6 s | 378 s |
| `get_client_portal_data_context` | 657 | 70 ms | 3,6 s | 46 s |
| `persist_meta_*` | 161 + 467 | 205 / 69 ms | 3,2 s | 65 s |
| `SELECT name FROM pg_timezone_names` | 118 | 387 ms | 7,8 s | 46 s |
| `ai_reservations_ready` | 113 | 232 ms | 4,9 s | 26 s |

Leitura: `get_client_analytics` é `plpgsql` (`SECURITY DEFINER`) que chama `private.client_analytics_base` e `private.enrich_dashboard_scope`, e há mais variantes (`_hierarchy`, `warm_`). Picos de 6–8 s sugerem leituras frias de linhas grandes (JSON de `meta_dashboard_scopes`/`client_analytics_cache`) ou contenção. **Não rodei `EXPLAIN ANALYZE`** nas funções (seria execução de consultas pesadas em produção; fica como próxima medição, com autorização).

`get_advisors` (desempenho):
- **87 chaves estrangeiras sem índice de cobertura** (INFO). As relevantes para leitura são as que filtram tabelas de uso frequente: `whatsapp_conversations(client_id)` e `(whatsapp_connection_id)`, `whatsapp_messages(agency_id)`, `meta_ad_accounts(agency_id, meta_connection_id)`, `client_ad_accounts(agency_id, ad_account_id)`, `client_google_accounts(agency_id, google_ad_account_id)`, `lead_pages(agency_id, client_id)`, `report_versions`, `report_deliveries`. Boa parte (`created_by`, `updated_by`, `*_by_fkey`) é irrelevante para leitura — não indexar.
- **`auth_rls_initplan`** (WARN): `agency_member_permissions.member_permissions_read` reavalia `auth.<função>()` por linha. Correção: `(select auth.uid())`.
- **`multiple_permissive_policies`** (WARN): `message_templates`, `report_automations`, `report_automation_targets` (duas políticas de SELECT por tabela).
- 18 índices **nunca usados** (INFO), p.ex. `leads_page_status_idx`, `whatsapp_connections_agency_idx`, `audit_logs_agency_created_idx` — custam escrita; candidatos a remoção após confirmar que a retenção de estatísticas é suficiente (as estatísticas foram reiniciadas? não verifiquei).
- **RLS por linha:** `clients_read`, `meta_daily_insights_read` usam `private.agency_role(agency_id) IS NOT NULL` e `whatsapp_conversations_read` usa `private.can_open_whatsapp(agency_id)`, funções `STABLE SECURITY DEFINER` chamadas sem `(select ...)`. O planejador pode reavaliar por linha; envolver em `(select private.agency_role(agency_id))` costuma permitir "initplan" quando o argumento é constante. Hoje as tabelas são pequenas; em `meta_daily_*`/`whatsapp_messages` isso pesará quando crescerem. **Não medido.**

Não há política de retenção observada para `meta_daily_actions`, `billing_cron_runs` (6.057 linhas só de execuções de cron) e `audit_logs`. O WhatsApp tem cron de retenção.

### 2.5 Infra

- Não há configuração de região em `vercel.json` ⇒ o padrão (normalmente `iad1`, Washington D.C.) provavelmente está a poucos milissegundos do Supabase `us-east-2` (Ohio). **Não consegui confirmar** a região real: a conexão MCP da Vercel retornou `teams: []` (sem acesso à equipe), portanto **não pude ler logs de execução, tempos de função, partidas a frio nem a análise de velocidade**.
- Crons (`vercel.json`): `meta-daily` 09:00, `whatsapp-retention` 07:30, `agent` 10:00 — plano Hobby limita crons a 1×/dia e funções a no máximo 300 s (as páginas declaram `maxDuration = 300`, o teto). Páginas que esperam APIs externas por tanto tempo seguram a função (e o usuário).
- Tudo roda em Node (`runtime = "nodejs"`); o `proxy` roda como Middleware. Não há uso de Edge para rotas simples (ex.: `/api/health`, contador de não lidos) — ganho pequeno e arriscado; não recomendado como prioridade.
- Cada Server Action/rota `/api` cria um cliente Supabase novo (`createSupabaseServerClient`), sem reuso de conexão HTTP além do keep-alive do runtime. Normal.
- Hobby: sem *Fluid Compute*/CPU garantida e sem observabilidade avançada; funções frias após inatividade (cold start típico de 300–800 ms com este tamanho de pacote). **Não medido.**

### 2.6 Organização do código

- Módulos gigantes que concentram trabalho e peso: `whatsapp/inbox-view.tsx` (2.211 linhas, vários laços de polling no mesmo componente), `client-portal/analytics-dashboard.tsx` (1.305), `meta/server.ts` (1.221, mistura cache, chamadas à Meta, persistência e regras de cobertura), `workspace-page.tsx`/`dashboard-workspace.tsx` (um "porteiro" que reúne todas as seções).
- **Duplicação de autenticação/permissão:** `requireAgencyContext`, `requireClientDashboardAccess`, `authorizeLeadsClient`, `authorizeCampaignsClient` repetem `getUser` + consulta de papel. Falta uma única função deduplicada por requisição.
- **Mesma leitura caríssima pedida várias vezes** na mesma renderização/ação (`get_client_analytics` até 3×, ver 2.2). O comentário em `analytics-live.ts` ("never repeat it needlessly") mostra que já houve preocupação — falta estender ao resto.
- `select("*")` em cerca de 25 pontos (ex.: layout, caixa do WhatsApp, `agent_*`), levando colunas não usadas pela tela.

---

## 3. Achados ranqueados

Escala: Impacto (A/M/B) × Esforço (P/M/G) × Risco (B/M/A). Prioridade = impacto alto, esforço e risco baixos primeiro.

| # | Achado | O que mudar e onde | Ganho esperado | Como medir | I × E × R |
|---|---|---|---|---|---|
| 1 | **Google Ads sem cache, no caminho crítico** do painel e das campanhas | Cache curto (ex.: 5–15 min, por conta+período) em `loadGoogleSections`/`loadGoogleCampaignRows`; ou renderizar o painel sem Google e carregar o bloco do Google dentro de `<Suspense>` com esqueleto. | Remove 4 chamadas externas por conta de cada abertura (centenas de ms a segundos). | Tempo da página `/clientes/[id]` antes/depois num cliente com Google; log do tempo de `loadGoogleSections`. | A × P × B |
| 2 | **Cascata de autenticação/contexto** (~7–8 viagens só para o menu) | (a) Layout: juntar contagem de clientes, não lidos (usar `head: true`/`count`, não `select *`), permissões e créditos num `Promise.all`; (b) `requireClientDashboardAccess` e `authorize*Client` passarem a usar `requireAgencyContext` (já deduplicada); (c) avaliar trocar `getUser()` por `getClaims()` quando só a identidade é necessária (o `proxy` já valida a sessão; a autorização continua por RLS). | Menos 4–6 viagens por navegação e por atualização automática. | Contar consultas (log do PostgREST/`pg_stat_statements` `calls` por navegação) e TTFB do HTML. | A × M × M (mudança de segurança → revisar com testes de isolamento) |
| 3 | **Pacote de JS único para todas as telas da área de trabalho (643 KB gz)** | Em `dashboard-workspace.tsx`, trocar importações estáticas por `next/dynamic`/rotas separadas por seção (WhatsApp, Relatórios, Agendamentos, Modelos, Equipe); tirar os `demo-*` do pacote de produção (carregar só na rota `/demo`). | Cair de ~643 KB para ~150–250 KB gz nas telas Clientes/Integrações/Configurações; WhatsApp só paga o próprio peso. | `next build` → `route-bundle-stats.json` (script usado nesta análise); Lighthouse/LCP. | A × M × B |
| 4 | **Painel reconsulta a cada 60 s via Server Action pesada** | Espaçar para 5–10 min ou disparar só quando `coverage` indicar dado novo; usar apenas `catalogOnly` (sem RPC de métricas) no refresh de estado; pausar com aba oculta; deduplicar contexto (#2). | Reduz a maior fonte de tempo de banco (`get_client_analytics_hierarchy` + `get_client_analytics` ≈ 1.900 s acumulados). | `pg_stat_statements` (calls/total_time dessas funções) após a mudança. | A × P × B |
| 5 | **`get_client_analytics`/`hierarchy`/`warm` lentas (média 330–1.200 ms, picos 6–8 s)** | Rodar `EXPLAIN (ANALYZE, BUFFERS)` por fase (autorização, base, `enrich_dashboard_scope`); verificar leituras de JSON grande (`meta_dashboard_scopes`, `client_analytics_cache`) — guardar só o necessário em colunas ou separar `payload` pesado; índices nos filtros. | Média esperada < 150 ms; fim dos picos de segundos. | `pg_stat_statements` + plano de execução antes/depois. | A × G × M (exige autorização para investigar/migrar) |
| 6 | **Leads: 5.000 linhas agregadas em memória a cada 5 s** | Mover contagens para SQL (`group by` via RPC/view) e/ou cache de 5–10 s por cliente; polling adaptativo (5 s só com aba ativa, 15–30 s após inatividade); cuidar do alerta em tempo real já existente (webhook) como fonte principal. | Carga constante no banco cai ~10×; tela escala com o volume de leads. | Tempo de `GET /api/leads/clients/[id]` e `calls` em `pg_stat_statements`. | A × M × B |
| 7 | **Páginas com `await` em fila** (`workspace-page.tsx`, painel) | `Promise.all` para leituras independentes; mover as secundárias (relatórios, portfólio) para `<Suspense>`; no painel, fazer histórico de relatórios, header e Google em paralelo com a análise. | 30–60% menos tempo de renderização nessas telas. | TTFB e "tempo até conteúdo" das rotas; logs de duração. | A × P × B |
| 8 | **Layout lê `whatsapp_conversations` com `select("*")` limit 500 só para contar** | Trocar por `select("id", {count:"exact", head:true})` com os mesmos filtros (a rota `/api/whatsapp/inbox/unread` já faz isso). | Menos dados trafegados em toda navegação. | Tamanho da resposta; tempo do layout. | M × P × B |
| 9 | **WhatsApp: múltiplos laços de polling e `select *` de todas as conversas** | Unificar laços num único `fetch` de estado (caixa + listas + bloqueios + QR); selecionar só colunas usadas; filtrar "recentes" no banco (`last_message_at >=`); intervalo adaptativo. Considerar Supabase Realtime para não lidos. | Menos de 1/3 das requisições; menos custo de autenticação. | Requisições/min na aba Network; `calls` de `agency_users`. | M × M × M (mexer na fidelidade com WhatsApp exige cautela) |
| 10 | **Página de vendas (`/`) com 664 KB gz** | Revisar importações (`motion`, vídeo/WebM, componentes de demonstração); carregar demos sob demanda; `loading="lazy"` e dimensões nas imagens; `next/image`. | Melhor LCP para visitantes e anúncios. | Lighthouse/PageSpeed. | M × M × B |
| 11 | **`jspdf` importado estaticamente no painel** | `import()` dinâmico dentro das funções de exportação em `pdf-download.ts`. | ~100+ KB a menos no painel/portal. | `route-bundle-stats.json`. | M × P × B |
| 12 | **Índices e RLS** | Índices de leitura para FKs listadas em 2.4; `(select auth.uid())` em `member_permissions_read`; envolver `private.agency_role/can_open_whatsapp` em `(select …)`; unificar políticas duplicadas (3 tabelas). | Pouco hoje; protege contra degradação conforme as tabelas crescem. | Advisors e `EXPLAIN`. | M × M × M (migração: pedir autorização) |
| 13 | **CSS ~510 KB e CSS do WhatsApp nas telas que não o usam** | Consolidar os 12 arquivos "fidelity/correções" do WhatsApp; carregar só em `/whatsapp`; purgar regras mortas. | Menos bloqueio de renderização. | Tamanho em `.next/static/chunks/*.css`; Lighthouse. | M × G × M |
| 14 | **Retenção e limpeza** | Política para `billing_cron_runs`, `meta_daily_actions`, `audit_logs`; remover índices nunca usados após confirmar. | Evita crescimento; menos custo de escrita. | Tamanho das tabelas. | B × M × B |
| 15 | **`SELECT name FROM pg_timezone_names` (387 ms, 118×)** | Provavelmente validação de fuso por consulta; trocar por lista fixa/`Intl.supportedValuesOf('timeZone')`. | Elimina consulta lenta repetida. | `pg_stat_statements`. | B × P × B (origem exata não localizada) |
| 16 | **Observabilidade** | Medir Web Vitals reais (Vercel Speed Insights ou `reportWebVitals`) e registrar tempo por consulta/rota. | Passa a existir linha de base objetiva. | — | A × P × B |

---

## 4. Plano em etapas

**Etapa 1 — ganhos rápidos (baixo risco, dias):** #1 (cache/Suspense do Google), #4 (espaçar o refresh do painel), #7 (`Promise.all`), #8 (contagem sem `select *`), #11 (`jspdf` dinâmico), #15 e #16 (linha de base de medição). Meta: painel e telas de Clientes visivelmente mais rápidos sem tocar em regras de segurança.

**Etapa 2 — carga do navegador (baixo/médio risco):** #3 (dividir o pacote por seção e retirar demos), #10 (página de vendas), depois #13 (CSS). Meta: workspace ≤ ~250 KB gz por rota.

**Etapa 3 — caminho da requisição (médio risco, exige testes de isolamento multi-tenant):** #2 (unificar contexto/autenticação, paralelizar o layout), #6 (agregação de Leads no banco + polling adaptativo), #9 (WhatsApp).

**Etapa 4 — banco (precisa de autorização para migrações):** #5 (investigar e otimizar as funções de análise com `EXPLAIN`), #12 (índices/RLS), #14 (retenção).

**Etapa 5 — estrutural, só se ainda necessário:** ativar `cacheComponents`/`use cache` em dados compartilháveis por organização (catálogos, créditos), com invalidação por `revalidateTag`; avaliar Realtime em vez de polling; plano Pro da Vercel (limites de função e observabilidade) se a medição indicar função como gargalo.

Regra de ouro: antes de cada etapa, registrar a linha de base (TTFB, LCP, JS por rota, `calls`/`total_time` das funções) para provar o ganho.

---

## 5. O que não foi possível medir (e por quê)

- **Logs e métricas da Vercel** (tempo de função, cold start, região efetiva, Web Vitals): a conexão MCP retornou `teams: []`; sem acesso à equipe. A região foi inferida pela ausência de configuração.
- **Tempos reais por navegação** no navegador: não rodei sessão autenticada nem Lighthouse (o navegador embutido não hidrata em produção — ver memória do projeto — e não há dados reais de cliente em ambiente local).
- **Planos de execução** (`EXPLAIN ANALYZE`) das funções de análise e dos efeitos de RLS por linha: evitado para não executar consultas pesadas em produção; fica para a Etapa 4 com autorização.
- **Se o projeto usa chave de assinatura JWT assimétrica** (define se `getClaims()` no proxy é local ou de rede) e quanto tempo `getUser()` leva em média.
- **Peso real do CSS gzipado/duplicação de regras** e **uso real dos emojis (16 MB)** e das duas famílias de fonte.
- **`pg_stat_statements` é acumulado**: não distingue períodos de pico nem sabe de quando começou a contagem; as médias podem estar influenciadas por testes/cargas de homologação.
- **Ganhos esperados** são estimativas por raciocínio; nenhum foi implementado, publicado ou homologado.

## 6. Método

Leitura do código em `iGrow-Reports-credits` (`master` @ `3ed1373`), guias do Next 16.3.8 em `node_modules/next/dist/docs/` (diretiva `use cache`, `cacheComponents`), `next build` completo (compilou e gerou 47 páginas estáticas/dinâmicas sem erro), estatística de pacotes por rota com `route-bundle-stats.json` + gzip, e consultas **somente leitura** à Supabase (`get_advisors`, `pg_stat_user_tables`, `pg_stat_statements`, `pg_policies`, `list_extensions`, `get_project`). Nenhuma escrita, DDL ou migração.

## 7. Execução da Etapa 1 (06/11/2026)

Implementado e testado localmente; **publicação e homologação em uso real pendentes** (nada foi medido na Vercel).

| # | O que foi feito | Onde |
|---|---|---|
| 1 | Cache curto (5 min) das leituras do Google Ads, com chave por organização+cliente+período+contas, sem guardar resultado com falha e com compartilhamento da leitura em andamento; envio de relatório continua lendo "fresco". O Google passa a ser pedido **em paralelo** com a leitura da Meta. | `src/modules/google-ads/read-cache.ts`, `provider.ts`, `client-analytics-screen.tsx`, `automations/runner.ts` |
| 4 | Conferência de veiculação do painel a cada **3 min** (era 1 min) e, ao voltar para a aba, só se a última tiver mais de 1 min. | `analytics-dashboard.tsx` |
| 7 | No painel: histórico de relatórios e cabeçalho começam junto com a análise (antes esperavam em fila). No menu: contagens e créditos em paralelo. | `client-analytics-screen.tsx`, `(workspace)/layout.tsx` |
| 8 | Bolinha de não lidas do WhatsApp só **conta** (antes trazia até 500 linhas `select *` a cada navegação); função compartilhada com a rota `/api/whatsapp/inbox/unread`. | `whatsapp/unread-count.ts` |
| 11 | PDFs (jsPDF e layout dos relatórios) só são baixados quando a pessoa pede o PDF. | `reports/pdf-download-lazy.ts` |
| 15 | Origem localizada: gatilho `validate_agency` consultava a lista de fusos em **toda** atualização da organização. Agora só ao criar ou ao mudar o fuso. Migração `202611140001` aplicada (não reaplicar). | `supabase/migrations/202611140001_*.sql` |
| 16 | Medição real de velocidade (LCP, INP, CLS, TTFB, FCP) enviada a `/api/vitals` e registrada como linha `web-vital` nos logs da Vercel (sem dados pessoais; ids do endereço trocados por `:id`). | `components/layout/web-vitals.tsx`, `app/api/vitals/route.ts` |

**Medido no build local (JS inicial gzip, antes → depois):** `/` 664 → 527 KB; `/clientes` e demais telas da área de trabalho 643 → 507 KB; painel do cliente 387 → 252 KB; portal do cliente 371 → 236 KB; campanhas 330 → 333 KB; leads 217 → 220 KB (a medição de velocidade soma ~3 KB).

**Fora desta etapa (continua na lista):** dividir o pacote da área de trabalho por seção (#3), contagens de Leads no banco (#6), WhatsApp (#9), índices/RLS (#12) e investigação das funções de análise (#5).

## 8. Execução da Etapa 2 (06/11/2026)

Implementado e testado localmente (testes e build); **publicação e homologação em uso real pendentes**. A página de vendas não foi tratada de propósito: o problema relatado é a lentidão da **plataforma** (área logada).

| # | O que foi feito | Onde |
|---|---|---|
| 3 | Cada seção da área de trabalho (Clientes, Integrações, WhatsApp, Relatórios, Agendamentos, Entregas, Modelos, Equipe, Configurações) virou um pacote próprio carregado só quando aberta (`next/dynamic`). Os dados fictícios da caixa do WhatsApp da demonstração ficam num componente à parte, só usado em `/demo`. | `operations/dashboard-workspace.tsx`, `whatsapp/demo-inbox.tsx` |
| 3b | A lista de emojis (~290 KB) só é baixada quando alguém abre o seletor. | `whatsapp/inbox-view.tsx`, `custom-lists.tsx` |
| 3c | A biblioteca `motion` (~58 KB gz em toda tela) era usada só para um fade de 0,18 s: trocada por animação CSS (respeita "reduzir movimento"). | `layout/providers.tsx`, `dashboard-workspace.tsx`, `globals.css` |
| 13 | O CSS do WhatsApp (12 arquivos) é importado pela caixa, que agora é carregada sob demanda; as outras seções deixam de baixá-lo. | consequência de 3 |

**Medido no build local (JS inicial gzip), baseline do diagnóstico → Etapa 1 → Etapa 2:** Clientes, Integrações, WhatsApp, Relatórios, Agendamentos, Equipe, Configurações 643 → 507 → **225 KB** (−65%); painel do cliente 387 → 252 → **250 KB**; portal do cliente 371 → 236 → **236 KB**; campanhas 330 → 333 → **332 KB**; leads 217 → 220 → **220 KB**; demonstração → **217 KB**. A seção aberta carrega o próprio pacote além desses valores.

**Próximos maiores pesos no navegador:** campanhas (332 KB) e painel do cliente (250 KB). **Continua na lista:** consultas em paralelo/contexto de autenticação (#2), Leads no banco (#6), WhatsApp (#9), banco (#5, #12).

## 9. Execução da Etapa 3 (06/11/2026)

Implementado e testado localmente; **publicação e homologação em uso real pendentes**. Sem migração nesta etapa.

| # | O que foi feito | Onde |
|---|---|---|
| 2 | A sessão (`auth.getUser()`) e os espaços do usuário passam a ser confirmados **uma vez por requisição** (`cache` do React). Antes, o layout, a página e a verificação de acesso do cliente chamavam o Auth e o banco de novo (~100 ms cada). O acesso ao painel do cliente lê o cliente e os espaços **em paralelo**. A regra de acesso não mudou (continua exigindo ser membro da organização do cliente, ou ter acesso de cliente); novo teste cobre equipe, outra organização e sem acesso. Server Actions e rotas /api continuam confirmando a sessão a cada chamada (cada uma é uma requisição própria). | `agencies/context.ts`, `client-portal/context.ts`, `tests/client-dashboard-access.test.ts` |
| 7b | `workspace-page.tsx`: as ~10 leituras de cada seção (clientes, portal, Meta, relatórios, WhatsApp, destinatários, automações, equipe, modelos, Google, permissões, contagem) saem em um `Promise.all`; só as entregas esperam clientes e relatórios. | `operations/workspace-page.tsx` |
| 6 | Leads atualiza a cada **10 s** (era 5 s) e deixa de consultar quando a lista está escondida (outra aba de Leads por cima) ou a aba do navegador está oculta. O alerta instantâneo por WhatsApp não depende disso. | `lead-pages/leads-board.tsx`, `lead-feed-view.tsx` |
| 9 | A bolinha de não lidas do menu consulta a cada **30 s** (era 15 s); as etiquetas do WhatsApp só consultam com a aba visível. | `layout/app-shell.tsx`, `whatsapp/custom-lists.tsx` |

**Observações honestas:** (a) o projeto usa chaves de assinatura **assimétricas** (ES256, confirmado na lista pública de chaves), então o `getClaims()` do `proxy` é verificação local, barata. Trocar o `getUser()` do servidor por `getClaims()` economizaria mais ~100 ms por navegação, mas deixa de detectar sessão revogada/usuário banido até o token vencer (1 h) nas ações que usam a chave de serviço. **Não foi feito: é uma decisão de segurança do proprietário.** (b) As contagens de Leads em memória (até 5.000 linhas) só pesam com milhares de leads; hoje há dezenas. Fica para quando o volume crescer (função no banco). (c) `loadInbox` do WhatsApp lê todas as conversas e filtra no servidor; com ~100 conversas não pesa. Fica para quando o volume crescer.
