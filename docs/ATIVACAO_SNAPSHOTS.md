# Ativação da estrutura de snapshots

## Alvo e estado conferidos

Projeto existente: `qlopniyghvpbgwxuwxrl`, iGrow Reports, branch `main` Production. Em 4 de outubro de 2026, o inventário SQL somente de leitura confirmou que `clients`, `client_users`, `integrations`, `meta_connections`, `meta_ad_accounts` e `client_ad_accounts` existem, os três papéis Supabase existem e os helpers de autorização da agência/cliente existem. As quatro tabelas `integration_collection_jobs`, `integration_raw_payloads`, `integration_snapshots` e `integration_provider_health` estão ausentes. As funções novas consultadas também estão ausentes. Esse resultado permite preparar uma instalação nova da ingestão; não indica necessidade de recriar a plataforma ou seus clientes.

## Aplicação confirmada em produção

Em 4 de outubro de 2026, após autorização explícita do responsável, o pacote das migrations `202610040001` a `202610040013` foi executado integralmente no SQL Editor do projeto acima. SHA256 do arquivo aplicado: `495ae0b36280c8e73d13ac77f05b1597e0c714f3ada77318f5cd53f17a11c0ab`. O conteúdo copiado do editor foi comparado com o arquivo aprovado antes da execução, normalizando apenas as quebras de linha.

O diagnóstico independente após a aplicação retornou `checked = 33`, `failed = 0`, `schema_ready = true`. A consulta HTTP somente de leitura a `integration_snapshots`, com `limit=0`, retornou 200. A chamada ao catálogo sem identidade de usuário retornou 403 / `42501`, e não `PGRST202`: a função já está disponível no cache da API e continua protegida. Essa chamada não equivale à homologação com usuário autenticado autorizado e usuário de outro cliente.

Comprovantes locais: `artifacts/snapshot-rollout/production-install.png` e `production-readiness.png`. O inventário descrito na seção anterior registra o estado antes da aplicação; a estrutura de ingestão agora existe. Não foi criado backup nesta execução nem registrado histórico CLI. Não foram configurados segredo do executor ou agendamento, nem disparadas coletas reais da Meta. A homologação autenticada e a ativação operacional do executor permanecem pendentes; o dashboard principal continua com sua fonte anterior.

## Preparar e revisar

Executar `pnpm prepare:snapshot-rollout` na revisão que será aplicada. O comando não se conecta ao banco, não carrega arquivos de ambiente e gera:

- `artifacts/snapshot-rollout/install.sql`: sequência exata das 13 migrations `202610040001` a `202610040013`, com os conteúdos originais.
- `artifacts/snapshot-rollout/manifest.json`: SHA256 de cada fonte, do diagnóstico e do pacote gerado.

O gerador rejeita uma sequência incompleta, ampliada ou fora de ordem, além de migrations com controle transacional próprio. Preparar novamente depois de qualquer alteração das fontes e conferir o novo hash. Não editar o SQL gerado para contornar uma pré-condição.

O pacote é específico para a ausência integral da estrutura de ingestão. Abre uma transação, usa limite de espera de lock de cinco segundos, limite de execução por comando de dois minutos e lock consultivo compartilhado entre execuções deste pacote. Antes da primeira alteração, confere dependências e bloqueia tabelas/funções de ingestão já existentes. Não oferece atualização de instalação parcial nem reparação automática de histórico CLI.

Após executar as migrations, verifica os 33 requisitos do diagnóstico. Se alguma etapa ou a verificação final falhar, a transação não confirma as alterações. A notificação de recarga do schema PostgREST só é entregue no commit bem-sucedido. Preserva dados das tabelas anteriores; a migration de catálogo amplia apenas os provedores admitidos pela restrição de `integrations`.

## Aplicação operacional

Confirmar o projeto alvo e disponibilidade de backup antes da execução. Executar o arquivo completo pelo operador, sem dividir em blocos ou executar migrations antigas de novo. Se o cliente SQL mantiver uma transação abortada após erro, executar `rollback` nessa sessão antes de continuar o diagnóstico. Uma segunda aplicação é bloqueada; o operador deve conferir o resultado original, sem apagar tabelas para liberar o pacote.

Reexecutar `supabase/diagnostics/snapshot-readiness.sql`, esperar atualização do cache e homologar a rota autenticada por snapshots. Consultar com operador autorizado e com um usuário sem acesso ao cliente, verificando leitura permitida/negada. Aplicação do schema não configura `INTEGRATION_WORKER_SECRET`, não provisiona agendamento, não coleta da Meta, não cria fixtures de cliente e não substitui a fonte do dashboard principal.

O pacote não escreve em `supabase_migrations.schema_migrations`. O histórico CLI permanece uma etapa separada: só registrar revisões comprovadamente aplicadas depois de comparar a instalação existente. Não usar um histórico vazio como autorização para reaplicar toda a fundação.

## Validação automatizada

`pnpm test:rollout` instala primeiro as migrations anteriores à ingestão em PGlite descartável e cria um cliente fictício preexistente. Testa pré-requisito ausente, instalação parcial, erro tardio após criação dos objetos, grant indevido detectado pela pós-validação, instalação completa e reaplicação bloqueada. Compara o cliente integralmente antes/depois das operações e executa as 497 verificações SQL/RLS sobre o banco instalado pelo pacote. Nenhuma fixture é enviada ao banco real.

`pnpm check` inclui essa verificação além da instalação individual de migrations. Os dois caminhos devem passar. PGlite não substitui backup, validação HTTP/PostgREST ou homologação concorrente no Supabase real.
