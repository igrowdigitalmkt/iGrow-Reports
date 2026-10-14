# Super Admin — homologação da Etapa 1 (passo a passo)

Objetivo: testar o login, o MFA e o `/admin` de verdade **sem tocar na produção**. Usa um projeto Supabase separado e gratuito, que só tem a migration do Super Admin (o login do app funciona sem as demais; as funções de convite falham em silêncio, por desenho).

## 1. Criar o projeto de homologação
1. Entre em https://supabase.com/dashboard → **New project**.
2. Name: `igrow-homologacao`. Region: **South America (São Paulo)**. Plano gratuito.
3. Em *Database password* clique em **Generate a password** e guarde no seu gerenciador de senhas. Não envie a ninguém. Clique **Create new project** e aguarde.

## 2. Conferir o MFA
Menu **Authentication → Sign In / Providers** → seção **Multi-Factor Authentication**: TOTP deve estar com *Enroll* e *Verify* ativados. Se não estiver, ative e salve.

## 3. Instalar a estrutura do Super Admin
1. Menu **SQL Editor → New query**.
2. Abra o arquivo `supabase/migrations/202610140003_platform_admin.sql` do projeto, copie **todo** o conteúdo e cole na consulta.
3. Clique **Run**. Deve aparecer "Success. No rows returned". Use **somente** este arquivo; não rode os demais.

## 4. Criar duas contas de teste
Menu **Authentication → Users → Add user → Create new user**. Marque **Auto Confirm User** e crie:
- `operador-teste@exemplo.com` (será o operador) com uma senha forte;
- `usuario-teste@exemplo.com` (usuário comum) com outra senha.

## 5. Provisionar o primeiro proprietário (só no banco de homologação)
**SQL Editor → New query**, cole e clique **Run**:

```sql
select private.provision_platform_owner('operador-teste@exemplo.com');
```
O resultado é o identificador da conta. (Em produção o procedimento é igual, com o e-mail real do proprietário, e só depois de você autorizar.)

## 6. Apontar o app local para a homologação
Em **Project Settings → API Keys** copie a **Project URL** e a chave **publishable** (nunca a *secret*). No arquivo `.env.local` do projeto, adicione:

```
NEXT_PUBLIC_SUPABASE_URL=<Project URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<chave publishable>
```
Reinicie o app local (`pnpm dev`). Apague essas duas linhas quando terminar.

## 7. Roteiro de validação (no navegador, em http://localhost:3000)
| # | Faça | Resultado esperado |
|---|------|--------------------|
| 1 | Sem entrar, abra `/admin` | Vai para a tela de login |
| 2 | Entre com `usuario-teste` e abra `/admin` | Página "não encontrada" (404) |
| 3 | Saia; entre com `operador-teste` e abra `/admin` | Vai para `/admin/mfa` ("Ative a verificação em duas etapas") |
| 4 | Clique **Configurar autenticador**, leia o QR Code no app (Google Authenticator etc.), digite o código | Abre `/admin` com "Validada nesta sessão" e o evento "Autenticador cadastrado" |
| 5 | Em `/admin/mfa` cadastre um **segundo** autenticador (outro aparelho/app) | Evento "Autenticador cadastrado" de novo |
| 6 | Saia e entre de novo; abra `/admin` | Pede só o código; digitar um código errado mostra erro e registra "Código recusado" |
| 7 | Em `/admin`, após entrar, abra `/api/admin/session` | Mostra `{"role":"owner","mfa":true}` |
| 8 | Em janela anônima, abra `/api/admin/session` | `{"error":"unauthenticated"}` |

## 8. Verificação automática de segurança (opcional, recomendada)
Crie um arquivo `.env.homolog` (fora do Git) com: `HOMOLOG_SUPABASE_URL`, `HOMOLOG_SUPABASE_PUBLISHABLE_KEY`, `HOMOLOG_OPERATOR_EMAIL`, `HOMOLOG_OPERATOR_PASSWORD`, `HOMOLOG_USER_EMAIL`, `HOMOLOG_USER_PASSWORD`. Depois do passo 4 do roteiro, rode:

```bash
node --env-file=.env.homolog scripts/check-admin-homolog.mjs
```
Ele imprime só PASSOU/FALHOU. A verificação mais importante: operador **só com senha** não consegue cadastrar outro autenticador direto na API do Auth.

## Recuperação se perder todos os autenticadores
Não existe acesso alternativo (é proposital). Quem tem acesso ao painel do Supabase remove os fatores da conta: **Authentication → Users →** (três pontos da conta) **→ Remove MFA factors** (ou, no SQL Editor: `delete from auth.mfa_factors where user_id = '<id da conta>';`). Na próxima entrada o operador refaz o cadastro (passo 4). Por isso: cadastre sempre dois autenticadores.

## Desativar um operador
`select private.deactivate_platform_operator('<id da conta>');` (recusa desativar o último proprietário ativo). Efeito imediato.
