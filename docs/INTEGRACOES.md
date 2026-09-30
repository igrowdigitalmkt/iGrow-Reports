# Integrações e configuração

Nesta fundação, somente o acesso via Supabase Auth e banco possui implementação. Ele depende de um projeto Supabase configurado e da migração aplicada. Meta Marketing API, WhatsApp Cloud API e QStash são integrações futuras; nenhum indicador demonstrativo comprova uma conexão.

## Supabase

Use projetos separados para homologação e produção. Copie `.env.example` para `.env.local`, preencha as variáveis abaixo e reinicie o servidor.

| Variável | Uso neste incremento |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave `sb_publishable_…` ou JWT `anon` legado |
| `ENABLE_DEMO` | `true` habilita `/demo`; ausente usa ambiente de execução |

A chave pública é adequada para uso no navegador quando RLS e permissões estão corretamente configurados. A validação local rejeita chaves privilegiadas no campo público. A aplicação usa o contexto autenticado, sem chave `service_role` para o CRUD. Chaves privilegiadas nunca recebem o prefixo `NEXT_PUBLIC_`.

Siga [BANCO.md](BANCO.md) para migration, bootstrap controlado do primeiro proprietário e testes. Não habilite cadastro público irrestrito para contornar o procedimento. Nenhuma nova agência é criada automaticamente pelo login. O bootstrap usa `private.bootstrap_agency` em uma sessão de operador; a aplicação não recebe essa permissão.

O usuário inicial precisa existir e ter email confirmado no Supabase Auth antes de ser vinculado à agência. Convites de agência usam tokens de uso único, armazenados somente como hash. A emissão de uma conta pelo Supabase Auth e a emissão de um convite de agência não são equivalentes; o procedimento completo está em [BANCO.md](BANCO.md).

Configure `Site URL` e a lista permitida de redirecionamentos no Supabase para cada ambiente. O callback PKCE da aplicação é `/auth/callback`. Para convites Auth enviados pelo operador, o template precisa usar:

```text
{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=invite
```

Para recuperação, use a mesma rota com `type=recovery`. Após validar o link, a aplicação abre `/auth/definir-senha`, com senha mínima de 12 caracteres. O formulário de solicitação de recuperação e o envio de emails pela aplicação ainda não foram implementados. Não use o template padrão de fluxo implicit sem adaptar o retorno para a implementação SSR.

Depois de provisionar a conta Auth, um proprietário ou administrador pode emitir um convite de agência pela RPC documentada em [BANCO.md](BANCO.md). O usuário acessa `/convite?token=<token>` e confirma o aceite. A emissão não envia email ou WhatsApp automaticamente; só compartilhe links com os destinatários autorizados. Nenhum desses fluxos foi homologado contra um projeto remoto nesta entrega.

A aplicação usa `@supabase/ssr` para manter a sessão em cookies. A implantação precisa preservar os cookies de resposta e usar HTTPS. Consulte o [guia oficial de clientes SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs) ao alterar essa fronteira.

## Meta Marketing API — futura

Antes de implementar, identificar o aplicativo Meta, as contas autorizadas, o modelo de acesso e as permissões necessárias. Validar a versão da Graph API na documentação oficial naquele momento. Não há versão nem credencial operacional configurada nesta entrega.

A adaptação deve ser de leitura e tratar paginação, timeout, limites de uso, erros permanentes e temporários, consultas assíncronas e sanitização dos payloads. A integração só poderá ser declarada funcional depois de uma consulta a conta real autorizada e conferência dos parâmetros com o Ads Manager. Conexão cadastrada e saúde observada serão estados distintos.

## WhatsApp Cloud API — futura

Usar exclusivamente a API oficial. Serão necessários aplicativo, WABA, número, credenciais e template autorizado para a finalidade escolhida. Nenhuma mensagem é enviada pela demonstração ou pela fundação.

Implementar autorização do destinatário e descadastro, validação de assinatura do webhook, deduplicação e processamento de eventos fora de ordem. Distinguir solicitação aceita, mensagem enviada, entregue, lida, falha confirmada e resultado incerto. Um timeout não autoriza reenvio cego.

## QStash — futuro

Ainda não há publicação de jobs, agendamentos externos ou endpoints de consumo. Na etapa de automação, configurar token e chaves de assinatura atual/próxima somente no servidor. Verificar assinaturas antes de processar cada callback, conforme a [documentação oficial do QStash](https://upstash.com/docs/qstash/howto/signature).

Implementar ocorrências persistidas, outbox, tentativas, locks com expiração, checkpoints e chaves únicas. A entrega repetida da fila precisa ser segura para operações locais; efeitos externos incertos exigem reconciliação específica. Não manter um worker permanente dentro de uma Function.

## Credenciais futuras

Os campos `SUPABASE_SERVICE_ROLE_KEY`, `META_*`, `QSTASH_*`, `ENCRYPTION_*`, `SENTRY_DSN` e `EXTERNAL_DELIVERIES_ENABLED` estão reservados em `.env.example`; não são consumidos pela fundação e não ativam provedores por si. `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_REPORTS_URL` e `APP_ENV` também registram a configuração planejada dos ambientes, sem substituir a configuração Auth no Supabase.

Na implementação de cada adaptador, documentar configuração, escopo, validação e rotação reais. Segredos de agência precisarão ficar em schema privado com criptografia AES-256-GCM, nonce exclusivo e identificação de chave; esse armazenamento ainda não faz parte da fundação.
