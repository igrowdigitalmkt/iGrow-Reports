# Migração para Groow Ads e groowads.com (17/10/2026)

Nome definitivo: **Groow Ads**. Domínio principal: `https://groowads.com` (também `www.groowads.com`). `groowads.com.br`: anexado ao projeto na Vercel, mas **ainda não existe no DNS** (pendente de ativação no registrador); quando ativo, configurar o redirecionamento permanente para `groowads.com`.

## O que mudou
- **Código/marca:** textos visíveis, metadados, PDF, termos e e-mails dizem "Groow Ads"; "iGrow Digital" segue como empresa. Identificadores internos (cookies `igrow-auth`, chaves de cache) foram preservados de propósito.
- **Vercel:** domínios anexados, `NEXT_PUBLIC_APP_URL=https://groowads.com`; `vercel.json` redireciona (308) as **páginas** do domínio antigo para o novo e deixa `/api/*` do antigo funcionando (legado; pode ser desligado depois).
- **DNS (Wix):** apex com A `216.150.1.1` e `216.150.16.1`, `www` com CNAME da Vercel; registros do Resend (DKIM, `send`, `rsend`, DMARC) preservados.
- **Supabase Auth:** Site URL `https://groowads.com`; redirect `https://groowads.com/**` adicionado (antigos mantidos). SMTP próprio: `Groow Ads <notificacoes@groowads.com>` (Resend); modelos em português com links `/auth/confirmar` (sem dependência de cookie).
- **Asaas:** webhook em `https://groowads.com/api/webhooks/asaas`; credenciais no Vault intactas.
- **QStash:** agendamento `igrow-billing-production-c21c4ff3b693` -> `https://groowads.com/api/cron/billing`; o antigo foi removido.
- **Google:** URI de redirecionamento `https://groowads.com/api/google/oauth/callback` adicionada.
- **Meta:** apps "iGrow Digital" (login Meta Ads) e "iGrow Reports" (WhatsApp): `https://groowads.com/` nos domínios do SDK do JavaScript; privacidade e exclusão de dados em `groowads.com`; callback do webhook do WhatsApp `https://groowads.com/api/webhooks/meta/whatsapp` (token de verificação novo, só na Vercel).
- **VPS do WhatsApp:** `/opt/igrow/run-automations.sh` e `/opt/evolution/enable-contact-name-events.py` usam `groowads.com` (cópias `.bak-groowads` na VPS). Sessão QR de teste desconectada e refeita: o webhook da instância nasce em `https://groowads.com/api/webhooks/evolution`.

## Pendências
- `groowads.com.br` (DNS/registro) e seu redirecionamento.
- Verificar o e-mail de contato do domínio na Wix até 31/10/2026.
- Trocar o `CRON_SECRET` (apareceu em tela durante a operação): Vercel + `/opt/igrow/cron.env` + cabeçalho do QStash.
- Sessões de login são por domínio: todos entram de novo uma vez em `groowads.com`.
