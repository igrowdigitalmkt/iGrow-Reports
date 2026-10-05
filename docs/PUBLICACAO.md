# Publicação da iGrow

## Verificação de produção em 4 de outubro de 2026

O deploy `BUzyYMkWDMAtCFg66GKZUd3554sK`, commit `c0e7b46`, foi confirmado na Vercel como Ready / Production / Current, no domínio `i-grow-reports.vercel.app`, com publicação às 21h57 GMT-3. Isso confirma o código publicado até aquela revisão, incluindo a correção do bloqueio de carregamento do painel original. Não significa que todos os fluxos novos estejam operacionais.

No projeto Supabase existente, as funções `list_client_snapshot_accounts` e `request_meta_collection_refresh` não estavam disponíveis no catálogo público, e a tela de migrations não apresentava histórico CLI. A análise por snapshots depende de atualização do banco antes de funcionar. Consultar [OPERACAO.md](OPERACAO.md) e executar o diagnóstico somente de leitura antes de definir as migrations pendentes. Nenhuma migration remota foi aplicada nesta verificação. O histórico de instalação abaixo permanece como referência, não como lista atual completa de migrations.

## Estado atual do ambiente

A infraestrutura principal já foi provisionada em 30/09/2026:

- Supabase do iGrow Reports criado e conectado;
- usuário administrativo inicial criado e vinculado como proprietário da iGrow Digital;
- repositório privado correto: `igrowdigitalmkt/iGrow-Reports`;
- projeto Vercel `i-grow-reports` conectado ao repositório correto;
- variáveis de produção do Supabase/Vercel configuradas;
- branch de produção: `master`.

**Não recrie contas, não repita o bootstrap do primeiro proprietário e não execute novamente as migrations já aplicadas.**

As quatro migrations originais foram usadas na instalação inicial. A atualização que tornou a **Área do Cliente um componente central da V1** acrescenta a quinta migration:

`supabase/migrations/202609300005_client_portal_foundation.sql`

Essa migration deve ser aplicada no projeto Supabase existente **antes do primeiro deploy que contenha as rotas da Área do Cliente**.

Meta, geração de relatórios/PDF, QStash e envio WhatsApp continuam pendentes; publicar esta atualização não ativa essas funcionalidades.

## 1. Atualizar o banco existente

No SQL Editor do Supabase do iGrow Reports, execute somente a migration nova `202609300005_client_portal_foundation.sql`, uma única vez, confirmando sucesso antes de publicar o commit correspondente. Não execute os arquivos de teste no banco operacional.

Para um ambiente novo criado do zero, aplique todas as migrations em `supabase/migrations` na ordem dos nomes. Para evolução contínua, adote o fluxo de migrations com CLI descrito em BANCO.md.

## 2. GitHub e Vercel

O repositório e a Vercel já estão conectados. Um push para `master` dispara as verificações do GitHub e o fluxo de deploy configurado na Vercel. Não inclua `.env.local`, tokens ou senhas no Git.

Na Vercel, mantenha Next.js, Node.js 24.x, o gerenciador definido em `package.json` e a instalação pelo lockfile.

Para usar a versão de pnpm declarada pelo projeto, habilite `ENABLE_EXPERIMENTAL_COREPACK=1` no ambiente de build, conforme a [documentação de gerenciadores da Vercel](https://vercel.com/docs/package-managers). Não substitua a instalação por uma versão arbitrária de pnpm.

Configure estas variáveis no ambiente Production antes de implantar:

| Variável | Valor |
| --- | --- |
| `APP_ENV` | `production` |
| `NEXT_PUBLIC_APP_URL` | Origem HTTPS definitiva da aplicação, sem caminho |
| `NEXT_PUBLIC_SUPABASE_URL` | URL HTTPS do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave publishable do projeto |
| `ENABLE_DEMO` | `false` |
| `EXTERNAL_DELIVERIES_ENABLED` | `false` |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` |

Use o domínio atribuído ao projeto pela Vercel; domínio próprio pode ser configurado depois. `vercel.json` executa `pnpm check:deploy` antes do build e rejeita configuração incompleta. O validador não verifica se a chave pertence ao banco, se as migrations foram aplicadas ou se o serviço está disponível. Alterações de variáveis `NEXT_PUBLIC_` exigem novo build.

Preview deve usar outro projeto Supabase e `APP_ENV=staging`, com sua própria URL e variáveis. A ausência dessa configuração bloqueia o build de Preview intencionalmente.

Para a atualização atual, não altere as variáveis de produção já configuradas salvo se uma verificação concreta indicar necessidade.

## 3. Configurar autenticação

Em Supabase Authentication > URL Configuration, defina Site URL como a origem HTTPS publicada. Cadastre os redirects usados pela aplicação (`/auth/callback`, `/auth/confirmar` e `/auth/definir-senha`) nessa origem. Use URLs exatas em produção. Consulte o [guia de redirects](https://supabase.com/docs/guides/auth/redirect-urls).

Antes de depender de convite ou recuperação por email, configure SMTP e os templates correspondentes ao fluxo da aplicação. O login por senha da conta provisionada deve ser homologado primeiro. A interface de emissão de convites e gestão de equipe ainda está pendente; as RPCs constam em BANCO.md.

Nos templates de email do Supabase, use os links abaixo, compatíveis com `/auth/confirmar`. `SiteURL` deve ser a origem HTTPS definida acima. Não use dados reais de tokens no código ou na documentação.

```html
<!-- Invite user -->
<a href="{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&amp;type=invite">Definir minha senha</a>
<!-- Reset password -->
<a href="{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&amp;type=recovery">Redefinir minha senha</a>
```

Confirme entrega e uso único dos links em homologação. O aplicativo ainda não possui formulário para solicitar recuperação; a operação administrativa precisa iniciar esse fluxo.

## 4. Homologar antes de liberar

- Abrir `/entrar`, entrar com o proprietário e confirmar a agência correta.
- Criar, editar, arquivar e reativar um cliente; sair e entrar para confirmar persistência.
- Cadastrar destinatário e registrar/revogar consentimento com evidência autorizada.
- Verificar duas agências com contas distintas pelas APIs reais; uma não pode consultar nem alterar a outra.
- Conferir que leitor não grava e editor não administra proprietários.
- Confirmar logout, acesso anônimo protegido e `/demo` retornando 404.
- Registrar URL, revisão publicada e migrations aplicadas; definir backup e testar restauração antes de armazenar dados operacionais relevantes.

`/api/health` confirma somente que o servidor responde. Não é teste de banco ou autorização. Os testes locais de PostgreSQL usam estruturas mínimas de Auth/Storage; a validação no Supabase real continua necessária.

O workflow `.github/workflows/quality.yml` executa lint, tipos, testes unitários, SQL/RLS, build, proteção de produção e testes de navegador após o código chegar ao GitHub. Configure verificações obrigatórias no repositório antes de promover alterações; o arquivo sozinho não cria proteção de branch nem bloqueia o deploy automático da Vercel.
