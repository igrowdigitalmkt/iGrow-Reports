# Área do Cliente

A **Área do Cliente é um componente central da V1**. Ela será o espaço autenticado em que o cliente acompanha seu próprio desempenho continuamente, sem depender apenas do relatório recebido por WhatsApp.

A implementação foi dividida em duas camadas:

1. **Fundação de acesso**, antecipada agora para evitar refazer segurança e banco.
2. **Experiência completa**, construída depois que coleta, métricas e relatórios reais estiverem disponíveis.

## Fundação implementada

A migration `202609300005_client_portal_foundation.sql` cria `client_users`, vínculo separado de `agency_users`.

Um usuário da Área do Cliente:

- usa Supabase Auth;
- pode estar vinculado a um ou mais clientes;
- não recebe papel administrativo na agência;
- não lê equipe, auditoria ou configurações internas;
- não altera o cadastro do cliente;
- só lê clientes com vínculo explícito e ativo;
- perde o acesso aos dados em novas requisições quando o vínculo é revogado.

Proprietário e administrador podem gerenciar o vínculo por `set_client_user_access`. Editor e leitor não podem.O vínculo preserva histórico por meio do campo `active` em vez de exclusão direta. Concessão e revogação geram auditoria.

O helper `private.has_client_access(agency_id, client_id)` é a base para as futuras políticas RLS de métricas, relatórios e snapshots visíveis ao cliente.

No código da aplicação:

- `src/modules/client-portal/context.ts` centraliza a leitura dos vínculos ativos e a checagem de acesso;
- `src/modules/client-portal/actions.ts` protege a gestão administrativa do vínculo;
- `src/proxy.ts` já inclui `/cliente/:path*` no refresh de sessão;
- `src/types/database.ts` contém o contrato temporário da nova tabela e RPC.

## Experiência planejada

A interface completa da Área do Cliente será implementada sobre dados reais e reutilizará o mesmo motor de métricas dos relatórios.

Ela deverá incluir:

- dashboard próprio;
- seleção de período;
- comparação entre períodos compatíveis;
- indicadores principais configurados pela agência;
- evolução temporal;
- detalhamento permitido de campanhas, conjuntos, anúncios e criativos;
- data da última atualização;
- histórico de relatórios publicados;
- abertura das versões liberadas;
- download de PDFs;
- seleção de cliente quando o mesmo usuário possuir mais de um vínculo.## Relação com links individuais

O login da Área do Cliente não substitui o link individual de relatório.

Os dois mecanismos coexistem:

- **Área do Cliente:** sessão autenticada e acesso contínuo ao cliente autorizado.
- **Link individual:** credencial própria de uma versão, podendo abrir diretamente o relatório sem login enquanto estiver válida.

As regras de expiração, revogação e registro de acesso dos links continuam na seção R do planejamento.

## Validação atual

Em 30/09/2026:

- 26 verificações pgTAP específicas da Área do Cliente passaram;
- a suíte SQL completa chegou a 146 verificações aprovadas;
- 4 testes de aplicação específicos da gestão do acesso passaram;
- a suíte de aplicação chegou a 56 testes aprovados;
- TypeScript, ESLint e build de produção passaram;
- os 8 testes Playwright de regressão existentes passaram usando o canal Chrome local.

Esses testes usam PGlite e mocks locais. Supabase Auth/PostgREST real, concorrência e a experiência de login do cliente ainda precisam de homologação em Supabase de staging ou ambiente descartável.

A entrada autenticada já existe em `/cliente`, com seleção quando a conta possui mais de um vínculo, estado próprio para conta sem cliente liberado e visão individual em `/cliente/[clientId]`. A tela individual não inventa métricas: enquanto Meta, motor de métricas e relatórios não estiverem disponíveis, apresenta estados vazios explícitos. Os blocos de desempenho, períodos, comparações e histórico serão preenchidos somente com dados reais.