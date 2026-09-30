# Primeira publicação da iGrow

O código está preparado para configurar uma instalação na Vercel. Ainda não existe projeto remoto, banco configurado ou URL publicada. A entrega disponível inclui login, isolamento por agência, clientes, destinatários e registro de consentimento. Meta, geração de relatórios/PDF, QStash e envio WhatsApp continuam pendentes; publicar a fundação não ativa essas funcionalidades.

## 1. Criar as contas e o banco

Crie suas contas no [Supabase](https://supabase.com/dashboard) e na [Vercel](https://vercel.com/new). Guarde senhas e códigos de recuperação em seu gerenciador. Escolha os planos e a região conforme sua operação; o projeto não contrata serviços automaticamente.

No Supabase, crie um projeto dedicado à iGrow. No SQL Editor, execute os quatro arquivos de `supabase/migrations` na ordem dos nomes, uma única vez, confirmando sucesso em cada arquivo. Não execute os arquivos de testes no banco operacional. Para ambientes futuros, adote o fluxo de migrations com CLI descrito em BANCO.md.

Em Authentication, desative novos cadastros públicos. Provisione o primeiro usuário administrativo com email confirmado. Execute o bootstrap de [BANCO.md](BANCO.md#primeiro-proprietário) uma única vez com o email dessa conta. Isso cria a agência e associa o proprietário.

Copie a URL do projeto e a chave **publishable** do painel Supabase. A aplicação não precisa de chave `service_role` para seu CRUD.

## 2. Importar o código na Vercel

Crie um repositório privado no GitHub e envie este projeto, respeitando `.gitignore`. Não inclua `.env.local`, tokens ou senhas. Na Vercel, importe esse repositório como Next.js, com raiz nesta pasta e Node.js 24.x. Mantenha o gerenciador definido em `package.json` e a instalação pelo lockfile.

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
