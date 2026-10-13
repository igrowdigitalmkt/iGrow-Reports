# Multiplataforma (Meta, Google, TikTok, LinkedIn)

Decisão do responsável (13/10/2026): a primeira versão deve apresentar mais de uma plataforma de anúncios. Esta decisão **substitui** a frase do planejamento V1 que deixava Google e TikTok de fora.

## Regras de apresentação (aprovadas)
- Hierarquia: **plataforma → conta de anúncios**. Cada plataforma é uma seção; dentro dela, uma conta por bloco. Contas separadas por padrão; "Consolidar resultados" soma as contas **da mesma plataforma**.
- Entre plataformas só se somam investimento, cliques e impressões (consolidado do topo). Resultados e custo por resultado de plataformas diferentes **nunca** são somados nem comparados.
- Dashboard: um bloco por plataforma (cabeçalho com nome, contas, qualidade dos dados e filtro de contas). PDF: um arquivo, cada plataforma e conta com a sua capa, em sequência. WhatsApp: título por plataforma quando houver mais de uma; análise da IA por conta.
- YouTube Ads vem pela conta do Google Ads e fica dentro da seção Google Ads.

## O que já está pronto no código
- `src/modules/platforms/registry.ts`: plataformas, nome, cor e se o conector existe (`available`). Só a Meta está disponível; as demais aparecem como "Em breve" no seletor de plataformas.
- `src/modules/platforms/provider.ts`: contrato de um conector (`AdPlatformProvider`). Cada conector entrega, por conta, os números no mesmo formato da Meta (`AnalyticsDashboardData`); o resto (PDF, mensagem, IA, painel) já funciona com esse formato.
- PDF: `platformLabel` e cor por seção (capa e "Dados fornecidos pela …"); `buildPeriodPdfV2` aceita contas de várias plataformas. Mensagem: `AccountBlock.platform` cria o título de cada plataforma.

## O que falta por plataforma (conector)
1. Acesso à API (depende de aprovação externa; confirmar prazos nos portais):
   - **Google Ads:** conta de gerente (MCC), token de desenvolvedor aprovado pelo Google, projeto no Google Cloud com OAuth.
   - **TikTok Ads:** app no TikTok for Business (Marketing API) aprovado.
   - **LinkedIn Ads:** aplicação no LinkedIn Developer com acesso à Marketing/Advertising API aprovado.
2. Banco: tabelas de conexão, contas, coleta diária por conta e agregados (hoje só existem as da Meta: `meta_*`). Cada plataforma ganha as suas, mais uma visão comum de contas por cliente.
3. Coleta e normalização: mapear métricas e tipos de resultado da plataforma para o formato comum, com janelas de revisão próprias.
4. Dashboard: seção da plataforma (hoje só a Meta é desenhada) e tela de conexão em Integrações.
5. Agendamentos: o executor passa a montar as seções a partir de todos os conectores ativos do cliente (hoje lê só a Meta).

## Pedidos que o responsável pode iniciar já (demoram)
Token de desenvolvedor do Google Ads, app do TikTok for Business e aplicação do LinkedIn Marketing. Sem essas aprovações não há como testar os conectores com dados reais.

## Google Ads — estado (13/10/2026)
Código pronto e testado com respostas simuladas da API; **não validado com dados reais** (depende do token de desenvolvedor aprovado e do aplicativo OAuth).
- **Migração `202610140001_google_ads_foundation` aplicada em produção (NÃO reaplicar):** `google_connections`, `google_ad_accounts`, `client_google_accounts` (RLS; escrita de contas só pelo servidor; vínculo com cliente por dono/admin/editor). O token de renovação fica cifrado em `private.integration_secrets` (integração `google`).
- **Variáveis de ambiente (Vercel):** `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `NEXT_PUBLIC_APP_URL`; opcional `GOOGLE_ADS_API_VERSION` (padrão v21; conferir a versão vigente da API). Endereço de retorno a cadastrar no Google Cloud: `<NEXT_PUBLIC_APP_URL>/api/google/oauth/callback`. Escopo: `https://www.googleapis.com/auth/adwords`.
- **Fluxo:** Integrações → Google Ads → "Conectar com o Google" (dono/admin) → informar o número da conta de gerente (MCC) → "Buscar contas" → marcar quais clientes usam cada conta.
- **Dados:** lidos da API no momento (sem cópia no banco): `src/modules/google-ads/{client,queries,normalize,provider,server}.ts`. Cada conta vira `AnalyticsDashboardData` (cobertura completa e confirmada pelo próprio agregado do período). Resultados: **Conversões** (campanhas que não são de vídeo) e **Visualizações de vídeo** (campanhas de vídeo/YouTube), cada tipo com o próprio custo. Sem alcance/frequência (a API não entrega por pessoa).
- **Onde aparece:** seção "Google Ads" no painel do cliente; PDF único (Meta, depois cada conta do Google, cada uma com capa e cor próprias); mensagem de WhatsApp com título por plataforma e análise da IA por conta; PDF agendado do número oficial (layout Novo).
- **Limitações conhecidas:** sem saldo/pagamento do Google na mensagem e no PDF; sem anúncios (melhores/piores) do Google; "Consolidar resultados" vale só para a Meta (cada conta do Google é sempre um bloco); cliente só com Google (sem Meta) ainda não abre o painel; o resultado "Conversões" soma todas as conversões configuradas na conta (não separa por tipo de conversão).
