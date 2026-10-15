# Homologação real do checkout (etapa 2.2B): procedimento

Status: **preparado, nada executado**. A migration `202610150003_billing_checkout_link.sql` existe só no repositório local (testada no PGlite). Nenhum projeto Vercel foi criado ou alterado, nenhum webhook ou cron externo foi configurado, e nada foi aplicado em banco algum nesta etapa.

## 0. Autorizações necessárias antes de começar (uma a uma)
1. Aplicar `202610150003_billing_checkout_link.sql` **somente** no Supabase `igrow-homologacao`.
2. Criar um projeto Vercel de testes e cadastrar as variáveis dele (seção 2).
3. Cadastrar o webhook no Sandbox do Asaas apontando para esse projeto de testes.
4. Fazer push da branch `feat/checkout-contratacao` para o GitHub (ver o aviso da seção 1).
5. Pagamentos de teste no Sandbox (o cartão fictício é digitado **por você** na página do Asaas; o assistente não digita dados de cartão em páginas externas).

## 1. O que foi verificado no projeto Vercel de produção (somente leitura, 15/10/2026)
- Projeto `i-grow-reports`, branch de produção `master`, integrado ao GitHub (`igrowdigitalmkt/iGrow-Reports`), Node 24.
- **Todas as 22 variáveis existem apenas no escopo Production.** Preview e Development não têm nenhuma. Ou seja: um deployment Preview desse projeto não herda as chaves de produção, **mas também não é um ambiente de testes** (não tem Supabase, Asaas nem nenhuma configuração). Ter uma URL diferente não o isola: o isolamento vem de quais variáveis existem.
- **Aviso:** como o repositório está ligado ao projeto de produção, um push da branch `feat/checkout-contratacao` cria um Preview *no projeto de produção* (sem variáveis; construção inútil, possível falha de build). Antes do push, decidir: (a) configurar no projeto de produção o "Ignored Build Step" para só construir `master`, ou (b) aceitar o Preview vazio. Nunca fazer merge em `master` sem autorização: `master` publica em produção.

## 2. Ambiente isolado: projeto Vercel SEPARADO (recomendado)
Criar o projeto `i-grow-reports-homolog` na mesma equipe, ligado ao mesmo repositório, com **Production Branch = `feat/checkout-contratacao`** (o deploy dessa branch é o "Production" do projeto de testes e usa as variáveis do próprio projeto de testes). Assim os dois projetos não compartilham nenhuma variável nem domínio.

Variáveis do projeto de testes (todas novas, valores NUNCA no chat, no Git ou em logs):
| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | do projeto **igrow-homologacao** (ref `xvjvfvinnnrgnhskglvd`) |
| `NEXT_PUBLIC_APP_URL` | endereço do projeto de testes (usado nas URLs de retorno do checkout) |
| `ASAAS_ENVIRONMENT` | `sandbox` |
| `ASAAS_API_KEY` | chave do **Sandbox** |
| `ASAAS_WEBHOOK_TOKEN` | token novo (32 a 255 caracteres), diferente da chave de API |
| `CRON_SECRET` | segredo novo, **diferente do de produção** |
| `ENCRYPTION_KEY`, `ENCRYPTION_KEY_ID` | chave nova de testes (nunca a de produção) |
| `ENABLE_DEMO` | `false` |
| `EXTERNAL_DELIVERIES_ENABLED` | `false` (nenhuma mensagem real é enviada) |
**Não definir** nada de Meta, Google, WhatsApp, Evolution nem Anthropic: sem integrações reais no ambiente de testes.

Configurações externas do ambiente de testes:
- **Supabase homologação (Authentication → URL Configuration):** incluir o endereço do projeto de testes em *Site URL* e *Redirect URLs* (login independente do de produção; usuários de teste próprios).
- **Proteção de deployment:** a "Vercel Authentication" bloqueia o webhook do Asaas (que não envia credencial da Vercel). Para o projeto de testes: desligar a proteção (a rota é protegida pelo token do webhook) **ou** manter a proteção e usar o bypass de automação da Vercel como parâmetro do endereço do webhook. Decidir e registrar.
- **Webhook no Sandbox do Asaas:** URL `https://<projeto-de-testes>/api/webhooks/asaas`; token = `ASAAS_WEBHOOK_TOKEN`; fila ativa; e-mail de aviso fictício; eventos: `CHECKOUT_*`, `SUBSCRIPTION_*`, `PAYMENT_*`; envio sequencial se existir a opção.

### Checklist de isolamento (todos os itens devem ser "sim" antes de qualquer pagamento)
1. `vercel env ls` do projeto de testes não mostra nenhuma variável com valor de produção; `NEXT_PUBLIC_SUPABASE_URL` aponta para `xvjvfvinnnrgnhskglvd`.
2. A página de login do projeto de testes contém o endereço do Supabase de homologação e **não** contém `qlopniyghvpbgwxuwxrl`.
3. `GET /api/health` do projeto de testes responde ok e `ASAAS_ENVIRONMENT=sandbox` (uma chave de produção é recusada pelo código).
4. O endereço do webhook cadastrado no Asaas é o do projeto de testes, nunca o de produção.
5. `CRON_SECRET` e token do webhook diferem dos de produção.
6. Os dois projetos Vercel não compartilham domínio nem variáveis.

## 3. Preparação do banco de homologação
- Aplicar `202610150003_billing_checkout_link.sql` (nome sugerido: `billing_checkout_link_0150003`). Conferir depois: funções `billing_list_offers`, `billing_intent_by_checkout`, `billing_close_intent`, `get_agency_billing` (novos campos) e permissões (ofertas: só `authenticated`; as demais: só `service_role`).
- Fixtures: o plano `TESTE-2.2 Plano pago` precisa estar **público e à venda** para aparecer na tela (`visibility='public'`); usuário de teste proprietário numa organização fictícia sem plano; um usuário administrador e um editor na mesma organização para os testes de permissão.
- A tela fica em `/dashboard/assinatura` (retorno do checkout em `/dashboard/assinatura/retorno`). Não há link de menu: acessar pelo endereço.

## 4. Roteiro de testes reais (marcar o resultado real de cada item)
Em todos: conferir a tela, os registros no banco (assinaturas, cobranças, eventos, auditoria) e o painel do Asaas Sandbox.
| # | Teste | Esperado |
|---|---|---|
| 1 | Proprietário, plano mensal, dados de cobrança válidos, cartão fictício aprovado (`4444 4444 4444 4444`, validade futura, CCV `123`) | redireciona ao Asaas; ao voltar, a tela diz "verificando"; webhook real chega; assinatura registrada **pendente**, depois **ativa** só após a cobrança confirmada lida na API; plano e limites da versão contratada liberados; auditoria completa |
| 2 | Idem, anual | uma cobrança integral (ex.: R$ 499,00), período de 12 meses, sem parcelamento |
| 3 | Cartão recusado (Mastercard `5184019740373151`, Visa `4916561358240741`) | a página do Asaas informa a recusa; nada é ativado; a tela segue "aguardando"; depois do prazo, "expirado" |
| 4 | Fechar o checkout sem pagar | idem; nova tentativa só após expirar (ou reabrir o mesmo link) |
| 5 | Checkout expirado | `CHECKOUT_EXPIRED` fecha a intenção; tela "expirado"; nova contratação permitida |
| 6 | Reenviar o mesmo webhook (painel do Asaas ou `curl` com o token) | `duplicate: true`; nada reprocessa |
| 7 | Evento fora de ordem (reenviar um antigo depois de um novo) | ignorado (`stale_snapshot`) |
| 8 | Duas abas / duplo clique / duas contratações simultâneas | uma só intenção, **um só checkout** no painel do Asaas |
| 9 | Falha temporária do webhook (token errado por alguns minutos, depois certo) | Asaas reenvia; nenhum evento perdido; processamento recuperado pela rotina |
| 10 | Timeout simulado na criação do checkout | "verificando a contratação", nenhum segundo checkout, reconciliação resolve |
| 11 | Administrador e editor | veem/não veem conforme as regras; não conseguem contratar nem pelo endereço direto |
| 12 | Outra organização | não enxerga nem altera a contratação |
| 13 | Organização antiga sem plano | segue sem restrição durante todos os testes |
| 14 | `CHECKOUT_PAID` sem a cobrança confirmada na API | não ativa; fica "verificando" |

**O que só estas execuções respondem (e que o código ainda trata como suposição segura):** valor real de `checkoutSession`/`externalReference` na assinatura nascida de um pagamento no checkout hospedado (o código exige que conferam quando presentes); se o checkout cria uma assinatura nova com o cliente informado ou outro; ordem e conteúdo dos webhooks reais; como o Asaas sinaliza o cartão recusado dentro do checkout; comportamento do cliente com dados já cadastrados.

## 5. Critérios de aprovação e parada
Aprovado somente se: nenhuma ativação sem cobrança confirmada lida na API; nenhuma cobrança duplicada; nenhum evento perdido; nenhuma ligação à organização errada; organização antiga intacta; nenhum segredo em logs. **Qualquer ambiguidade no vínculo checkout/assinatura/organização interrompe o teste e é reportada.**
