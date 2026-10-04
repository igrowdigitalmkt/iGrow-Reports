# Operação da fundação

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

A fundação persiste auditoria de bootstrap, alterações de equipe e operações de convite executadas pelas RPCs. As etapas seguintes precisam ampliar a cobertura para mudanças de clientes, integrações, agendamentos, versões e entregas. Auditoria de negócio e logs de aplicação têm finalidades distintas.

A rota `/api/health` informa somente que a aplicação responde. Ela não verifica disponibilidade do Supabase, validade de credenciais, migrations ou integrações. O HTTP 200 desse endpoint não comprova que a plataforma está operacional.

A automação ainda precisa acrescentar logs estruturados sanitizados, correlação entre ocorrência/job/relatório/entrega e alertas. Sentry, verificações de dependências e telas de recuperação operacional não estão implantados. Retries de envios não podem ser iniciados por simples atualização da página.

Antes do piloto, documentar consentimento, retenção, exportação/exclusão, backups e restauração testada. Não há declaração automática de conformidade à LGPD. O piloto precisa usar conta e destinatário autorizados e conferir relatório web, PDF, eventos, link, expiração e revogação.
