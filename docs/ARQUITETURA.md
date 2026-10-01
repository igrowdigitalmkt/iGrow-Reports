# Arquitetura da fundação

Este documento descreve o primeiro incremento do iGrow Reports. O [planejamento completo](PLANEJAMENTO_V1.md) define a V1; a presença de uma funcionalidade nesse planejamento não significa que ela já foi implementada.

## Organização

O projeto é um monólito modular com Next.js App Router e TypeScript estrito. A mesma aplicação contém páginas, componentes de servidor e ações de autenticação. PostgreSQL/Supabase é a fonte dos dados persistentes; migrations SQL, sem ORM, definem o banco.

| Local | Responsabilidade |
| --- | --- |
| `src/app` | Rotas, layouts e estilos globais |
| `src/components` | Primitivos visuais, shell administrativo e gráficos |
| `src/modules` | Contexto da agência, autenticação, clientes, destinatários e fundação da Área do Cliente |
| `src/lib` | Configuração e clientes de infraestrutura |
| `src/types` | Tipos compartilhados e contrato do banco |
| `supabase/migrations` | Estrutura, permissões e políticas RLS |
| `supabase/tests` | Suíte pgTAP de acesso permitido/negado e executor local PGlite |
| `tests` | Verificações de aplicação e navegação |

Novos módulos entram com seus casos de uso. Diretórios vazios não representam funcionalidades entregues. Meta, WhatsApp, relatórios, agendamentos e entregas continuam como próximos incrementos.

## Fronteiras de dados e acesso

`/demo` é uma rota pública com dados fictícios identificados. Não consulta dados de clientes, não envia mensagens e não substitui uma sessão real. `/dashboard` é a área administrativa autenticada: exige usuário verificado e associação a uma agência. A futura árvore `/cliente` usa a mesma base Auth, mas autorização própria por `client_users`; possuir acesso de cliente não concede associação à agência. A falta de configuração do Supabase produz uma mensagem de configuração pendente.

O ID da agência é diferente do ID do usuário. Um usuário pode pertencer a várias agências; o contexto escolhido precisa constar nas suas associações obtidas no servidor. Cookies ou campos enviados pelo navegador servem apenas como seleção, nunca como autorização.

As leituras da aplicação usam o cliente Supabase no contexto da sessão do usuário, preservando RLS. O proxy mantém a sessão atualizada; a camada de servidor volta a conferir a identidade e a associação antes de expor a área da agência. Redirecionar uma página não substitui políticas de banco.

A sessão usa cookies próprios `igrow-auth` com `HttpOnly`, `SameSite=Lax` e `Secure` em produção. O logout remove também as partes desses cookies se a renovação da sessão falhar. A escolha de agência fica em `igrow-agency`. Os callbacks só redirecionam para rotas internas permitidas e não são armazenados em cache público.

Os papéis administrativos são `owner`, `admin`, `editor` e `viewer`, apresentados em português. Usuários da Área do Cliente não recebem esses papéis: sua autorização vem de vínculo explícito, ativo e separado com um cliente. As migrations incluem agências, associações, convites, clientes, destinatários, vínculos da Área do Cliente, auditoria e buckets privados. RPCs controlam emissão/aceite/revogação de convites e alterações de equipe; a interface completa de administração de equipe ainda está pendente. O modelo e as políticas da fundação estão em [BANCO.md](BANCO.md).

O bootstrap da primeira agência é um procedimento SQL de operador e depende de uma conta Auth já confirmada. A criação de contas e a entrada em uma agência são operações distintas. Os tipos TypeScript iniciais descrevem a migration; devem ser regenerados pelo Supabase CLI após aplicação no ambiente real.

## Design system

Tailwind CSS fornece tokens de superfícies, bordas, espaçamento, tipografia e estados. O painel prioriza fundo grafite com azul, cyan e violeta; estados de sucesso e falha incluem texto, além de cor. Geist Sans atende à interface; Geist Mono, aos números e metadados.

Lucide fornece ícones, ECharts apresenta séries demonstrativas e Motion respeita a preferência de movimento reduzido. Primitivos Radix dão suporte aos controles que precisam de comportamento acessível. Componentes reutilizáveis centralizam variantes de botões, badges, cards e shell.

## Evolução prevista

Meta e WhatsApp serão adaptadores de servidor. A interface consumirá dados normalizados; não interpretará payloads brutos dos provedores. QStash chamará endpoints autenticados por assinatura e processará etapas curtas com estado persistido, checkpoints e idempotência. Essas integrações não estão implementadas neste incremento.

Relatórios publicados dependerão de versões e snapshots imutáveis. Aprovação, PDF, links e entregas serão associados à versão. A Área do Cliente consumirá o mesmo motor de métricas e os mesmos dados normalizados usados nesses relatórios, evitando uma segunda fonte de verdade. As respectivas tabelas e invariantes serão acrescentadas com os módulos, sem antecipar o schema inteiro da V1 nesta fundação.

Local, homologação e produção devem ter configurações e dados separados. Vercel é o destino aprovado para hospedagem; nenhum deploy é consequência automática de preparar o projeto. O comportamento SSR segue o [guia oficial do Supabase para Next.js](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs).
