# Lançamento da V1: checklist de produção (15/10/2026)

Nada abaixo foi executado em produção. Ordem recomendada; cada item exige a sua autorização.

## 1. Código
Publicar a branch `feat/checkout-contratacao` (commit, push, merge e deploy ficam com você). Inclui: checkout/ciclo de vida, restrições comerciais, monitoramento do cron, **teste gratuito no cadastro**, **seleção de plano sem pré-seleção enganosa**, **Google ao vivo sob a restrição financeira** e **suporte a produção do Asaas (desligado por padrão)**.

## 2. Migrations pendentes em produção
Produção está em `commercial_catalog_0140004`. Aplicar, uma por vez e na ordem, depois de um backup: `202610150001` a `202610150008` (fundação financeira, corrida de assinatura, vínculo do checkout, recuperação, ciclo de vida, vínculo de evento, monitor do cron, registros fictícios). Não reaplicar anteriores. Conferir a cada passo: registro em `schema_migrations`, funções só para `service_role`, contagens e hashes de assinaturas/direitos inalterados.

## 3. Configuração financeira no banco (antes de abrir ao público)
- `billing_settings.trial_plan_version_id`: definir o plano do teste gratuito de 7 dias (sem isto, organizações novas ficam sem plano e SEM limites). `trial_days = 7`, `past_due_grace_days = 7` (padrões).
- Publicar os planos reais e retirar/ocultar os planos de teste (TESTE-2.x) do catálogo de produção; conferir preços.
- `live_enabled = false` até o dia do GO financeiro; só então `true`.

## 4. Variáveis de ambiente (Vercel de produção)
`ASAAS_ENVIRONMENT=production`, `ASAAS_API_KEY` (chave `$aact_prod_…`), `ASAAS_PRODUCTION_UNLOCK=yes`, `ASAAS_WEBHOOK_TOKEN` (32+ caracteres, diferente da chave), `CRON_SECRET` (próprio de produção), além das variáveis já existentes. Sem as quatro primeiras juntas a integração fica inerte (por desenho). Nunca copiar segredos da homologação.

## 5. Asaas de produção
Conta aprovada e com cartão de crédito habilitado; cadastrar o webhook `https://<domínio>/api/webhooks/asaas` com o token acima (fila sequencial, eventos de cobrança, assinatura e checkout); conferir domínio autorizado para o checkout/retorno.

## 6. Cron financeiro (a cada 5 minutos)
Decisão: **QStash**, que o projeto já usa para o worker da Meta (independente de computador pessoal, com histórico e retentativas). Alternativa se não houver token de QStash em produção: o agendador do servidor de WhatsApp que já chama `/api/cron/report-automations`. Ativação: `scripts/billing-cron-schedule.mjs` (revisão sem argumentos; `--apply --confirm=<id>`), `Upstash-Method: GET`, segredo só em cabeçalho. Monitor: `/api/cron/billing/health` (200 saudável, 503 alerta) em um monitor externo a cada 10 minutos. Conferir o plano/franquia do QStash (≈ 288 mensagens/dia por ambiente).
**Validação operacional real:** feita em homologação em 15/10/2026 (cron executado, execução registrada em 1,9 s, saúde `ok`). Repetir em produção com 3 rodadas seguidas antes de abrir cobranças.

## 7. Domínio, dados, backup, rollback, monitoramento
- Domínio e HTTPS definitivos; `NEXT_PUBLIC_APP_URL` correto (URLs de retorno do checkout).
- Backup do banco (ponto de recuperação) imediatamente antes das migrations; guardar a lista de migrations aplicadas.
- Rollback: as migrations são incrementais e aditivas (nenhuma apaga dados); reverter = desligar `live_enabled`, remover o agendamento e voltar o deploy anterior na Vercel. Cobranças reais já criadas exigem decisão manual no Asaas.
- Monitoramento: `/api/cron/billing/health`, fila de eventos com `needs_review`, logs da Vercel (`billing-cron-failed`, `asaas-webhook-*`).
- Dados dos clientes finais, tokens de integração e credenciais seguem como estão (cifrados no banco).

## 8. Dia do GO financeiro (somente com sua ordem)
1. Webhook e cron saudáveis em produção; 2. `live_enabled = true`; 3. uma contratação real de baixo valor feita por você (cartão), conferindo ativação, direitos, webhook e `/health`; 4. liberar o público.

## 9. Fora do escopo da V1 (P1)
Histórico do Google durante a suspensão (hoje a leitura ao vivo do Google fica indisponível enquanto o acesso estiver restrito; limitação conhecida), upgrade/downgrade automáticos, Pix/boleto, painel financeiro avançado, verificação `Upstash-Signature`, polimento visual.

## 10. Planos da V1 e controles (16/10/2026)
SQL pronto, NÃO executado em produção: `scripts/sql/producao-configuracao-comercial.sql` (teste gratuito, Start, Pro recomendado, Scale, Personalizado privado). Validado em homologação em transação revertida.
| Limite | Controle efetivo |
|---|---|
| Clientes, contas de anúncio (Meta+Google), equipe (conta o proprietário e convites pendentes), números oficiais de WhatsApp, automações ativas, portal | gatilhos do banco (valem para app, API e jobs) |
| Orçamento de IA | `runGuardedGeneration` (teto do plano; sem configuração própria da organização vale o do plano) |
| WhatsApp por QR Code | UMA conexão por organização (instância fixa), **fora** do limite "WhatsApp"; o limite conta só números oficiais (API). Total possível = 1 QR + N oficiais |
Custo real de IA (produção, 10 chamadas): comentário de relatório ≈ US$ 0,022; resumo para WhatsApp ≈ US$ 0,017; resumo da carteira ≈ US$ 0,006. Recomendação (teto mensal; ≈ 10–16% do preço, com câmbio de R$ 5,50/US$): teste US$ 0,50; Start US$ 2; Pro US$ 4; Scale US$ 8. Uso típico estimado: Start ≈ US$ 1,3; Pro ≈ US$ 4 (se todas as automações usarem IA semanalmente); Scale ≈ US$ 11 no pior caso (automações diárias estouram o teto e a IA bloqueia, nunca gera custo acima do teto).
