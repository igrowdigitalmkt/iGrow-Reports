# Ativação da V1 em produção: Asaas, webhook, cron e sequência (16/10/2026)

Nada abaixo foi executado em produção. Nunca cole chaves ou tokens em conversa, arquivo versionado ou log. Domínio de produção confirmado: `https://i-grow-reports.vercel.app` (alias do projeto `i-grow-reports`, sem proteção de deployment). A produção atual (commit `6032545`) ainda NÃO tem `/api/webhooks/asaas` nem `/api/cron/billing/health` (404): chegam com o merge.

## 1. Variáveis do Asaas (Vercel, escopo Production)
| Variável | Valor | Observação |
|---|---|---|
| `ASAAS_ENVIRONMENT` | `production` | |
| `ASAAS_API_KEY` | chave `$aact_prod_…` da conta de produção | Asaas > Integrações > Chave de API. Marque como sensível |
| `ASAAS_WEBHOOK_TOKEN` | texto aleatório de 32+ caracteres, diferente da chave | gere localmente (abaixo) |
| `ASAAS_PRODUCTION_UNLOCK` | `yes` | **por último**, só quando for liberar cobrança |
Sem as quatro juntas a integração fica inerte (sem chamadas ao Asaas); `live_enabled=false` no banco também impede criar contratação em produção. As três primeiras podem ser definidas antes do merge sem efeito algum no código atual.
Como definir sem expor: no terminal do projeto, `pnpm dlx vercel env add ASAAS_ENVIRONMENT production`, depois `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` (a CLI pede o valor sem mostrar na tela; use `--sensitive`). Para gerar o token direto na área de transferência (PowerShell): `[Convert]::ToBase64String((1..36 | % { Get-Random -Maximum 256 }) -as [byte[]]) -replace '[+/=]','x' | Set-Clipboard`, cole no Vercel e depois no Asaas, e limpe a área de transferência. Variáveis novas só valem em deploys novos: faça um redeploy depois de definir.

## 2. Webhook (Asaas > Integrações > Webhooks > novo)
- URL: `https://i-grow-reports.vercel.app/api/webhooks/asaas` (só depois do merge/deploy; cadastrar antes gera 404 e interrompe a fila).
- Token de autenticação: o `ASAAS_WEBHOOK_TOKEN` (chega no cabeçalho `asaas-access-token`; o app recusa token ausente ou errado com 401 e confere sem vazar).
- API versão 3, **fila sequencial ligada**, e-mail de aviso à sua escolha.
- Eventos (os mesmos já homologados no Sandbox, 18): `PAYMENT_CREATED, PAYMENT_UPDATED, PAYMENT_CONFIRMED, PAYMENT_RECEIVED, PAYMENT_OVERDUE, PAYMENT_DELETED, PAYMENT_RESTORED, PAYMENT_REFUNDED, PAYMENT_CHARGEBACK_REQUESTED, PAYMENT_CREDIT_CARD_CAPTURE_REFUSED, SUBSCRIPTION_CREATED, SUBSCRIPTION_UPDATED, SUBSCRIPTION_DELETED, SUBSCRIPTION_INACTIVATED, CHECKOUT_CREATED, CHECKOUT_PAID, CHECKOUT_CANCELED, CHECKOUT_EXPIRED`.
- Comportamento já homologado: grava o evento antes de responder 200, processa lendo o estado real na API do Asaas (o evento só avisa), duplicados respondem 200 sem reprocessar, eventos perdidos ou fora de ordem são recuperados pela reconciliação do cron, ativação só com cobrança de cartão confirmada e valor igual. Não envie pagamentos de teste ao ambiente real.

## 3. Cron financeiro (QStash)
- Endpoint: `GET https://i-grow-reports.vercel.app/api/cron/billing` (autenticação `Bearer CRON_SECRET`, o mesmo segredo que já existe no projeto: **não troque** (o agendador do WhatsApp e os crons da Vercel o usam)). Saúde: `/api/cron/billing/health` (200 saudável, 503 alerta).
- Custo: a cada 5 minutos são 288 mensagens por dia; o plano gratuito divulgado permite 1.000 por dia (o limite é "suave"). A frequência mínima de agendamento não é informada na documentação pública: a criação do agendamento é o teste (se recusar `*/5`, usar `*/10`).
- Duplicidade e falhas: execuções simultâneas são seguras (reivindicação com trava no banco); retentativas (`2`), tempo limite e histórico em `private.billing_cron_runs`; falha vira 503 em `/health`.
- Na sua conta: criar conta gratuita em upstash.com (QStash) e copiar o `QSTASH_TOKEN`. Para ativar, no seu terminal (valores só no ambiente do comando): `BILLING_CRON_ORIGIN=https://i-grow-reports.vercel.app`, `BILLING_CRON_ENVIRONMENT=production`, `QSTASH_TOKEN`, `CRON_SECRET` (obtido com `pnpm dlx vercel env pull .env.prod.tmp --environment production`, usado com `node --env-file=.env.prod.tmp scripts/billing-cron-schedule.mjs`; apague o arquivo logo depois; `.env*` já é ignorado pelo Git). Revisar: rodar sem argumentos; ativar: `--apply --confirm=<scheduleId impresso>`. Não depende da VPS.

## 4. Migration 0010 (Super Admin comercial)
Estritamente aditiva (3 funções novas, sem alterar tabelas ou dados) e retrocompatível: o código atual de produção não as chama. Dependências já presentes em produção (verificado em leitura). **Aplicar ANTES do merge**, para que as novas páginas `/admin/comercial` e `/admin/assinaturas` já nasçam funcionando (sem ela mostram um aviso, sem quebrar).

## 5. Sequência definitiva (cada passo exige a sua ordem; o cadastro público só abre no ÚLTIMO)
1. **0010 em produção:** feito em 16/10/2026 (registrada, funções e permissões conferidas, organizações intactas).
2. Definir na Vercel `ASAAS_ENVIRONMENT`, `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` (sem `UNLOCK`).
3. Merge na `master` (deploy automático). Conferir: build READY, `/api/health` 200, `/api/cron/billing/health` 401 sem segredo, `/api/webhooks/asaas` 401 sem token, páginas existentes, `/admin/comercial` e `/admin/assinaturas` (com MFA), duas organizações legadas intactas. Cadastro fechado (sem planos). Rollback: promover o deploy anterior (banco só aditivo).
4. Cadastrar o webhook no Asaas de produção. Ativar o QStash e acompanhar 3 rodadas verdes em `/health`.
5. Executar `scripts/sql/producao-configuracao-comercial.sql`: **fecha o cadastro explicitamente** (revoga a permissão de criar organização) e publica Start, Pro, Scale, Personalizado e o plano de teste, sem ligar o teste. Resultado: planos visíveis só para organizações existentes; ninguém novo consegue se cadastrar.
6. `ASAAS_PRODUCTION_UNLOCK=yes` + redeploy; `live_enabled=true` (uma linha de SQL, sua ordem) e **uma contratação real de baixo valor feita por você** numa organização existente (Start mensal, R$ 79,90): conferir ativação, direitos, webhook processado e `/health`; opcionalmente testar o cancelamento. Repetir o anual se quiser (R$ 799,00).
7. **Abertura do cadastro** (só com a contratação validada): executar `scripts/sql/producao-abrir-cadastro.sql`. Numa única transação liga o teste gratuito de 7 dias e devolve a permissão de cadastro. A partir daí cadastros novos recebem teste e podem contratar.
Garantia: nunca existe janela com cadastro aberto sem contratação operacional, nem teste sem contratação validada. Para fechar de novo em emergência: `revoke execute on function public.create_own_agency(text, text) from authenticated;` (reversível com `grant`).
