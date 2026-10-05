# Progresso da implementação

## Atualização de 4 de outubro de 2026 — conciliação completa e recuperação de dados inválidos

A leitura por snapshots agora compara os gastos de todos os níveis ao total da conta e os subtotais de cada campanha aos seus conjuntos e de cada conjunto aos seus anúncios. A comparação usa decimais e a tolerância existente (máximo entre meio centavo e erro relativo de `1e-10`). Totais globais iguais não encobrem gasto atribuído ao pai errado. Pais com gasto positivo e coleções de filhos vazias bloqueiam a análise; pais com zero confirmado podem ter filhos vazios. Gasto ausente, negativo ou inválido não é convertido em zero. A hierarquia é indexada por pai para evitar varreduras repetidas das listas de anúncios.

Snapshots inválidos têm classificação própria, distinta de negação de acesso ou falha de banco. A tela conserva o catálogo autorizado e oculta todos os indicadores quando a validação falha, mantendo a operação de atualização disponível ao operador. A solicitação de atualização resolve conta/período/versões diretamente pelo catálogo autenticado, sem depender da leitura dos snapshots anteriores; isso permite reparar metadados inválidos com uma nova coleta. Erros de acesso/banco continuam sendo propagados, sem converter revogação em dado vazio ou falha de métrica.

A interface inclui busca por nome/ID sem sensibilidade a acentos e paginação local de 25 entidades. Seleção, tabela e indicadores usam as entidades da página atual; buscas sem correspondência diferem de coleta confirmada vazia. Trocar conta/nível limpa a busca, página e seleção. Uma lista que diminui após atualização ajusta a página aos limites válidos. Essa paginação reduz a renderização, mas ainda não pagina a consulta dos snapshots no banco.

Testes incluem 2.500 anúncios em hierarquia disjunta, IDs iguais em contas diferentes, subtotais divergentes, valores inválidos, pais zero, recuperação sem ler snapshots defeituosos, negação de acesso e busca/paginação. `pnpm check` aprovado: lint, TypeScript, 487 testes de aplicação, 497 verificações SQL/RLS em PGlite e build de produção. Layout da lista paginada renderizado e inspecionado em Chrome local a 1440 e 390 pixels sem overflow da página. Nenhuma migration ou coleta externa foi executada. Homologação remota, séries diárias, comparação, relatórios e troca definitiva do dashboard principal continuam pendentes.

## Atualização de 4 de outubro de 2026 — executor HTTP e recuperação de coletas

`POST /api/workers/meta` processa até quatro jobs sequencialmente, com token de servidor `INTEGRATION_WORKER_SECRET` comparado por digest em tempo constante. Falta de configuração retorna 503; requisições sem autorização não criam cliente de serviço. O executor não inicia novos claims depois de quatro minutos; esse orçamento não interrompe um job já em andamento. Respostas/logs conservam um ID de execução e códigos genéricos, sem copiar exceções, tokens ou detalhes do banco. `processed` conta jobs processados, inclusive os finalizados como falhos; não significa snapshots confirmados.

A migration `202610040013_collection_refresh_cycles.sql` disponibiliza claim exclusivo da Meta, preservando jobs dos outros provedores, e solicitação transacional de atualização. Jobs confirmados/falhos voltam à fila; jobs queued/collecting/partial são preservados, inclusive claims e backoff. O snapshot anterior continua acessível. `attempt_count` permanece monotônico para fencing, enquanto `retry_epoch_attempt` marca o início de um novo orçamento de retries. Assim, atualizar um job que já esgotou tentativas não reutiliza números de workers antigos nem encerra os retries do novo ciclo imediatamente.

A tela por snapshots ganhou `Atualizar dados` para operadores autorizados. A ação reconstrói todos os níveis do período pelas contas autorizadas, sem aceitar conexão/versões externas, solicita o ciclo e mantém a visualização anterior confirmada. Escopo revogado, identidade divergente ou conta inválida desfazem a solicitação inteira. Testes verificam autorização HTTP, isolamento por provedor, recuperação, snapshot preservado, fencing de worker antigo e orçamento por ciclo.

`pnpm check` aprovado: lint, TypeScript, 455 testes de aplicação, 497 verificações SQL/RLS em PGlite e build de produção. Nenhum agendamento foi provisionado, segredo configurado, endpoint de produção invocado ou migration remota aplicada. A homologação operacional depende dessas etapas; comparações, séries diárias, relatórios e troca definitiva da fonte principal continuam pendentes.

## Atualização de 4 de outubro de 2026 — dashboard ligado aos snapshots e solicitação à fila

A rota autenticada `/cliente/[clientId]/snapshots` consulta exclusivamente snapshots persistidos, sem chamar a Meta durante a navegação. O dashboard atual oferece acesso à nova análise no modo agência, preservando período e contas; sua fonte anterior permanece até a homologação da troca. A nova tela permite escolher período, conta, nível e entidade, mostra indicadores decimais e nomes de hierarquia, conserva dados antigos sinalizados e reconsulta a disponibilidade automaticamente. Loading e erro possuem estados próprios.

A migration `202610040012_snapshot_account_catalog.sql` acrescenta catálogo autenticado de contas/conexão para construir as identidades no servidor, sem expor credenciais. Ela verifica cliente ativo, papel da agência ou vínculo do cliente, conta ativa/não arquivada e associação da conexão ao cliente. A leitura histórica continua disponível quando a integração desconecta; revogação de acesso ou conta impede a consulta.

Antes de liberar indicadores, o loader exige os quatro níveis por conta, compara gasto de conta com a soma das campanhas usando decimais e tolerância de arredondamento e verifica campanhas/conjuntos dos descendentes. Escopos faltantes, gasto divergente ou hierarquia órfã bloqueiam toda a análise. Moeda e fuso devem corresponder ao catálogo autorizado. Níveis e contas permanecem separados, sem soma de alcance ou duplicação de gasto entre pais e filhos. A conciliação não compara ainda os subtotais de gasto de conjuntos/anúncios com os respectivos pais.

Operadores com `canCollect` podem solicitar os dados faltantes. A Server Action revalida sessão/papel, resolve a seleção por catálogo e leitura autenticados e registra todos os jobs faltantes em um único upsert idempotente. Não reinicia jobs existentes, não libera dados parciais e sanitiza erros. Clientes/leitores não recebem essa operação. A consulta automática da tela apenas lê; não executa o worker.

Layout renderizado com fixtures em Chrome local, inspecionado em 1440 e 390 pixels sem overflow. Testes cobrem leitura até apresentação, permissão da solicitação, catálogo SQL, vínculos revogados, precisão e reconciliação. `pnpm check` aprovado: lint, TypeScript, 442 testes de aplicação, 472 verificações SQL/RLS em PGlite e build de produção. Migration remota, executor periódico, novas tentativas de jobs terminais, séries diárias, comparação, relatórios e substituição definitiva do dashboard anterior permanecem pendentes. Nenhuma coleta externa ou alteração remota foi executada.

## Atualização de 4 de outubro de 2026 — indicadores para apresentação dos snapshots

`projectMetaSnapshotView` converte a leitura conjunta em dados de apresentação por conta e nível. Conserva valores decimais como strings, estados de disponibilidade, unidades, regras de agregação e proveniência de cada snapshot. O nome vem do snapshot, com ID como alternativa; vínculos de hierarquia são preservados e status de entrega permanece desconhecido porque não integra o contrato atual.

A chave nativa `inline_link_clicks` recebe a chave de apresentação `link_clicks`; rótulos usam o catálogo Meta existente. Aliases conflitantes, outro provedor ou indicadores sem metadados são rejeitados. Um bundle pendente não libera entidades; uma coleta confirmada vazia permanece válida e uma leitura antiga conserva a sinalização `stale`. Não soma contas/níveis nem converte moedas ou valores para números de ponto flutuante.

Essa projeção prepara os indicadores e filtros, mas ainda não substitui a fonte das telas, séries diárias ou relatórios. Integração visual, reconciliação entre níveis e execução/homologação remota permanecem pendentes. Nenhuma coleta externa ou alteração remota foi realizada. `pnpm check` aprovado: lint, TypeScript, 414 testes de aplicação, 460 verificações SQL/RLS em PGlite e build de produção.

## Atualização de 4 de outubro de 2026 — leitura conjunta de snapshots

`readConfirmedSnapshotBundle` reúne escopos de contas/níveis de um único cliente, conexão, provedor, período e versões. A leitura usa as RPCs autenticadas existentes, com no máximo oito consultas simultâneas. Escopos duplicados ou incompatíveis são rejeitados antes das consultas. Se faltar qualquer snapshot confirmado, o retorno é `pending`, com os escopos faltantes e sem liberar dados parciais.

Coletas confirmadas vazias são válidas e diferem de snapshots ausentes. Havendo todos os snapshots, a leitura conserva IDs, horários, valores decimais e estados separados, sinalizando `stale` se qualquer escopo estiver antigo e usando o horário mais antigo na indicação de atualização. Falhas de autorização/banco ou snapshots inválidos são propagados. Não agrega níveis nem moedas e não garante que consultas independentes representem a mesma geração transacional.

Essa camada prepara a troca da fonte do dashboard; ainda não está ligada às telas nem enfileira jobs. Nenhuma migration ou coleta externa foi executada neste incremento. `pnpm check` aprovado: lint, TypeScript, 406 testes de aplicação, 460 verificações SQL/RLS em PGlite e build de produção.

## Atualização de 4 de outubro de 2026 — exibição completa do dashboard

A tela agora exige cobertura diária completa e agregado Meta confirmado para exibir a análise, seus gráficos e controles de exportação. Antes, a cobertura completa liberava cartões mesmo após uma falha de confirmação do agregado, fazendo Resultados e Custo por resultado aparecerem temporariamente indisponíveis. O bloqueio distingue coleta diária pendente de confirmação dos totais e agenda nova tentativa automática também no segundo caso.

Métricas realmente ausentes após confirmação continuam indisponíveis; não são fabricadas nem impedem indefinidamente a leitura. Uma análise completa já confirmada pode continuar visível durante sua atualização. Os testes verificam o bloqueio com cobertura completa sem confirmação e a liberação após uma tentativa posterior bem-sucedida. Validação local: lint, TypeScript, testes de aplicação, SQL/RLS e build; sem homologação da tela com uma conta Meta real.

## Atualização de 4 de outubro de 2026 — hierarquia no contrato 3

Novos jobs Meta usam o contrato 3, com nome e vínculos de conta, campanha, conjunto e anúncio preservados no snapshot. O adaptador exige identificadores válidos dos pais e rejeita relações consigo próprio. Os contratos 1 e 2 continuam aceitos com seu conteúdo anterior, incluindo os resultados e indicadores derivados do contrato 2.

A projeção exige a hierarquia correspondente ao nível no contrato 3 e rejeita metadados divergentes para a mesma entidade. Nomes ausentes permanecem nulos; caracteres de controle são removidos. Os payloads sanitizados recebem somente os identificadores de hierarquia. Essas validações estão no adaptador e na leitura, sem nova migration.

`pnpm check` aprovado: lint, TypeScript, 386 testes de aplicação, 460 verificações SQL/RLS em PGlite e build de produção. Os filtros do dashboard ainda não usam essa projeção. Criativos, ligação às telas e homologação remota continuam pendentes; nenhuma coleta externa foi executada.

## Atualização de 4 de outubro de 2026 — resultados nativos no contrato 2

Novos jobs criados por `buildMetaCollectionIdentity` usam o contrato normalizado 2. O adaptador continua aceitando o contrato 1 sem adicionar os novos indicadores a seus snapshots; versões anteriores permanecem intactas e as leituras exigem o contrato solicitado.

O contrato 2 preserva os tipos e valores do campo `results` da Meta com precisão decimal, calcula resultado principal somente quando há um único tipo confirmado e mantém tipos diferentes separados. Ações secundárias não determinam esse resultado. Indicadores duplicados, janelas alternativas e estruturas inválidas tornam o resultado indisponível. A regra existente de ausência de entrega continua confirmando resultado zero; custo de resultado zero permanece indisponível.

CPM, CPC de link, CTR de link e custo por resultado usam os numeradores/denominadores da mesma entidade e período. Divisão por zero e dados ausentes resultam em indisponibilidade. A projeção agora conserva unidades e regras de agregação, incluindo resultado comparável somente entre indicadores do mesmo tipo. Os testes cobrem compatibilidade do contrato 1, precisão, ambiguidade, tipos incompatíveis, ações secundárias, ausência de entrega e métricas derivadas.

`pnpm check` aprovado: lint, TypeScript, 369 testes de aplicação, 460 verificações SQL/RLS em PGlite e build de produção. Nenhuma fonte do dashboard foi substituída nem houve coleta externa. Projeção completa nas telas, hierarquia/criativos e homologação remota continuam pendentes.

## Atualização de 4 de outubro de 2026 — leitura dos snapshots confirmados

A migration `202610040011_confirmed_collection_read.sql` fornece uma RPC autenticada com o último snapshot confirmado da identidade exata: cliente, conexão, provedor, conta, período, nível, API e contrato. A consulta verifica vínculo do cliente ou papel na agência e não expõe jobs nem payloads brutos. Para Meta, exige conta ainda vinculada/ativa; desconexão da integração conserva o histórico autorizado, enquanto revogação do vínculo ou arquivamento impede novas leituras.

`readConfirmedCollectionSnapshot` usa o cliente Supabase autenticado e retorna a projeção validada por entidade, com idade e estados `ready`, `stale` ou `empty`. Valores são strings decimais; ausência de snapshot difere de coleta completa vazia. Métricas de escopo/versão divergente, estados incompatíveis, duplicatas e moedas/fusos incompatíveis são rejeitados. Uma coleta parcial posterior não substitui o último confirmado.

Validação: `pnpm check` aprovado; lint, TypeScript, testes de aplicação e SQL repetidos após a extensão dos cenários de leitura. Resultado: 355 testes de aplicação, 460 verificações SQL/RLS em PGlite e build aprovados.

Essa camada prepara a migração de leitura do dashboard; não substitui sua fonte atual. O contrato normalizado 1 ainda não fornece todos os resultados nativos e blocos usados pela interface. Migration e leitura remota permanecem pendentes de aplicação/homologação.

## Atualização de 4 de outubro de 2026 — adaptador Meta da fila

`runOneMetaIntegrationJob(service)` liga o worker autorizado ao `MetaClient` existente. O contexto carrega no servidor a credencial criptografada específica da conexão e os metadados da conta, usando a versão da API do job. A consulta paginada de Insights do período produz métricas normalizadas para um único nível por job e persiste pelos mecanismos de tentativa/lease da fila.

O primeiro contrato normalizado (`contractVersion: 1`, separado da versão analítica v11 do dashboard) inclui investimento, impressões, alcance, frequência, cliques e ações/valores nativos. Valores decimais são preservados como strings; métricas ausentes permanecem indisponíveis, métricas únicas não são aditivas e resultados principais não são inferidos das ações. A resposta deve corresponder exatamente à conta, período e nível pedidos, sem entidades repetidas. Payloads persistidos contêm apenas campos validados, sem tokens, nomes ou URLs de paginação.

Falhas estruturadas da Meta são classificadas para retry/autorização. A persistência só ocorre após todas as páginas terem concluído; falha em página posterior não grava um conjunto incompleto como confirmado. Testes usam o cliente Meta real com HTTP controlado e credenciais fictícias, além de verificar o carregamento da credencial por conexão. Não houve chamada à Meta real neste incremento.

Validação: `pnpm check` aprovado e, após acrescentar o cenário do ponto de entrada completo, lint do teste, TypeScript e suíte de aplicação repetidos. Resultado: 333 testes de aplicação, 443 verificações SQL/RLS em PGlite e build aprovados.

O ponto de entrada está disponível no servidor; não foi provisionado executor periódico nem alterado o fluxo de coleta do dashboard. A projeção destes snapshots no dashboard, cobertura completa de resultados nativos/criativos e homologação com conta real continuam pendentes.

## Atualização de 4 de outubro de 2026 — autorização dos jobs Meta

A migration `202610040010_meta_collection_scope.sql` verifica cliente, agência, conexão Meta, integração conectada e conta vinculada ativa. Novos jobs Meta e alterações de seu escopo são rejeitados quando esses vínculos não correspondem. O worker revalida a tentativa antes de chamar o provedor, e a criação do snapshot revalida o vínculo para detectar revogação durante a coleta. Conta/cliente arquivado, conexão sem autorização e vínculo desativado bloqueiam o fluxo; a falha ainda pode ser registrada sem deixar o job preso.

A autorização retorna o ID da integração, utilizado no monitoramento, corrigindo o envio anterior do ID da conexão Meta. Uma negativa de autorização gera `collection_scope_invalid`; indisponibilidade do banco e tentativa expirada são propagadas sem serem tratadas como revogação. Outros provedores continuam sem autorização operacional implementada.

Testes de aplicação e SQL exercitam escopo entre clientes/agências, revogação antes/durante a coleta, conta/cliente arquivado, integração desconectada, saúde na integração correta e recusa de provedores futuros. `pnpm check` aprovado; suíte SQL repetida após a última extensão dos testes. Resultado: lint, TypeScript, 311 testes de aplicação, 443 verificações SQL/RLS em PGlite e build de produção aprovados. A migration está preparada, sem aplicação em produção. Conectar a fila ao coletor Meta real e homologar no Supabase permanecem pendentes.

## Atualização de 4 de outubro de 2026 — identidade da coleta

O claim retorna a versão da API e a versão do contrato salvas no job. O worker deixa de substituir esses valores por `managed`/`1` e conserva o contrato original nos retries. O enfileiramento usa o cliente da própria identidade, eliminando o argumento separado que podia divergir da chave de idempotência.

A migration `202610040009_collection_identity.sql` valida o envelope do snapshot e a identidade de cada métrica no banco. Cliente, conexão, provedor, conta, período e nível devem corresponder ao job; métricas sem identidade são rejeitadas. A proteção cobre também inserts e updates diretos do serviço. Rejeições na RPC desfazem payloads e snapshot atomicamente. Testes SQL cobrem cada dimensão divergente, atualizações indevidas, persistência válida, precisão decimal e versões mantidas no retry.

`pnpm check` aprovado: lint, TypeScript, 305 testes de aplicação, 423 verificações SQL/RLS em PGlite e build de produção. A migration está preparada, sem aplicação remota neste incremento. Homologação no Supabase e validação da associação entre conexão/conta e cliente no fluxo de criação dos jobs continuam pendentes.

## Atualização de 4 de outubro de 2026 — retomada de jobs abandonados

A migration `202610040008_worker_leases.sql` permite recuperar claims sem conclusão após quinze minutos. O número da tentativa é obrigatório na persistência e na finalização; workers expirados ou de tentativas anteriores não podem gravar resultados nem sobrescrever o job retomado. A gravação de payloads e snapshot ocorre em uma única transação, com idempotência por tentativa e escopo derivado do job bloqueado.

As RPCs dos workers passam a ter entradas no schema público, executáveis somente pelo serviço, sem expor o schema privado. Foram acrescentados testes SQL para expiração, retomada, tentativa antiga, transação desfeita, gravação repetida, retry, jobs legados, papéis e isolamento entre clientes. A política de leitura usa uma função autorizada para verificar o vínculo oculto em `client_users`: permite somente snapshots confirmados do cliente ativo e nega vínculo revogado ou cliente arquivado. O procedimento e os limites estão em [OPERACAO.md](OPERACAO.md).

`pnpm check` aprovado: lint, TypeScript, 304 testes de aplicação, 403 verificações SQL/RLS em PGlite e build de produção. A migration foi preparada para aplicação remota; não foi aplicada em produção neste incremento. Homologação Supabase de concorrência e provisionamento do executor periódico continuam pendentes.

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
