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
