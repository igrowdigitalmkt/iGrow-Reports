# Progresso da implementação

## Atualização de 4 de outubro de 2026 — falhas e diagnóstico dos workers

O worker separa coleta, persistência, finalização e monitoramento. Falhas de persistência agendam uma nova tentativa em um minuto com código `persistence_error`, sem atribuir a falha ao provedor. Uma falha na RPC de finalização é propagada sem tentar uma segunda transição. O registro de saúde ocorre após finalizar o job; se esse registro falhar, o erro chega ao executor, mas a transição persistida é preservada.

Exceções dos provedores são classificadas antes da gravação. O histórico recebe mensagens fixas em português e a saúde recebe somente o código classificado, sem copiar URLs, tokens ou outros detalhes da exceção. Essa proteção se aplica ao diagnóstico de erros; os payloads de coleta continuam sob responsabilidade de sanitização dos adaptadores.

Sete novos cenários cobrem falhas de persistência/finalização/monitoramento e exceções contendo credenciais. `pnpm check` aprovado: lint, TypeScript, 304 testes de aplicação, 364 verificações SQL/RLS em PGlite e build de produção. Recuperação de jobs abandonados por interrupção do processo e homologação remota continuam pendentes.

## Atualização de 4 de outubro de 2026 — persistência dos workers

O resultado da coleta usa o provedor e o cliente do job persistido. Payloads brutos deixam de ser identificados sempre como Meta; um adaptador registrado sob outro provedor é recusado antes da coleta. Snapshots completos com reconciliação negativa permanecem parciais.

A gravação do snapshot mantém o job em `collecting` até a chamada de `finish_integration_collection_job`, evitando a rejeição da própria finalização por estado incompatível. A confirmação registra o horário de conclusão. Cinco testes novos cobrem persistência, ausência do job, conclusão, reconciliação e associação do adaptador.

A suíte SQL voltou a executar integralmente após remover BOMs de uma migration e dois arquivos de testes e atualizar a fixture de relatórios manuais para o contrato v11. Falhas SQL agora identificam o arquivo de teste. Validação: `pnpm check` aprovado, incluindo lint, TypeScript, 297 testes de aplicação, 364 verificações SQL/RLS em PGlite e build de produção. Homologação remota e concorrência real continuam pendentes.

Atualizado em 30/09/2026. A [V1 completa](PLANEJAMENTO_V1.md) continua em desenvolvimento incremental. A decisão de produto mais recente tornou a **Área do Cliente um componente central da V1**; sua fundação de acesso foi antecipada para que banco e autorização não precisem ser refeitos depois.

## Quarto incremento — fundação da Área do Cliente

A quinta migration cria `client_users`, separado de `agency_users`, com vínculo explícito entre conta Auth e cliente. O cliente autenticado permanece somente leitura, não recebe papel na agência e não acessa equipe, auditoria ou configurações internas. Proprietário e administrador podem conceder ou revogar o vínculo por RPC autorizada; editor e leitor não podem. Concessão e revogação são auditadas e a revogação retira o acesso aos dados em novas requisições.

A aplicação ganhou `src/modules/client-portal/context.ts` como camada de acesso próxima aos dados, `actions.ts` para gestão administrativa e `/cliente/:path*` no proxy. As rotas `/cliente` e `/cliente/[clientId]` já existem: selecionam apenas vínculos reais, suportam mais de um cliente e apresentam uma visão autenticada sem números fictícios. Os blocos de desempenho permanecem em estado vazio até coleta, métricas e relatórios reais estarem disponíveis. Veja [AREA_CLIENTE.md](AREA_CLIENTE.md).

Validação local atual: **56 testes de aplicação**, **146 verificações pgTAP** em cinco migrations e **8 testes Playwright** aprovados usando o Chrome local. TypeScript, ESLint e build de produção também aprovados. Supabase real continua pendente de homologação.

## Terceiro incremento — destinatários

Cadastro/edição de nome e telefone, ativação/desativação, autorização explícita com origem/data, descadastro e histórico implementados. Telefone alterado perde autorização. Leitor somente consulta. Migrations e ações preservam isolamento por agência. Nenhuma mensagem é enviada. Veja [DESTINATARIOS.md](DESTINATARIOS.md).

Validação local: 44 testes de aplicação, 120 verificações pgTAP (quatro migrations no PGlite) e 8 testes Playwright aprovados. Lint, TypeScript e build aprovados. Histórico revisado visualmente. Supabase remoto, filas e webhook continuam pendentes.

## Segundo incremento — clientes

Cadastro, edição de nome/observações, arquivamento e reativação implementados. Busca e filtros de ativos/arquivados/todos; Leitor somente consulta. Operações de servidor revalidam sessão, papel e agência, aplicam RLS e rejeitam formulários de outra agência. A terceira migration adiciona auditoria transacional sem copiar observações para logs.

Em `/demo/clientes`, o mesmo fluxo pode ser experimentado com alterações temporárias apenas na página. Em `/dashboard/clientes`, a persistência depende do Supabase configurado. Não houve conexão com banco remoto. Destinatários, consentimento, contas de anúncios e upload de logo permanecem para próximos incrementos.

Testes atuais: 34 testes de aplicação, 90 verificações pgTAP em PGlite e 7 testes Playwright aprovados, incluindo criar/editar/arquivar/reativar e descartar alterações demonstrativas ao recarregar. Build e TypeScript aprovados. As três migrations foram executadas no banco descartável; validação remota continua pendente.

## Primeiro incremento — registro da fundação

| Área | Entrega | Estado de validação |
| --- | --- | --- |
| Projeto | Next.js, TypeScript estrito, Tailwind e lockfile pnpm | Build, TypeScript, lint e instalação frozen-lockfile aprovados |
| Interface | Shell administrativo grafite, acentos azul/cyan/violeta e componentes reutilizáveis | Revisada em 1440, 768 e 390 pixels; sem overflow da página |
| Demonstração | `/demo` com fixtures identificadas | 6 testes Playwright aprovados; filtros, prévia, navegação e temas |
| Autenticação | Supabase SSR, entrada, saída, convite, definição de senha e área protegida | Código implementado; fluxo remoto depende de credenciais |
| Contexto | Usuário associado à agência e papel | Revisão de autorização e 29 testes de aplicação aprovados |
| Banco | Duas migrations com permissões, RLS e buckets privados | Aplicadas em PostgreSQL WASM/PGlite; Supabase real pendente |
| Isolamento | Testes SQL para cenários permitidos e negados | 83 verificações pgTAP aprovadas em PGlite |
| Documentação | Execução, arquitetura, banco, métricas, integrações e operação | Atualizada junto ao incremento |

## Dependências externas pendentes

Verificações adicionais: teste HTTP do build de produção aprovado (demo desabilitada retorna 404; dashboard sem configuração redireciona com 307 e sem cache). O planejamento foi atualizado em 30/09/2026 para incorporar a Área do Cliente autenticada à V1; por isso, o antigo SHA-256 do texto inicial deixou de representar o planejamento vigente. As verificações de navegador usam Chrome local via Playwright. Capturas locais estão em `artifacts/`, ignorado pelo Git. TypeScript 6 e ESLint 9 foram escolhidos por compatibilidade com os plugins atuais do Next.js.

- Projeto Supabase local ou de homologação, migrations aplicadas e suíte SQL reexecutada nesse ambiente.
- Usuário Supabase de teste e bootstrap da agência/associação.
- Homologação do fluxo de login, expiração/renovação de sessão, logout, isolamento entre agências e isolamento dos usuários da Área do Cliente.
- Repositório remoto e projeto Vercel configurados, caso se deseje publicar.
- Credenciais, contas autorizadas e homologação dos provedores nas respectivas etapas futuras.

A máquina inicial não dispõe de Docker, `psql` ou Supabase CLI nem de credenciais fornecidas. Para verificar o SQL nesta máquina, o executor PGlite aplica as migrations reais em um banco descartável PostgreSQL WASM/PGlite. As **146 verificações pgTAP** passaram, cobrindo isolamento entre agências, papéis, convites, último proprietário, clientes, destinatários, Área do Cliente, auditoria, bootstrap e políticas de Storage.

Nesse executor, as estruturas pertencentes ao Supabase Auth/Storage e `auth.uid()` são substitutos mínimos de teste. O resultado confirma os cenários SQL/RLS executados; não homologa serviços Auth/Storage via HTTP, concorrência entre sessões nem um ambiente Supabase real.

## Continuação

1. Aplicar as cinco migrations e repetir a suíte SQL em Supabase descartável, gerar tipos do banco e homologar Auth, Storage, RLS e concorrência com usuários de agência e cliente.
2. Homologar clientes, destinatários e o vínculo `client_users` no Supabase real de teste.
3. Implementar gestão controlada de equipe/convites e o fluxo de provisionamento/convite para usuários da Área do Cliente.
4. Conectar uma conta Meta autorizada e validar acesso, contas, coleta e parâmetros.
5. Avançar para métricas, templates, snapshots, relatórios e aprovação; em seguida conectar esses dados ao dashboard da Área do Cliente.
6. Acrescentar PDF, links, WhatsApp, automação QStash e operação conforme o planejamento.

Nenhum relatório real foi coletado, gerado ou enviado. A V1 só será concluída após o fluxo completo, repetível e homologado descrito no planejamento.

## Atualização de 1 de outubro de 2026 — dashboard e relatórios

Área do Cliente com Visão geral, Campanhas, Todas as métricas e Relatórios. Seis indicadores fixos, métricas opcionais persistidas, seleção hierárquica de campanhas/conjuntos/anúncios e ordenação de colunas. A seleção aplicada alimenta os cálculos e o PDF; métricas únicas sem deduplicação ficam indisponíveis.

PDF com cabeçalho do espaço de trabalho, filtros, indicadores, gráficos e seleção. Clientes baixam sem salvar. Proprietários e administradores geram versões imutáveis, publicam e retiram relatórios das listagens preservando auditoria. PDFs publicados usam a configuração congelada na geração.

Migration 202610010019_dashboard_reports.sql aplicada no Supabase de produção em transação. A coleta Meta persiste os quatro níveis atomicamente. Google Ads e TikTok permanecem indisponíveis até implementação das integrações.

Validação: lint, TypeScript, 107 testes unitários, suíte SQL/RLS, build de produção e 8 testes de navegação/layout. PDF paginado renderizado e inspecionado visualmente. Cenários de persistência, autorização, publicação e exclusão cobertos no banco descartável.
