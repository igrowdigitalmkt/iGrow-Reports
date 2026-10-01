# Validação operacional — 1º de outubro de 2026

Produção: https://i-grow-reports.vercel.app

## Causa e correções

- A primeira coleta estava desabilitada na interface até salvar um mapeamento manual de conversão. Gastos, impressões, cliques e ações agora podem ser coletados antes desse mapeamento.
- Sem Insights, o aviso informativo `multiple_timezones` podia ser apresentado como causa de bloqueio. O erro agora distingue `no_data` de incompatibilidade.
- Sincronização e coleta exigem um ID de portfólio empresarial confirmado pela Graph API. A coleta consulta os metadados atuais de cada conta, grava `business_id` e a origem do fuso, e impede uso de contas de outra conexão. A sincronização impede transferir silenciosamente uma conta de outro cliente.
- Migrations 013 e 014 aplicadas em produção. A constraint de portfólio obrigatório foi validada depois da confirmação das quatro contas.
- O health check já estava saudável ao iniciar esta investigação; não foi necessário trocar `SUPABASE_SECRET_KEY`. Valores sensíveis da Vercel não foram baixados nem expostos.

## Conexão e contas

O fluxo implementado usa um token fornecido pelo administrador, validado e criptografado por conexão de cliente. Não há fluxo OAuth Meta nem jobs automáticos de coleta implementados; a coleta é uma ação autenticada de proprietário, administrador ou editor.

Colégio Crescer: cliente `94e033bc-1fe7-4ddb-868d-e2f07b998dae`, conexão `ab844ff0-1aa9-49b3-ba2e-3311a1fa3053`. Permissões armazenadas incluem `ads_read` e `business_management`; a leitura real de metadados e Insights passou na Graph API v26.0.

As quatro contas pertencem ao portfólio `722750914816341` (Colégio Crescer):

| Conta | ID Meta | Fuso informado pela Meta | Registros no período |
|---|---|---|---:|
| CA - Anunciante Reforço | act_1295883480893120 | America/Sao_Paulo | 0 |
| Colégio Crescer | act_910504401812356 | America/Sao_Paulo | 2 |
| Escola Crescer | act_574027116669618 | America/Los_Angeles | 19 |
| Escola Crescer (Reserva) | act_649975104486500 | America/Sao_Paulo | 0 |

Consultas de 01/09 a 30/09/2026. A Meta retornou dados de 03/09 a 30/09. Contas/dias sem linhas retornadas não receberam métricas inventadas. Duas coletas completas mantiveram 21 registros, sem duplicação.

## Primeiro relatório real

`Colégio Crescer · Setembro 2026`, versão 1, ID `576975e4-00f4-4b99-811a-8783d289cfd6`, estado `ready` (pronto para publicar). Snapshot confirmado em `report_data_snapshots`:

- Investimento: R$ 3.565,16.
- Impressões: 504.865.
- Cliques no link: 9.568.
- Conversas iniciadas: 31.
- Custo por conversa: R$ 115,01.
- CTR de link: 1,89516%.

Resultado principal escolhido para a primeira versão: `conversations`, ação exata `onsite_conversion.messaging_conversation_started_7d`. A Meta também retornou 10 `complete_registration`; ações sobrepostas não foram somadas como conversões adicionais. Receita/ROAS permanecem nulos sem mapeamento de receita.

A diferença real de fuso gera aviso; a consolidação usa as mesmas datas no calendário local de cada conta, não uma janela UTC única. O relatório não foi publicado nem enviado a destinatários.

## Verificação

74 testes de código e 220 verificações SQL/RLS/pgTAP passaram. Typecheck, lint e build aprovados. O smoke test local de produção foi corrigido para aceitar a resposta 503 esperada no health check sem credenciais e continuou verificando demo desabilitada e autenticação obrigatória. Deploys realizados pela Vercel CLI; health e fluxo autenticado conferidos em produção.

Esta validação confirma coleta e snapshot reais. Não inclui comparação manual com o Ads Manager, PDF ou agendamento automático.
