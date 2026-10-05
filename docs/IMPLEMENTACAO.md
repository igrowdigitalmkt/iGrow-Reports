# Progresso da implementação

## Atualização de 4 de outubro de 2026 — PDF da análise confirmada

A rota por snapshots agora oferece PDF ao lado de CSV/JSON após a liberação da análise completa. Exporta todas as entidades da conta e do nível escolhidos, independentemente da busca/paginação. O gerador compartilha a validação de escopo confirmado dos outros formatos; bloqueia análise pendente, faltantes, escopo duplicado, conta/nível ausente e provedor incompatível. Não consulta a Meta, enfileira jobs, soma níveis/contas ou converte valores decimais para ponto flutuante.

O PDF A4 inclui valores exatos, disponibilidade dos indicadores, hierarquia, moeda/fuso, período, quantidade de entidades, horário original, ID do snapshot e versões do contrato/API. Dados `stale` permanecem exportáveis com aviso próprio; coleta vazia recebe um documento identificado sem zero artificial. Cabeçalhos e rodapés se repetem; nomes e linhas maiores que uma página são divididos, e tabelas em continuação identificam a entidade. Noto Sans licenciada sob SIL OFL é servida localmente e incorporada somente no momento da exportação. Caracteres sem glifo compatível bloqueiam o PDF com orientação para CSV/JSON, preservando os nomes nesses formatos.

A geração assíncrona cede tempo à interface entre grupos de entidades, mostra progresso e permite cancelamento antes do download. Sair da página aborta a operação; cancelamento não entrega documento parcial. A conta, nível e período ficam protegidos contra alterações pelos controles durante a exportação. A serialização final do arquivo permanece síncrona.

16 testes de PDF cobrem gates, precisão, 61 entidades, ausência de mutação, `stale`/vazio, nomes/linhas extensos, Unicode, isolamento, progresso, cancelamento e recuperação de fonte. Dois testes de renderização confirmam os três botões após liberação e sua ausência na análise pendente. `scripts/verify-snapshot-pdfs.py` extrai os arquivos reais e verifica conteúdo/proveniência, todas as entidades e margens/cabeçalhos de todas as páginas. PDFs de teste renderizados em Poppler e inspecionados visualmente; fontes e limites sem cortes. O documento com 61 entidades contém 38 páginas após o ajuste de continuação. `pnpm check` passou, incluindo as duas execuções de 497 verificações SQL/RLS. Após os últimos ajustes, 555 testes de aplicação, lint, build/TypeScript e `pnpm test:production` passaram, inclusive o acesso HTTP às duas fontes TrueType locais.

Download interativo com sessão real não foi homologado: o controle de navegador ficou indisponível nesta sessão. Não foi mantida rota de fixtures no código publicado. Nenhum segredo, agendamento, migration ou coleta real foi configurado/executado neste incremento. Séries diárias, comparação entre períodos e troca da fonte principal permanecem pendentes.

## Atualização de 4 de outubro de 2026 — preparação operacional do executor

A estrutura SQL de snapshots foi aplicada em produção após autorização explícita: migrations `202610040001` a `202610040013`, 33 requisitos aprovados sem falhas e tabela reconhecida pela API. O registro verificável está em [ATIVACAO_SNAPSHOTS.md](ATIVACAO_SNAPSHOTS.md). O POST publicado ainda retornou 503 sem token: executor indisponível, não uma fila operacional.

Implementado `GET /api/workers/meta/health`, protegido pelo mesmo Bearer. Verifica configuração Meta, criptografia e consultas vazias nas quatro tabelas sem reivindicar jobs, ler registros de cliente ou acessar a Meta. Retorna somente flags e mensagens sanitizadas, sempre sem cache. Essa verificação não homologa tokens Meta, RPCs ou coleta real.

`pnpm worker:schedule` prepara um schedule QStash de quinze minutos e identidade estável por origem. Só `--apply` faz chamadas externas: exige verificação protegida positiva, consulta o ID antes de criar, recusa agendamento existente, separa token QStash do Bearer encaminhado, bloqueia redirects e solicita redação do Authorization nos registros QStash. Não carrega `.env` automaticamente, grava segredos, configura hospedagem ou altera planos. A pré-consulta não elimina corrida entre operadores; provisionar uma vez por responsável.

25 novos testes cobrem proteção antes do acesso privilegiado, dependências ausentes, erros sanitizados, destino/origem QStash inválidos, identidade estável, bloqueio antes da criação, configuração existente, tokens separados, redação e respostas ambíguas. `pnpm check` passou com lint, TypeScript, build e as duas execuções de 497 verificações SQL/RLS. Após as últimas alterações, 537 testes de aplicação, lint, TypeScript e verificações HTTP do build de produção passaram.

Nenhum segredo foi gerado/configurado, agendamento criado ou job real processado neste incremento. O arquivo operacional local disponível não contém os dois tokens requeridos. A frequência preparada representa 96 chamadas/dia; conferir capacidade/timeout/custo do plano existente antes da ativação. O dashboard principal conserva sua fonte anterior.

## Atualização de 4 de outubro de 2026 — pacote transacional para ativação

Inventário SQL remoto somente de leitura confirmou que todas as quatro tabelas da ingestão estão ausentes, assim como as funções consultadas de claim, saúde, catálogo, leitura e atualização. As seis tabelas anteriores usadas pela nova estrutura, os três papéis Supabase e os helpers de autorização estão presentes. Isso permite preparar a instalação da ingestão a partir de `202610040001`, sem reaplicar as migrations da plataforma anterior.

`pnpm prepare:snapshot-rollout` gera SQL e manifesto locais das 13 migrations de ingestão. Confere a sequência, registra SHA256 das fontes/pacote, usa transação e lock consultivo, limita espera/execução, verifica pré-requisitos e recusa tabelas/funções já existentes. Antes do commit executa os 33 requisitos do diagnóstico; falha cancela a confirmação. A notificação PostgREST só é enviada no commit. Não atualiza histórico CLI, não conecta ao banco e não configura executor, segredo ou coleta.

`pnpm test:rollout` instala a fundação anterior e testa o pacote real em PGlite descartável com cliente fictício preexistente. Verifica recusa de pré-requisito ausente/instalação parcial, rollback de erro tardio após DDL, recusa por permissão indevida na pós-validação, preservação integral do cliente, sucesso e reaplicação bloqueada. Depois executa as mesmas 497 verificações SQL/RLS sobre a instalação pelo pacote. `pnpm check` agora valida as migrations individualmente e também esse caminho operacional. Lint, TypeScript, 512 testes de aplicação, as duas execuções SQL/RLS e build aprovados. Pacote preparado, mas não aplicado em produção neste incremento.

## Atualização de 4 de outubro de 2026 — compatibilidade com o banco publicado

A inspeção remota confirmou que o código até `c0e7b46` estava publicado no domínio original, mas RPCs necessárias à análise por snapshots estavam ausentes. A rota agora trata especificamente `PGRST202` nas leituras do catálogo e snapshots: mantém a autenticação e o shell do cliente, informa indisponibilidade temporária e oferece retorno ao dashboard. Não renderiza indicadores, solicitação de coleta ou exportação nesse estado. Erros de autorização/banco e métricas inválidas não são convertidos em configuração pendente. A solicitação de atualização também distingue RPC indisponível de sucesso na fila.

O diagnóstico operador `supabase/diagnostics/snapshot-readiness.sql` consulta somente catálogos PostgreSQL, sem dados de clientes, credenciais ou alterações de schema. Verifica 33 requisitos de RPCs, permissões, RLS, colunas e contrato de retry; retorna a migration de origem e os estados individual/global. A suíte PGlite executa o SQL antes da instalação e após todas as migrations, depois remove uma função, concede uma permissão indevida e desabilita RLS em transações descartáveis para confirmar detecção de falhas. Não é prova de homologação completa, cache PostgREST atualizado ou executor configurado.

Lint, TypeScript, build e 497 verificações SQL/RLS aprovados no `pnpm check`; 512 testes da aplicação aprovados após a última regressão de repository. Documentação de publicação registra a revisão remota confirmada e a diferença entre código publicado e funcionamento completo. Não houve aplicação de migration remota, configuração de segredo, provisionamento de cron ou coleta externa neste incremento.

## Atualização de 4 de outubro de 2026 — exportação dos snapshots confirmados

A análise por snapshots permite exportar CSV e JSON de todas as entidades da conta e do nível selecionados. Busca e paginação não recortam o relatório. Não há soma entre contas, moedas ou níveis. Análise pendente, escopo ausente/duplicado ou provedor incompatível bloqueiam a exportação; dados antigos confirmados conservam `stale` e seu horário original.

O CSV conserva decimais originais e estados zero/ausente/erro, além de unidade, regra de agregação, hierarquia, período, versão e ID do snapshot. Usa BOM UTF-8, separador ponto e vírgula, escape de aspas e proteção de prefixos de fórmula em textos. Uma linha de escopo permite documentar coleções vazias sem fabricar métricas. O JSON versionado conserva strings decimais, valores nulos e entidades completas para importação sem conversão numérica automática. O download é local à página autorizada, sem chamada Meta ou nova coleta.

`pnpm check` aprovado: lint, TypeScript, 500 testes de aplicação, 497 verificações SQL/RLS e build. Regressões cobrem precisão, caracteres especiais, fórmulas, 61 entidades, isolamento por conta/nível, coleção vazia e bloqueio de análise incompleta. Controles renderizados e inspecionados em Chrome local a 1440 e 390 pixels sem overflow. A inspeção usa fixtures; download com sessão real e homologação remota continuam pendentes. PDF, séries diárias, comparações e substituição definitiva da fonte principal ainda não estão implementados nesse fluxo. Nenhuma migration remota ou coleta externa foi executada.

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

## Atualização de 5 de outubro de 2026 — comparação de snapshots

A rota de snapshots oferece comparação opcional com o período anterior de mesma duração. A análise inteira espera confirmação e conciliação dos dois períodos. As solicitações de atualização derivam as datas no servidor e reautorizam as contas. Diferenças usam aritmética decimal; bases anteriores iguais a zero não produzem percentuais.

CSV, JSON e PDF incluem comparação e origem dos dados. CSV e JSON preservam também entidades exclusivas do período anterior; a tela e o PDF explicam essa diferença de cobertura. O CSV registra versões, regras, atribuição e hierarquia para conferência. A tela apresenta diferença absoluta e variação percentual por indicador.

O incremento inicial passou por 582 testes da aplicação, lint, tipos, SQL/RLS, build e validação dos PDFs renderizados. A revisão seguinte acrescenta cobertura para metadados de atribuição e a apresentação das diferenças. Não houve alteração da fonte do dashboard principal, criação de credenciais, agendamento ou coleta real. Publicação da revisão e homologação com sessão autenticada precisam de confirmação independente.

A troca de filtros agora tem estado de navegação próprio: valores e exportações anteriores ficam ocultos enquanto a nova seleção carrega. Consultas automáticas ficam suspensas durante navegação, exportação ou outra consulta. O formulário informa datas inválidas antes de iniciar a navegação. Testes adicionais verificam o bloqueio visual, período atual incompleto, preservação da data anterior de coleta e revogação de conta entre consultas. A suíte da aplicação passou com 589 testes; a navegação real autenticada ainda exige homologação no navegador.

## Atualização de 5 de outubro de 2026 — séries diárias e gráfico de evolução

Implementada a seção 6C do guia de continuidade: séries diárias persistidas e gráfico de evolução no novo fluxo `/cliente/[clientId]/snapshots`.

Novos arquivos (commit `5e601f1`):

- `src/modules/client-portal/snapshot-series-loader.ts` — carregador server-only que consulta snapshots individuais de 1 dia (dateFrom === dateTo, nível account) para o período selecionado. Valida associação via RPC `list_client_snapshot_accounts`, limita a 90 dias, lê 8 por vez (mesmo padrão do bundle reader), marca ausentes sem bloquear a série, transporta decimais como strings sem arredondamento e expõe unidades obtidas da projeção. Exporta também `resolveSeriesMissingIdentities`: uma `CollectionIdentity` por dia para a solicitação de coleta.

- `src/components/charts/snapshot-series-chart.tsx` — gráfico ECharts tree-shaken (`echarts/core`). Tooltip usa `formatSnapshotDecimal`. Área para uma métrica; legenda para múltiplas. `connectNulls: false` preserva lacunas. Acessível via `role="img"` e tabela `<details>`.

- `src/modules/client-portal/snapshot-series-actions.ts` — server action `requestSeriesData` que valida acesso, resolve identidades ausentes e enfileira via `enqueueCollectionJobs`.

- `src/modules/client-portal/snapshot-series-section.tsx` — componente servidor: verifica limite de 90 dias e carrega a série.

- `src/modules/client-portal/snapshot-series-panel.tsx` — componente cliente: `next/dynamic` (ssr: false), seletor múltiplo de métricas, botão de coleta de dias ausentes.

- `src/modules/client-portal/snapshot-series.css` — estilos no tema escuro, incluindo placeholder animado.

- `tests/snapshot-series-loader.test.ts` — 8 testes: série com 1 ponto/dia, ausentes marcados, todos ausentes, conta não autorizada, `CollectionSchemaUnavailableError`, período >90 dias, identidades 1/dia e decimais verbatim.

Arquivo modificado:

- `src/app/cliente/[clientId]/snapshots/page.tsx` — `SnapshotSeriesSection` abaixo do dashboard, primeira conta do período vigente.

Sem alteração de schema, migration, segredo ou coleta real. `pnpm check` com os 8 novos testes e homologação autenticada permanecem pendentes de execução local.

### 5/10/2026 — Validação local das séries diárias

- `187f10d`: removido parâmetro `unit` não usado em `snapshot-series-panel.tsx` e adicionado mock de `server-only` em `tests/snapshot-availability.test.ts`.
- `pnpm check` executado na máquina do usuário após `git pull`: 71 arquivos de teste e 597 testes aprovados, `test:db` e `test:rollout` verdes, build Next.js 16.3.8 concluído com `/cliente/[clientId]/snapshots` dinâmica.
- Contexto da sessão claude.ai (cloud) trazido para o Claude Code desktop; esta sessão roda direto no checkout local.
- Pendente: confirmar deploy de `187f10d` na Vercel e homologar a série com sessão autenticada e dados reais.

### 5/10/2026 — Revisão das séries diárias contra C.1/C.2

Revisão do código de `5e601f1` (escrito em container sem execução intermediária de testes) encontrou desvios do requisito e um defeito:

- Defeito: "Solicitar coleta dos dias ausentes" sempre falhava com mais de um dia, porque `enqueueCollectionJobs` exige o mesmo período em todas as identidades. Criado `enqueueDailyCollectionJobs` em `src/modules/integrations/repository.ts`: mesma conta/conexão/nível/versões, um dia exato por identidade, upsert idempotente único.
- A ação enfileirava todos os dias do período; agora só os dias sem snapshot confirmado.
- O gráfico era exibido com lacunas (análise parcial). Agora `complete` só é verdadeiro com todos os dias confirmados; antes disso o painel mostra cobertura e oculta gráfico e seletor.
- Estados por dia: `ready`, `empty` (coleta confirmada sem linhas, "Sem veiculação" na tabela, distinto de ausente e de zero), `missing` e `invalid` (falha de validação, entidade inesperada, moeda ou fuso diferente da conta). Antes, erro de validação virava "ausente" e seria reenfileirado inutilmente.
- Indicadores cuja unidade muda entre dias são excluídos; unidade vem só do snapshot (removida heurística por nome).
- Painel identifica conta, moeda e fuso (a série usa a primeira conta selecionada). Período invertido é rejeitado.
- Testes: 14 em `tests/snapshot-series-loader.test.ts` (6 novos). `pnpm check` local: 71 arquivos, 603 testes, test:db, test:rollout e build aprovados; lint sem avisos após ajuste final.
- Deploy de `187f10d` confirmado pela API GitHub: Production, success.
- Pendente: homologação autenticada com dados reais; a coleta real de snapshots diários depende da ativação do executor (seção B do guia).

### 5/10/2026 — Coleta imediata após solicitação (sem agendador externo)

Motivação: o fluxo por snapshots só recebe dados quando o executor roda, e o ambiente de produção (cópia `.env.diag` de 3/10) não tem `INTEGRATION_WORKER_SECRET` nem QStash. Sem isso, nenhuma solicitação de coleta era processada em produção.

- `src/modules/meta/inline-drain.ts`: `scheduleMetaQueueDrain(service)` agenda com `after()` um `runWorkerBatch` sobre `runOneMetaIntegrationJob` (até 20 jobs, 180 s de orçamento para novos claims). Erros são registrados sem detalhes do provedor/banco. Desligável por `INLINE_COLLECTION_DISABLED=true`.
- Chamado após enfileirar em `requestMissingSnapshotData` (ausentes e atualização) e `requestSeriesData`. `snapshots/page.tsx` exporta `maxDuration = 300` (mesmo valor já aceito pela rota do executor em produção).
- Testes: `tests/inline-drain.test.ts` (4) e asserção em `tests/snapshot-dashboard-actions.test.ts`. `pnpm check`: 72 arquivos, 607 testes, test:db, test:rollout e build aprovados.
- Não homologado: nenhuma coleta real foi executada por este caminho. Primeiro uso real deve ser observado (logs da Vercel, estado dos jobs, snapshot confirmado vs. Ads Manager).

### 5/10/2026 — Homologação real da coleta imediata e da série diária

Evidência (produção, sessão autenticada do responsável, cliente Colégio Crescer, 3 contas, 28/09–04/10/2026):

- "Solicitar dados faltantes" criou 12 jobs (3 contas × 4 níveis); a coleta imediata (`dc08412`) confirmou os 12 em cerca de 1 minuto, sem agendador externo. Análise liberada inteira após confirmação.
- "Solicitar coleta dos dias ausentes" criou 7 jobs diários; todos confirmados. Gráfico ECharts renderizado com 7 de 7 dias.
- Conciliação: soma dos valores usados diários da conta Colégio Crescer (0,00 + 41,21 + 103,00 + 82,54 + 72,79 + 124,45 + 120,12) = R$ 544,11, idêntica ao agregado do período coletado independentemente.
- Não conferido ainda contra o Ads Manager; exportações, comparação e perfis cliente/leitor não testados nesta rodada.

Problemas encontrados na homologação e corrigidos:

- "Resultados" e "Custo por resultado" apareciam como "Indisponível" no nível de conta porque o Meta retornou dois tipos de resultado (cadastro por evento personalizado e conversa por mensagem). A regra de não somar está correta; agora o card lista cada tipo com seu valor e explica que não são somados; o custo explica por que não é calculado. Com um único tipo, o card mostra o nome do resultado. Os indicadores `result:provider:*` saíram da lista geral (eram duplicatas com o mesmo rótulo). Helper testável: `splitSnapshotResultIndicators` em `src/modules/meta/snapshot-view.ts`.
- Ações sem rótulo apareciam com a chave técnica (`action:offsite_complete_registration_add_meta_leads`). `metaMetricLabel` ganhou rótulos para ações observadas e nomes legíveis para eventos personalizados, profundidade de mensagens, prefixos `onsite/offsite/omni` e fallback "Ação Meta: …" (somente quando o chamador não forneceu rótulo próprio).
- Seletor da série mostrava "Result:Provider Known"; agora oferece `primary_results` e `result:provider:*` como "Resultado: …".
- Testes: `tests/snapshot-result-breakdown.test.ts` (4). `pnpm check`: 73 arquivos, 611 testes, test:db, test:rollout e build aprovados.
- Segunda verificação em produção mostrou que o card continuava "Indisponível": o Meta não retorna `results` no nível de conta (payloads brutos: conta `known=0`; campanhas/conjuntos/anúncios `known=1`). No nível de conta, a tela agora soma os resultados nativos das campanhas da mesma conta e período, separadamente por tipo (Decimal exato), somente quando todas as campanhas identificaram seus resultados; custo por resultado só com um tipo. O card informa que o valor é somado das campanhas e não exibe comparação para esse valor derivado. Exportações CSV/JSON/PDF ainda não incluem esse derivado (continuam com o valor armazenado da conta).
- "Cadastros concluídos" duplicado: `action:omni_complete_registration` passa a ser "(todos os canais)".
- `pnpm check`: 73 arquivos, 614 testes aprovados.
- Verificado em produção após `15964e5` (28/09–04/10/2026): Colégio Crescer — R$ 544,11, resultados de tipos diferentes listados separadamente (Cliques no link 1.366; Cadastros concluídos no site 10), custo não calculado; Escola Crescer — 140 visualizações da página de destino, R$ 56,40, R$ 0,40 por resultado; Escola Crescer (Reserva) — sem veiculação, resultados 0. Falta o responsável conferir esses números no Ads Manager com a mesma janela de atribuição.

### 5/10/2026 — Conferência com o Ads Manager (responsável)

O responsável enviou capturas do Ads Manager (28/09–04/10/2026). Contas oficialmente usadas: Colégio Crescer e Escola Crescer; "Escola Crescer (Reserva)" não é usada (continua vinculada; desvincular só com decisão do responsável).

- Colégio Crescer: Ads Manager R$ 544,12, 71.407 impressões, 39.044 alcance, 1.366 cliques no link (R$ 0,19) e 10 cadastros (R$ 27,97), total "Múltiplas conversões". Primeira coleta (11:20) tinha R$ 544,11 e 71.406; após "Atualizar dados" (11:40) os valores ficaram idênticos ao Ads Manager. Diferença era ajuste tardio do Meta, não erro de cálculo.
- Escola Crescer: R$ 56,40, 7.814 impressões, CPM R$ 7,22, 140 visualizações da página de destino (71 + 69), R$ 0,40 por resultado e 3 conversas — idênticos. Alcance: 7.230 (API) contra 7.233 (Ads Manager) mesmo após atualização; alcance é estimado e não aditivo, diferença registrada como limitação conhecida.
- Implementado: custo por tipo de resultado no nível de conta = gasto das campanhas daquele tipo ÷ resultados do tipo (reproduz R$ 0,19 e R$ 27,97). Omitido quando alguma campanha com gasto tem zero ou vários tipos de resultado, porque o gasto não seria atribuível.
- Limitação observada: a série diária não é atualizada por "Atualizar dados" (só o período). Dias recentes podem receber ajustes do Meta; a série de 04/10 continua com a coleta das 11:20.
- `pnpm check`: 73 arquivos, 616 testes aprovados.

### 5/10/2026 — Atualização da série diária

- Botão "Atualizar série" (operadores) no painel de evolução diária: solicita nova coleta de todos os dias do período pelo mesmo RPC de ciclos de atualização (`request_meta_collection_refresh`), um dia por chamada (`requestDailyMetaCollectionRefresh`, até 90). Os snapshots confirmados continuam visíveis até a nova confirmação; a fila é drenada logo em seguida.
- `requestSeriesData` aceita `refresh`; identidades vêm sempre do catálogo autenticado.
- Botões da série ganharam estilo do tema (antes usavam o padrão do navegador).
- Testes: `tests/snapshot-series-actions.test.ts` (3) e 1 em `snapshot-series-loader.test.ts`. `pnpm check`: 74 arquivos, 620 testes aprovados.
- Homologado em produção (`fd6cb90`): "Atualizar série" no Colégio Crescer reenfileirou os 7 dias e confirmou todos; 04/10 passou de R$ 120,12 para R$ 120,13 e a soma diária ficou R$ 544,12, igual ao agregado do período e ao Ads Manager.

### 5/10/2026 — Resultados derivados nas exportações do nível de conta

- `accountCampaignResults(view, conta)` em `snapshot-view.ts` reaproveita a derivação da tela.
- CSV do nível de conta: linhas `tipo_linha = resultado_derivado`, indicador `campaign_results:<chave nativa>` (contagem, regra `soma_das_campanhas_por_tipo`) e `campaign_cost_per_result:<chave>` (moeda, regra `gasto_das_campanhas_do_tipo_dividido_pelos_resultados_6_casas`). Linhas `indicador` armazenadas continuam inalteradas.
- JSON do nível de conta: campo separado `campaignDerivedResults` (nota, regras, resultados por tipo com custo, `primaryResults`, `costPerResult`); `entities` inalterado.
- PDF do nível de conta: seção "Resultados somados das campanhas" com explicação e disponibilidade "Derivado". Verificado com pdfplumber e renderização (`artifacts/snapshot-pdf/account-derived-results.pdf`, fictício).
- Custos derivados (tela e exportações) arredondados a 6 casas, meio para cima: são divisões sem fim exato (antes saíam com até 80 dígitos).
- Não incluído: exportações em modo comparação (CSV/JSON/PDF comparativos continuam só com valores armazenados).
- Testes: `tests/snapshot-derived-export.test.ts` (3). `pnpm check`: 75 arquivos, 623 testes aprovados.

### 5/10/2026 — Homologação da comparação de períodos (produção)

- Colégio Crescer, 28/09–04/10/2026 contra 21/09–27/09/2026: "Solicitar dados do período anterior" criou 12 jobs, todos confirmados pela coleta imediata; análise e comparação liberadas juntas.
- Escola Crescer: valor usado R$ 56,40 contra R$ 2.804,08 (−97,99%), impressões 7.814 contra 368.175, alcance 7.230 contra 160.708, CPM R$ 7,22 contra R$ 7,62 (−5,23%). Colégio Crescer: período anterior com valor usado R$ 0,00 e demais indicadores indisponíveis (sem veiculação); percentual omitido por base zero, como especificado. Números do período anterior ainda não conferidos no Ads Manager.
- Resultados derivados das campanhas não são comparados (card sem "Anterior"); possível melhoria futura.
- Ocorrência intermitente: uma abertura da URL com `compare=previous` logo após o deploy `8f53ca1` caiu no `error.tsx` (erro de Server Component, React #441 no cliente, mensagem oculta em produção). A mesma URL abriu normalmente minutos depois e não se repetiu. Causa não identificada; sem acesso aos logs da Vercel nesta sessão. Se reaparecer, consultar os logs da função pela digest do erro.
- Exportações em produção não baixadas nesta rodada (download exige aprovação do responsável); cobertas por testes unitários com a mesma estrutura de dados.

### 5/10/2026 — Conferência do período anterior e ordenação de entidades

- Ads Manager (responsável), Escola Crescer 21/09–27/09/2026: R$ 2.804,08, 368.175 impressões, CPM R$ 7,62, 25 conversas, 5.731 visualizações da página de destino (3.173 + 2.558) — idênticos à tela. Alcance 161.362 (Ads Manager) contra 160.708 (API), −0,4%. Somado às observações anteriores (Colégio idêntico; Escola 28/09–04/10 −3), alcance é a única divergência: métrica estimada e deduplicada; a API de insights por conta não reproduz necessariamente o total exibido no Ads Manager. Não corrigível por código; documentar para o cliente que alcance pode diferir levemente.
- Diferença de apresentação: com tipos sem veiculação em campanhas sem gasto, o Ads Manager mostra "—" no total; a tela mostra 5.731 e R$ 0,49 porque considera apenas tipos de resultado retornados por campanhas com dados.
- Usabilidade: a lista de entidades (25 por página) mostrava primeiro campanhas com R$ 0,00 e escondia as que gastaram. Agora ordena por valor usado decrescente (Decimal exato; sem valor ao fim, ordem original preservada). A entidade exibida por padrão passa a ser a de maior gasto. Colunas Campanha/Conjunto só aparecem nos níveis em que não repetem o próprio nome.
- `pnpm check`: 75 arquivos, 624 testes aprovados.

### 5/10/2026 — Convite de cliente para a Área do Cliente

- Lacuna encontrada ao preparar a homologação de perfil cliente: "Acesso do cliente" só libera contas já existentes e confirmadas; não havia como a agência convidar um cliente sem conta. Tentativa de liberar silviorm12@gmail.com foi recusada sem efeito (conta inexistente).
- `inviteClientPortalUser` (`src/modules/client-portal/actions.ts`): proprietário/administrador, agência da sessão, cliente ativo da agência; envia `auth.admin.inviteUserByEmail` pela chave de serviço e registra `audit_logs` (`client_portal.invited`). Conta ou convite existente (`email_exists`/`user_already_exists`) não gera novo envio. Erros do provedor não são expostos.
- Fluxo em duas etapas, sem migração: (1) Convidar → e-mail do Supabase com link para `/auth/confirmar` (template documentado em `docs/PUBLICACAO.md`) → definir senha; (2) agência clica em Liberar, que continua exigindo e-mail confirmado no banco. Liberação automática após a confirmação exigiria tabela de convites pendentes (migração), não feita.
- Botão "Convidar" ao lado de "Liberar" no diálogo de acesso.
- Testes: `tests/client-portal-invite.test.ts` (5). `pnpm check`: 76 arquivos, 629 testes aprovados.

### 5/10/2026 — Convite como liberação (migração `202610050001`)

Retorno do responsável após o primeiro convite real (silviorm12@gmail.com): e-mail padrão do Supabase em inglês; o link levava à tela de login; o botão "Liberar" era desnecessário. Mudanças:

- Migração `supabase/migrations/202610050001_client_portal_invitations.sql` (SHA256 `7507e116a388ca9b15de099eb3129b188ae1d0a9cffabab71480dff9d12b51bf`): tabela `client_portal_invitations` (sem acesso direto; RLS ativo) e RPCs `invite_client_portal_user`, `accept_client_portal_invitations`, `revoke_client_portal_invitation`, `list_client_portal_invitations`. Convite pendente por 7 dias, um por e-mail/cliente, reenvio substitui, auditoria em `audit_logs`. O aceite só ocorre para conta com e-mail confirmado igual ao convidado; cria ou reativa `client_users`. 24 verificações pgTAP em `supabase/tests/client-portal-invitations.test.sql`.
- **Migração ainda não aplicada no Supabase de produção.** Até ser aplicada, "Convidar" mostra que a atualização do banco precisa ser aplicada; o resto do site não depende dela (a listagem trata a ausência).
- `inviteClientPortalUser`: registra o convite e envia convite de conta (sem conta confirmada) ou link de acesso (`signInWithOtp`, sem criar usuário) para conta existente ou já convidada; se o e-mail falhar, o convite é cancelado. Botão "Liberar" removido; lista mostra convites pendentes com "Cancelar"; "Revogar/Reativar" de acessos existentes mantidos.
- Aceite automático: login por senha, definição de senha, `/auth/confirmar` (tipos `invite`, `recovery`, `magiclink`, `email`) e página `/sem-acesso`.
- Link do modelo padrão do Supabase: `LinkSessionHandler` em `/entrar` lê `#access_token`/`#refresh_token`, limpa o endereço e chama `establishLinkSessionAction`, que valida com `setSession` no servidor, aceita convites e leva convites/recuperação a "Defina sua senha".
- Corrigido: usuário somente cliente que entrava pelo login caía em "Falta vincular seu espaço de trabalho"; `/sem-acesso` agora envia quem tem acesso de cliente para `/cliente`.
- Modelos de e-mail em português: `docs/EMAIL_TEMPLATES.md` (aplicação no painel do Supabase pendente). SMTP padrão do Supabase tem limite baixo de envios; recomendado SMTP próprio.
- Testes: `tests/client-portal-invite.test.ts` (8), `tests/auth-link-session.test.ts` (3). `pnpm check`: 77 arquivos, 635 testes, test:db (inclui os 24 novos), test:rollout e build aprovados.

### 5/10/2026 — Homologação do convite em produção e senha obrigatória

- Migração `202610050001` aplicada no SQL Editor de produção pelo responsável (conteúdo conferido no editor: SHA256 `7507e116…` igual ao arquivo). Verificação: tabela existe; as quatro RPCs existem e negam a chave de serviço (42501), como projetado.
- Modelos de e-mail: o painel do Supabase só permite editar modelos com SMTP próprio configurado ("Set up custom SMTP to edit templates"). Sem SMTP, os e-mails seguem no modelo padrão em inglês; o site trata o link do modelo padrão. `docs/EMAIL_TEMPLATES.md` fica pronto para quando houver SMTP.
- Homologado: convite para silviorm12@gmail.com (conta já criada pelo primeiro convite) enviou link de acesso; ao abrir, o responsável entrou na Área do Cliente; convite aceito às 16:33 UTC, vínculo ativo com `created_by` da agência, auditoria `client_portal.invited` e `client_user.granted`.
- Problema encontrado: a conta entrou sem nunca ter criado senha. Correção: `password-state.ts` marca `app_metadata.password_set` ao definir a senha (chave de serviço); contas com `invited_at` sem a marca são enviadas a "Defina sua senha" ao entrar por link e ao abrir `/cliente`. Conferido em produção que só a conta convidada tem `invited_at` (agência e cliente existente não são afetados). Título da página de senha: "Seu acesso".
- `pnpm check`: 78 arquivos, 639 testes, test:db, test:rollout e build aprovados.
- Senha mínima reduzida de 12 para 8 caracteres a pedido do responsável (`passwordSchema`, formulário e `docs/INTEGRACOES.md`). Supabase Auth do projeto exige mínimo 6 (`PASSWORD_MIN_LENGTH=6`, conferido no painel sem alteração), então o limite efetivo é o do site.

### 5/10/2026 — Dashboard principal: veiculação e aviso de carregamento

- Relato do responsável: "PROCESSO SELETIVO" e "PROCESSO SELETIVO 2" (conta Escola Crescer) apareciam como em veiculação, mas a conta parou de veicular por falha de pagamento. Confirmado: `meta_ad_accounts.account_status = 3` (UNSETTLED) para Escola Crescer; o Meta mantém `effective_status = ACTIVE` nas campanhas nesse caso.
- `metaAccountDelivers` em `src/modules/meta/delivery.ts`: somente 1 (ACTIVE) e 9 (IN_GRACE_PERIOD) veiculam; outros status marcam campanhas, conjuntos e anúncios como INACTIVE. `getMetaEntityStatuses` lê o status da conta ao vivo (`getAdAccount`) e usa o último sincronizado se a leitura falhar; status desconhecido não bloqueia.
- Removido o aviso visível "Carregando conjuntos e anúncios deste período…" na aba de campanhas; mantido anúncio apenas para leitores de tela.
- Teste novo em `tests/meta-delivery.test.ts`. `pnpm check`: 78 arquivos, 640 testes aprovados.
- Homologado (responsável, conta silviorm12@gmail.com): criação de senha com 8 caracteres funcionou; `app_metadata.password_set = true` confirmado no Auth de produção.

### 5/10/2026 — Incidente: banco de produção sobrecarregado (dashboard principal, 3 meses)

- Sintoma: cliente em 3 meses (07/07–04/10) via "Aguardando a análise completa" sem indicação de atividade; depois "a Meta ainda não confirmou os agregados".
- Causa nos logs da Vercel: tempo limite de instrução no Postgres (`57014`) em `client-analytics-rpc` (90 dias) e nas leituras/gravações de `meta_dashboard_scopes` ("Não foi possível validar/preservar os agregados"). Projeto Supabase em compute **Nano** (t4g.nano). Às ~15:05 o Supabase passou a responder 522 até a consultas triviais (indisponível). Contribuíram: cada abertura da página fazia 3–4 leituras `get_client_analytics`; a tela repetia ação + nova renderização a cada 30 s sem limite; uma leitura diagnóstica de todos os payloads de `meta_dashboard_scopes` (interrompida por tempo esgotado).
- Correções (código):
  - `getFreshClientAnalytics` aceita a leitura já feita pelo chamador (`initial`) e não repete a leitura quando o cache do agregado ainda vale (`refreshMetaDashboardScope` sinaliza `cached`). A página do cliente passa a leitura existente.
  - Tentativas automáticas com espera crescente (30 s, 1, 2, 4 min; máx. 10 min) e pausa após 4 falhas seguidas; tentativa com falha não força nova renderização. O aviso mostra "Consultando agora…", horário da próxima e da última tentativa, ou pausa com botão "Tentar novamente".
- Pendente: otimizar `get_client_analytics` para 90+ dias e o tamanho dos payloads de `meta_dashboard_scopes` (leitura de todos excedeu 3 min); avaliar compute maior no Supabase; recuperação do banco (reinício do projeto exige decisão do responsável).
- `pnpm check`: 78 arquivos, 643 testes aprovados.

### 5/10/2026 — Medição e otimização do dashboard principal (plano gratuito)

Ferramentas novas (locais, PGlite com todas as migrações):
- `pnpm bench:analytics [clientes] [contas] [campanhas] [dias] [--legacy] [--split]` (`scripts/analytics-bench.mjs`): dados sintéticos no formato de produção (metadados v11 com ~105 valores canônicos, 15 ações por linha, cache de agregados com ~1.100 entidades por conta). `--legacy` mede sem as migrações de 5/10; `--split` separa montagem principal, leitura do cache e enriquecimento. PGlite é WASM de uma thread: comparar tempos entre si, não como latência de produção.
- `pnpm check:analytics-equivalence` (`scripts/analytics-values-equivalence.mjs`): 400 entradas aleatórias de `private.analytics_values` e as quatro RPCs do dashboard (30 dias, 60 dias com uma conta, campanhas selecionadas, hierarquia) em dois bancos idênticos, antes e depois. Resultado: 0 diferenças; as quatro respostas idênticas.

Medições (1 cliente, 3 contas, 4 campanhas, ~400 dias, cache de 3,2 MB por período):
- Antes: 30 dias 1,27 s · 90 dias 2,75 s · 180 dias 5,95 s · 365 dias 9,31 s.
- Depois das migrações 0002+0003: 0,99 s · 2,71 s · 4,73 s · 6,20 s (~30% menos CPU nos períodos longos).
- Divisão (365 dias): montagem principal ~6,0 s; leitura do cache ~0,27 s; enriquecimento ~0,3 s. Cada soma diária custa 1–3 ms e roda uma vez por dia dos dois períodos.
- Produção trava em 90 dias apesar de ~2,7 s locais: compute Nano (t4g.nano) é de CPU com créditos; as repetições a cada 30 s esgotaram os créditos.

Migrações (aplicadas em produção em 5/10/2026 pelo responsável, SQL Editor, numa transação; conteúdo conferido no editor: SHA256 `028066e0…` e `2a19c606…`; verificação posterior confirmou as quatro funções atualizadas; dashboard de 30 dias do Colégio Crescer abriu normalmente em ~2 s):
- `202610050002_analytics_values_single_pass.sql`: `analytics_values` com um agregado por grupo de indicadores (mesmo contrato).
- `202610050003_analytics_canonical_once.sql`: expansão canônica uma vez por linha (`canonical_daily_row` idempotente; `client_analytics_base` e `campaign_analytics_base` reescritas por substituição com verificação de versão — falham sem aplicar se o texto não corresponder).

Código (publicado):
- Cache de agregados sem a cópia de `values` em `entityCatalog` (não lida por ninguém; reduz cada registro ~pela metade) e remoção, a cada gravação, dos registros do cliente com mais de 2 horas (só são servidos por 1 hora).

Espaço em produção (5/10, consulta leve): banco 103 MB de 500 MB; `meta_daily_actions` 39 MB (99 mil linhas); `meta_dashboard_scopes` 28 MB (13 linhas); `meta_daily_insights` 20 MB (10,8 mil linhas). Espaço é o limite que chega primeiro no plano gratuito. Próximo candidato: ações diárias duplicam valores já presentes em `metadata.canonical_values` (v11) e cada linha carrega ~4,5 KB de metadados.

### 5/10/2026 — Resultado pronto por período (migração `202610050004`, aplicada em produção pelo responsável em 5/10)

- Arquitetura registrada no adendo de 5/10/2026 do `docs/PLANEJAMENTO_V1.md` (carga inicial, janela de revisão, leitura pronta, retenção).
- `private.client_analytics_cache` guarda o resultado de cada período (cliente, datas, contas). `private.client_analytics_base` passa a ser o cache: confere período, autorização e contas antes de qualquer leitura guardada (casos inválidos seguem para o cálculo, que gera os mesmos erros), calcula a impressão digital e devolve o resultado guardado se ela coincidir; senão chama `private.client_analytics_compute` (o cálculo anterior, renomeado), guarda e apaga períodos do cliente sem uso há 3 dias.
- Impressão digital: `ctid`+`xmin` das linhas diárias e ações do intervalo (inclui período anterior), texto completo das tabelas pequenas (execuções de coleta, alcance por período, configuração de resultado, contas e vínculos, conexões, definições de métricas) e o código-fonte das funções de cálculo (migração futura que mude o cálculo invalida tudo).
- `public.get_client_analytics` passou a VOLATILE (PostgREST executa funções STABLE em transação só leitura). Em transação só leitura o resultado é devolvido sem ser guardado (verificado).
- Testes: `supabase/tests/client-analytics-cache.test.sql` (10: guarda, mesmo resultado do cálculo, segunda leitura, alteração/remoção/configuração recalculam na mesma transação, sem vínculo é negado, cliente autorizado, conta de outro cliente rejeitada, tabela não exposta). Equivalência antes/depois: 400 casos + 4 RPCs idênticos.
- Medição (1 cliente, 3 contas, ~400 dias): primeira abertura 1,1 s / 2,7 s / 5,2 s / 6,8 s (30/90/180/365 dias); aberturas seguintes 0,24 s / 0,30 s / 0,38 s / 0,47 s.
- SHA256 do arquivo: `24d338973e9e1e99…`. `pnpm check`: 78 arquivos, 643 testes, test:db, test:rollout e build aprovados.
- Verificado em produção: tabela e funções criadas, `get_client_analytics` volátil; após abrir o dashboard de 30 dias do Colégio Crescer, 2 períodos guardados (46 kB cada) e a segunda abertura não recalculou (horário do cálculo inalterado).
- Validação do cache de agregados do Meta passou a ler só data, versão e tipos de ação (antes baixava o registro inteiro, até ~3 MB): abertura repetida do dashboard de 30 dias caiu de ~5,7 s para ~3,5 s (página completa, navegador).

### 5/10/2026 — Atualização diária automática (janela de revisão)

- `src/modules/meta/daily-refresh.ts`: `planMetaRefreshWindows` (últimos 7 dias completos todo dia; dias 8–28 às segundas; dia de referência em America/Sao_Paulo) e `runDailyMetaRefresh` (clientes ativos com conexão Meta e contas vinculadas, do menos recentemente atualizado para o mais; orçamento de tempo; falha de um cliente não interrompe os demais; autor nulo nas execuções automáticas).
- `GET /api/cron/meta-daily` (Vercel Cron em `vercel.json`, `0 9 * * *` = 06:00 de Brasília) protegido por `Authorization: Bearer CRON_SECRET`; sem a variável responde 503. `CRON_SECRET` criada pelo responsável nas variáveis de produção da Vercel em 5/10 (valor não registrado).
- Dashboard deixa de recoletar a cada hora: `ANALYTICS_REFRESH_MS` = 26 h (coleta automática só se faltar dia ou se a última coleta tiver mais de 26 h). Agregados exatos do Meta valem 24 h (`META_ANALYTICS_MAX_AGE_MS` e migração `202610050005_dashboard_scope_daily_validity.sql`, SHA256 `89d20a86a15dd6ce…`, aplicada em produção em 5/10 e verificada); continuam invalidados por qualquer coleta mais nova.
- Testes: `tests/meta-daily-refresh.test.ts` (6), `tests/meta-daily-cron-route.test.ts` (2); `metric-integrity.test.sql` passa a provar a expiração com 25 h. `pnpm check`: 80 arquivos, 651 testes, test:db, test:rollout e build aprovados.

### 5/10/2026 — Retenção por nível (plano gratuito)

- `META_DETAIL_RETENTION_DAYS = 180` (`src/modules/meta/analytics-contract.ts`): linhas diárias e ações de conjuntos e anúncios com mais de 180 dias são removidas por `pruneMetaHistory` (`src/modules/meta/retention.ts`), conta a conta, no job diário após a atualização (falha da retenção não esconde o resultado da atualização). Contas e campanhas mantêm histórico completo. A coleta deixa de buscar conjuntos/anúncios para fatias anteriores ao corte.
- Agregados exatos (`meta_dashboard_scopes`) com mais de 48 h são removidos para todos os clientes.
- Impacto medido em produção (5/10, contagem): 3.336 linhas de conjunto/anúncio anteriores a 180 dias (ad 2.391 de 5.428; adset 945 de 3.008), ~31% das linhas diárias, além das ações correspondentes. Primeira execução: próximo disparo do agendamento (06:00).
- Detalhe de conjuntos/anúncios de períodos antigos continua disponível pelo agregado exato do Meta (consultado por período); só a reserva diária local deixa de existir para esses períodos.
- Não feito: deduplicação de `meta_daily_actions` x `metadata.canonical_values` (exige mudar a lista de tipos de ação do cálculo; avaliar com o teste de equivalência antes).
- Testes: `tests/meta-retention.test.ts`, `tests/meta-daily-cron-route.test.ts` (3). `pnpm check`: 81 arquivos, 653 testes aprovados.

