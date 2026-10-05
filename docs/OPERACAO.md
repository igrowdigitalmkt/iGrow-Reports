# Operação da fundação

## Executor Meta e ciclos de atualização

Aplicar migrations até `202610040013_collection_refresh_cycles.sql` antes de usar o executor e `Atualizar dados` da análise por snapshots. Configurar `INTEGRATION_WORKER_SECRET` somente no servidor e no chamador autorizado: token aleatório de 32 a 256 caracteres usando letras/dígitos/`_`/`-`. O endpoint aceita somente POST com `Authorization: Bearer <token>`, sem token em URL. Configuração ausente retorna 503; autorização inválida retorna 401. Nenhum segredo foi gerado ou salvo por este incremento.

O endpoint `/api/workers/meta` executa até quatro jobs em sequência e não começa outro claim após quatro minutos. Um job já iniciado pode exceder esse orçamento; `maxDuration=300` depende do plano de hospedagem e não substitui limite de paginação/coleta. Se o processo for interrompido, a lease de quinze minutos continua permitindo retomada por uma próxima execução. O endpoint não provisiona cron/QStash, não aceita assinatura QStash como substituta do token e não deve ser anunciado como operacional até homologação no ambiente real.

O retorno contém ID de execução, número de jobs processados e motivo de parada (`empty`, `job_limit` ou `time_budget`). Processado não significa confirmado: falhas de provedor podem ser tratadas pelo worker e contabilizadas. Falhas de infraestrutura retornam 500 com mensagem sanitizada e interrompem novos claims; finalizações anteriores persistidas não são revertidas. O claim Meta ignora jobs de outros provedores mesmo quando eles têm prioridade maior.

`Atualizar dados` revalida `canCollect` e reconstitui o período/contas por leitura autenticada. Uma RPC exclusiva de serviço insere escopos ausentes e recoloca jobs confirmados/falhos na fila atomicamente. Jobs já queued/collecting/partial são preservados, inclusive o backoff. A tentativa vitalícia nunca é zerada: `retry_epoch_attempt` cria um orçamento de retries por ciclo. Snapshots confirmados anteriores permanecem acessíveis enquanto a atualização é coletada. Solicitações repetidas durante fila/coleta não reiniciam jobs; uma nova solicitação após estado terminal inicia outro ciclo. A atualização não garante que snapshots de níveis distintos pertençam à mesma geração transacional.

## Homologação da análise por snapshots

A rota `/cliente/[clientId]/snapshots` requer as migrations até `202610040012_snapshot_account_catalog.sql` e `META_GRAPH_API_VERSION`. O acesso usa a sessão autenticada; nem a tela nem suas consultas automáticas usam a credencial Meta. Um link no dashboard em modo agência preserva o período/contas selecionados. A fonte do dashboard principal continua sendo a anterior.

O loader exige snapshots dos quatro níveis para cada conta selecionada no contrato 3 e API configurada. Ausência de qualquer escopo, divergência de gasto entre conta/campanhas ou hierarquia órfã bloqueia a análise inteira. Snapshots antigos permanecem disponíveis como `stale`. Moedas e fusos são comparados ao catálogo autorizado; não há agregação automática entre contas. Consultas separadas não garantem uma geração transacional única. Os gastos de conjuntos/anúncios ainda não são reconciliados com os subtotais de seus pais.

`Solicitar dados faltantes` é reservado aos operadores com permissão de coleta. A ação reconstrói o escopo por consultas autenticadas e registra jobs por um único upsert de serviço. Jobs já existentes são preservados, inclusive claims vigentes e estados terminais. Repetir a solicitação não reinicia jobs confirmados/falhos nem gera uma nova versão. Sem executor, a solicitação permanece na fila; a consulta automática somente verifica a disponibilidade. Provisionar/homologar o executor separadamente antes de disponibilizar esse fluxo operacionalmente. Este incremento não instala cron, não executa coleta real nem aplica migrations remotas.

Esta entrega é uma base de desenvolvimento. Não existe implantação operacional, coleta Meta, geração de PDF, envio WhatsApp ou agendamento QStash validado. O acompanhamento do que foi executado fica em [IMPLEMENTACAO.md](IMPLEMENTACAO.md).

## Execução e diagnóstico

Siga o [README](../README.md) para instalar e iniciar. A rota `/demo` permite revisar a interface sem credenciais. `/entrar` e `/dashboard` devem informar configuração ausente quando o Supabase não estiver disponível, sem usar fixtures como dados reais.

| Sintoma | Verificação |
| --- | --- |
| Supabase não configurado | Preencher as variáveis públicas de `.env.local` e reiniciar o processo |
| Login recusado | Conferir email, senha, confirmação e estado do usuário no projeto Supabase correto |
| Usuário sem agência | Executar o bootstrap controlado ou conferir associação existente em `agency_users` |
| Falha ao consultar contexto | Conferir migration, schema, permissões e disponibilidade; preservar o erro como falha |
| Sessão não persiste | Conferir cookies, HTTPS no ambiente publicado e URL do projeto |
| Dependências divergentes | Usar a versão de pnpm do `packageManager` e instalar com `--frozen-lockfile` |
| Integração “Não configurado” | Estado esperado: os adaptadores futuros ainda não estão implementados |

Nunca publicar `.env.local`, senhas, cookies ou tokens em issues, logs ou screenshots. Um problema de permissão deve ser investigado com a sessão do usuário e o contexto da agência; trocar o CRUD pela chave privilegiada desativa a proteção que precisa ser validada.

## Banco

[BANCO.md](BANCO.md) é o procedimento para criar o ambiente local, aplicar migrations, executar pgTAP e cadastrar o primeiro proprietário. `pnpm test:db` aplica as migrations e executa a suíte em PostgreSQL WASM/PGlite, sem Docker. O resultado exercita SQL e RLS com estruturas mínimas de Auth/Storage; não substitui a homologação dos serviços Supabase e dos cenários concorrentes.

Antes de homologação, verificar duas agências distintas, usuário sem associação, leitor e editor. Confirmar também proteção do último proprietário e rejeição de relações entre agências. Não aplicar comandos de reset em bancos com dados a preservar.

## Vercel — preparação, sem deploy realizado

O roteiro atualizado da primeira instalação está em [PUBLICACAO.md](PUBLICACAO.md). O build da Vercel verifica as variáveis com `pnpm check:deploy`; o GitHub possui workflow de qualidade preparado, ainda não executado remotamente.

1. Conectar um repositório autorizado e selecionar o projeto Next.js.
2. Usar Node.js e pnpm compatíveis com `package.json`; instalar pelo lockfile e executar `pnpm build`.
3. Configurar variáveis separadas para Preview e Production. Não reutilizar o banco de produção nas previews.
4. Aplicar a migration no Supabase de homologação e configurar usuários/associações pelo procedimento controlado.
5. Conferir HTTPS, cookies, login, logout e isolamento com usuários reais de teste antes de liberar acesso.
6. Só promover após critérios de homologação cumpridos. Registrar URL, ambiente, revisão do código e migrations aplicadas.

O App Router pode ser implantado como servidor Next.js; uma exportação estática não atende à autenticação SSR desta aplicação. Consulte as [opções oficiais de deployment](https://nextjs.org/docs/app/getting-started/deploying). Custos, limites de Functions, região, backups e políticas de retenção precisam ser definidos no ambiente escolhido.

## Operação futura

### Recuperação de coletas interrompidas

A migration `202610040008_worker_leases.sql` deve ser aplicada antes de habilitar o worker atualizado. Ela disponibiliza RPCs no schema público com execução exclusiva de `service_role`; o schema privado permanece oculto. A assinatura de finalização passa a exigir `p_attempt_count`, e a persistência usa `persist_integration_collection_result`.

Cada reivindicação dura quinze minutos a partir de `started_at`. Ao chamar `claim_integration_collection_job`, o executor também pode receber um job abandonado com claim expirado. O banco incrementa `attempt_count` e mantém o mesmo identificador/idempotência do job. Jobs confirmados, com falha terminal ou superseded não são recuperados automaticamente; retries parciais respeitam `next_attempt_at`.

Persistência e finalização exigem a tentativa atual ainda vigente. Uma tentativa expirada recebe SQLSTATE `40001` e não pode sobrescrever a retomada. Payloads e snapshot são gravados na mesma transação sob bloqueio do job, com um snapshot por tentativa. Repetir a gravação da mesma tentativa vigente retorna o snapshot existente sem duplicar payloads.

Não há heartbeat de extensão do claim: dividir coletas longas em jobs que terminem dentro de quinze minutos. A recuperação depende de novas chamadas ao executor; esta migration não provisiona um cron ou serviço de execução. Antes de habilitar em produção, aplicar em homologação e exercitar interrupções e dois workers concorrentes no Supabase real. Os testes PGlite verificam retomada e rejeição de workers antigos em sequência, sem simular concorrência entre sessões.

A migration `202610040009_collection_identity.sql` deve ser aplicada em seguida, antes de habilitar o worker atualizado. A resposta do claim inclui `api_version` e `contract_version`; o worker conserva esses valores em cada retry. O enfileiramento usa exclusivamente `identity.clientId`, também usado na chave de idempotência. O banco rejeita snapshots cujo cliente, provedor, conta, período ou nível não correspondam ao job e exige que cada métrica normalizada corresponda também à conexão. Uma rejeição desfaz a gravação dos payloads na mesma transação. Essa verificação compara o resultado ao job; a autorização da conexão e da conta continua sendo responsabilidade do fluxo que cria os jobs e do adaptador.

A migration `202610040010_meta_collection_scope.sql` acrescenta autorização operacional da Meta no banco. Aplicá-la antes de habilitar o worker atualizado. O servidor chama `authorize_integration_collection_job` com o job e a tentativa: o retorno identifica a integração para monitoramento. Cliente, conexão e conta devem pertencer à mesma agência; a conexão pertence ao cliente, a conta deve estar vinculada e ativa, a integração conectada e o cliente/conta sem arquivamento. A criação do snapshot repete a verificação para impedir persistência após revogação. `42501` é uma negativa de autorização; outros erros não devem ser convertidos em revogação. Jobs de outros provedores ainda podem existir como fundação ou fixtures, mas a autorização operacional os recusa até implementação de seu modelo de acesso. Essa proteção não conecta automaticamente a fila ao coletor Meta atual nem provisiona o executor.

O ponto de entrada `runOneMetaIntegrationJob(service)` está em `src/modules/meta/job-worker.ts` e exige cliente Supabase de serviço somente no servidor. Retorna `false` quando não há job e `true` após processar um job. Erros de infraestrutura/finalização continuam sendo propagados ao executor. O adaptador usa `MetaClient.getPeriodInsights` com a API do job, credencial criptografada da conexão e contrato normalizado 1; contratos diferentes são recusados antes de carregar credenciais. O contrato coleta escalares básicos e ações/valores nativos por entidade, sem promover essas ações a resultado principal. Uma resposta vazia completa é registrada sem inventar métricas.

Antes de habilitar o executor, aplicar as migrations até `202610040010`, verificar a chave de criptografia, vínculo/credencial Meta e a versão da API dos jobs, e homologar a consulta com uma conta autorizada. O adaptador persiste em `integration_snapshots`; as projeções do dashboard ainda usam a coleta anterior. Não ativar uma execução periódica presumindo que ela já atualiza essas projeções. Este incremento não registra endpoint HTTP, cron ou envio externo.

Após aplicar `202610040011_confirmed_collection_read.sql`, a leitura `readConfirmedCollectionSnapshot(client, identity)` deve receber o cliente Supabase da sessão autenticada. A RPC verifica acesso ao cliente e consulta o último confirmado da identidade exata, inclusive API/contrato. O DTO contém somente ID, atualização e métricas, sem payloads brutos. Dados com mais de uma hora permanecem disponíveis com estado `stale`; não são substituídos por zeros ou por uma tentativa parcial mais recente. Erros de acesso/banco e snapshots inválidos são propagados, não convertidos em estado vazio. A camada não agrega entidades, contas ou níveis, e sua ligação às telas permanece pendente de completar o contrato de métricas.

Novos jobs Meta criados pelo helper usam contrato 2, com resultados nativos e CPM/CPC/CTR/custo por resultado calculados por entidade. O adaptador também aceita contrato 1 e conserva seu conteúdo anterior; consultas do contrato 2 não reutilizam snapshots do contrato 1. Esta ampliação não exige nova migration. Resultados de tipos distintos ou de janelas alternativas não devem ser somados. A projeção conserva unidades e regras de agregação; `same_indicator` exige verificar o tipo nativo antes de qualquer total. Resultados ausentes não são preenchidos com ações secundárias e denominadores zero produzem indisponibilidade. A versão normalizada 2 é independente da versão analítica v11 do dashboard atual.

O helper agora cria jobs Meta no contrato 3. O adaptador aceita contratos 1, 2 e 3, mantendo a leitura por identidade e versão exatas. O contrato 3 acrescenta nomes e vínculos de hierarquia congelados no snapshot; conjuntos exigem campanha e anúncios exigem campanha/conjunto. A projeção rejeita vínculos incompatíveis e metadados divergentes para a mesma entidade. Snapshots anteriores permanecem intactos. Não há nova migration para esses campos JSON; a ligação aos filtros do dashboard permanece pendente.

A fundação persiste auditoria de bootstrap, alterações de equipe e operações de convite executadas pelas RPCs. As etapas seguintes precisam ampliar a cobertura para mudanças de clientes, integrações, agendamentos, versões e entregas. Auditoria de negócio e logs de aplicação têm finalidades distintas.

A rota `/api/health` informa somente que a aplicação responde. Ela não verifica disponibilidade do Supabase, validade de credenciais, migrations ou integrações. O HTTP 200 desse endpoint não comprova que a plataforma está operacional.

A automação ainda precisa acrescentar logs estruturados sanitizados, correlação entre ocorrência/job/relatório/entrega e alertas. Sentry, verificações de dependências e telas de recuperação operacional não estão implantados. Retries de envios não podem ser iniciados por simples atualização da página.

Antes do piloto, documentar consentimento, retenção, exportação/exclusão, backups e restauração testada. Não há declaração automática de conformidade à LGPD. O piloto precisa usar conta e destinatário autorizados e conferir relatório web, PDF, eventos, link, expiração e revogação.
