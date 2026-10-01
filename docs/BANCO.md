# Banco e autorização da fundação

Atualização: a quarta migration acrescenta destinatários e histórico de consentimento; a quinta cria a fundação autenticada da Área do Cliente. Consulte [DESTINATARIOS.md](DESTINATARIOS.md) e [AREA_CLIENTE.md](AREA_CLIENTE.md). O executor agora aplica cinco migrations e roda 146 verificações pgTAP (90 da fundação/clientes, 30 de destinatários e 26 da Área do Cliente).

As migrations SQL são a fonte do schema. Esta entrega contém agências, equipe, convites, base de clientes, auditoria e Storage privado. As tabelas de integrações, relatórios, entregas e jobs entrarão com seus respectivos módulos. Não há seed de clientes reais nem fixtures de demonstração no banco da aplicação.

## Verificação executada

Em 30/09/2026, `node supabase/tests/rls-smoke.mjs` aplicou as cinco migrations em uma instância descartável de PostgreSQL WASM/PGlite e executou **146 verificações pgTAP, todas aprovadas**. O mesmo fluxo é exposto pelo script `pnpm test:db` quando o pnpm está disponível.

O executor usa o SQL real das migrations e das suítes `foundation.test.sql`, `recipients.test.sql` e `client-portal.test.sql`. Somente as estruturas pertencentes ao Supabase (`auth.users`, `auth.uid()`, `storage.buckets`, `storage.objects`) são representadas por estruturas mínimas de teste. A suíte executa com os papéis `anon` e `authenticated`; seus dados fictícios são revertidos ao terminar.

Isso verifica políticas, grants, funções e restrições SQL. Ainda não confirma os serviços HTTP Auth/PostgREST/Storage, upload de arquivos, JWTs reais, refresh de sessão, envio de convites por email nem concorrência entre conexões. Docker e Supabase CLI não estavam disponíveis nesta execução. A homologação em Supabase local ou staging continua pendente.

## Ambiente Supabase local

Com Docker em execução e Supabase CLI instalado, execute na raiz do projeto:

```powershell
supabase start
supabase migration up --local
supabase test db
```

`supabase/config.toml` define PostgreSQL 17, portas locais e cadastro público desativado. O schema `private` não está exposto pela API. Preencha `.env.local` com URL e chave pública do ambiente local, conforme `.env.example`. Use os valores mostrados por `supabase status`; não publique chaves privilegiadas.

Os testes SQL são transacionais e não deixam fixtures. `supabase db reset` não faz parte do procedimento normal: ele recria o banco local e remove os dados existentes. Para staging, aplique as migrations pelo procedimento do ambiente e confira o alvo antes de qualquer comando; esta entrega não provisionou nem alterou projetos remotos.

O fluxo de teste segue a documentação de [testes de banco do Supabase](https://supabase.com/docs/guides/database/testing). A validação remota precisa usar contas de teste de duas agências e repetir os acessos permitidos e negados através das APIs reais.

## Primeiro proprietário

1. No Supabase Auth do ambiente escolhido, crie a conta do proprietário pelo procedimento administrativo controlado. A conta deve ter email confirmado; não existe cadastro público de agências.
2. No SQL Editor, como operador do banco, execute a função privada abaixo substituindo o email pelo da conta já provisionada.

```sql
select private.bootstrap_agency(
  'proprietario@example.test',
  'iGrow Digital',
  'America/Sao_Paulo'
);
```

3. Guarde o UUID retornado como identificação da agência e entre em `/entrar` com essa conta.

O bootstrap cria agência, associação `owner` e evento de auditoria na mesma transação. É permitido somente ao operador: `anon`, `authenticated` e `service_role` não podem executar essa função. O email de exemplo é fictício. Reexecutar o bootstrap cria outra agência; o procedimento não deve ser usado como tentativa de reparar login.

## Convites e gestão da equipe

Criar uma conta no Supabase Auth e associá-la à agência são operações separadas. O administrador deve provisionar a conta Auth pelo processo autorizado e, com sua própria sessão de usuário na aplicação, emitir o convite de agência. A interface para emitir convites e administrar equipe ainda não está implementada; as RPCs já têm autorização e testes.

Exemplo de chamada pelo cliente Supabase autenticado do servidor:

```typescript
const { data, error } = await supabase.rpc("issue_agency_invitation", {
  p_agency_id: agencyId,
  p_email: recipientEmail,
  p_role: "editor",
  p_expires_in_hours: 72,
});
```

A RPC retorna `invitation_id`, `token` e `expires_at`. O link para o destinatário é `/convite?token=<token>`. A emissão não envia email ou WhatsApp automaticamente; o operador compartilha o link apenas pelo canal autorizado. O token é mostrado somente na emissão; não deve entrar em logs ou auditoria. A tabela armazena seu hash SHA-256 e não permite que `authenticated` leia essa coluna.

O aceite exige sessão Auth, email confirmado correspondente, convite não expirado, não revogado e ainda não consumido. O emissor precisa continuar com permissão para aquele convite. A validade padrão é 72 horas, limitada a 1–168 horas. Reemitir para o mesmo email revoga o convite pendente anterior. Membros existentes conservam seu papel ao aceitar um convite, evitando promoção por link antigo. O aceite e o registro de consumo são transacionais.

| RPC | Autorização e efeito |
| --- | --- |
| `issue_agency_invitation` | Proprietário/administrador da agência; somente proprietário pode convidar outro proprietário |
| `accept_agency_invitation` | Usuário confirmado do email convidado; cria associação e consome o token |
| `revoke_agency_invitation` | Proprietário/administrador; administrador não revoga convites de proprietário |
| `set_agency_member_role` | Proprietário/administrador; administrador não promove a proprietário nem altera um proprietário |
| `remove_agency_member` | Proprietário/administrador, preservando ao menos um proprietário |

Alterações na equipe adquirem bloqueio na agência. O trigger de associação atualiza a mesma linha da agência para serializar mudanças de proprietário e rejeitar operações que deixariam a agência sem proprietário. A proteção sequencial foi testada; é necessário homologar transações simultâneas em PostgreSQL/Supabase com múltiplas conexões.

## Área do Cliente

`client_users` representa acesso do cliente final e não participação na equipe da agência. O vínculo é composto por agência, cliente e usuário Auth, possui estado ativo/inativo e não concede nenhum papel de `agency_users`.

Usuários da Área do Cliente não recebem `SELECT` direto sobre `clients` nem `client_users`. A função `list_client_portal_clients()` retorna somente `id`, `agency_id`, `name`, `logo_path` e `archived_at` dos vínculos ativos do usuário atual, evitando exposição de notas, autoria e outros campos administrativos. O helper `private.has_client_access` fica disponível para as futuras políticas de métricas e relatórios. A RPC `set_client_user_access` exige proprietário ou administrador, rejeita referências entre agências e contas não confirmadas ao conceder acesso, preserva a linha ao revogar e registra auditoria.

As futuras tabelas de métricas, relatórios e snapshots destinadas à Área do Cliente deverão reutilizar esse vínculo ou outra relação inequívoca com `client_id`, mantendo autorização próxima à fonte de dados. Consulte [AREA_CLIENTE.md](AREA_CLIENTE.md).

## Permissões e relacionamentos

As tabelas `agencies`, `agency_users`, `agency_invitations`, `clients`, `client_users`, `client_recipients`, `recipient_consent_events` e `audit_logs` possuem RLS e grants explícitos. A autorização combina usuário Auth, associação e papel; receber um `agency_id` no navegador não concede acesso. Helpers de autorização ficam em `private`, com `security definer`, `search_path` fixo e execução concedida somente quando necessária. Esse desenho combina as duas camadas descritas no [guia oficial de RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

| Operação na própria agência | Proprietário | Administrador | Editor | Leitor |
| --- | --- | --- | --- | --- |
| Consultar agência, equipe e clientes | Sim | Sim | Sim | Sim |
| Alterar nome, logo e fuso da agência | Sim | Sim | Não | Não |
| Criar, editar e arquivar clientes | Sim | Sim | Sim | Não |
| Gerenciar vínculos da Área do Cliente | Sim | Sim | Não | Não |
| Consultar convites sem hash e auditoria | Sim | Sim | Não | Não |
| Administrar membros operacionais via RPC | Sim | Sim | Não | Não |
| Administrar proprietários via RPC | Sim | Não | Não | Não |

Visitantes e usuários sem associação não acessam dados da agência. O navegador não grava associações, convites ou auditoria diretamente. Clientes são arquivados; não há grant de exclusão para usuários. IDs de associação e de agência do cliente são imutáveis. As FKs compostas `(agency_id, created_by)` e `(agency_id, invited_by)` impedem referências a membros de outra agência.

Remover um membro preserva clientes e convites relacionados, anulando apenas a referência de autoria neles; a auditoria mantém o usuário Auth original. As RPCs registram bootstrap, alterações de papel, remoção, emissão, revogação e aceite de convite. Criação, edição, arquivamento e reativação de clientes têm auditoria transacional na terceira migration.

`service_role` possui privilégios de manutenção e pode ignorar RLS. Sua chave nunca deve entrar no browser ou substituir o contexto do usuário no CRUD comum. A fundação não armazena credenciais de integração; o schema privado e a criptografia serão ampliados na etapa de integrações.

## Storage

Os quatro buckets são privados. A primeira parte do caminho é o UUID da agência. Para clientes, a segunda é o UUID do cliente, validado na mesma agência. As políticas verificam leitura e escrita separadamente, inclusive o destino de um `UPDATE`. O acesso via Storage segue as [políticas RLS oficiais](https://supabase.com/docs/guides/storage/security/access-control).

| Bucket | Caminho | Leitura administrativa | Escrita pelo usuário |
| --- | --- | --- | --- |
| `agency-assets` | `<agency_id>/<arquivo>` | Membros da agência | Proprietário/administrador |
| `client-assets` | `<agency_id>/<client_id>/<arquivo>` | Membros da agência | Proprietário/administrador/editor |
| `report-assets` | `<agency_id>/<caminho>` | Membros da agência | Reservada ao pipeline futuro |
| `report-pdfs` | `<agency_id>/<caminho>` | Membros da agência | Reservada ao pipeline futuro |

Imagens aceitas: PNG, JPEG e WebP. Limites de agência/cliente: 5 MiB; assets de relatório/PDF: 20 MiB. O bucket de PDFs aceita somente PDF. Não há URLs públicas para destinatários finais. O acesso por link individual, autorização da versão e emissão de URLs temporárias serão implementados com relatórios.

Os testes cobrem isolamento de leitura, inserção em outra agência, transferência via `UPDATE`, exclusão indevida, leitor sem escrita, cliente de outra agência no caminho, paths inválidos e perda imediata de acesso após remoção da equipe. A validação dos limites de arquivo exige o serviço Storage real.

## Tipos TypeScript

`src/types/database.ts` é um contrato inicial mantido manualmente, identificado no próprio arquivo. Após aplicar as migrations em Supabase local, substitua-o pelos tipos gerados e acrescente o alias utilizado pela aplicação:

```powershell
supabase gen types typescript --local --schema public | Set-Content -LiteralPath src/types/database.ts -Encoding utf8
Add-Content -LiteralPath src/types/database.ts -Value 'export type AgencyRole = Database["public"]["Enums"]["agency_role"];'
pnpm typecheck
```

Confira a alteração gerada antes de versionar. A geração depende do ambiente Supabase e não foi executada nesta entrega. Sempre que uma migration mudar o schema público, regenere os tipos e rode os testes relevantes.
