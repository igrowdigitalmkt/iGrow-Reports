# Guia de continuidade — iGrow Reports

Atualizado em 5 de outubro de 2026. Responsável: Silvio Melo, iGrow Digital.
Este documento transfere o contexto entre assistentes, incluindo Codex e Claude. Leia-o antes de implementar. O histórico das conversas não é compartilhado automaticamente; o repositório e estes registros são a fonte de continuidade.

## 1. Objetivo completo

Construir uma plataforma de relatórios de performance para a iGrow e, futuramente, outras agências, com isolamento entre organizações. O gestor deve conectar Meta Ads, cadastrar clientes e contas, selecionar resultados e métricas, coletar campanhas/conjuntos/anúncios, comparar períodos, validar números, gerar relatórios web/PDF, revisar/aprovar quando configurado, entregar por WhatsApp e acompanhar eventos e falhas. A operação deve ser repetível por agendamento, rastreável e recuperável.

A Área do Cliente autenticada é central: cada cliente acessa apenas os próprios indicadores, filtros, evolução e histórico, sem configurações internas da agência. A V1 termina quando o fluxo inteiro funciona com dados reais, usuários autorizados e agendamento, incluindo entrega e acompanhamento. Código, fixtures e testes locais isoladamente não significam conclusão.

O escopo integral está em `docs/PLANEJAMENTO_V1.md`. Não acrescentar cobrança, Google Ads, TikTok ou IA generativa nesta V1. As instruções iniciais desse planejamento descrevem uma época anterior à implementação; não representam o estado atual. Comentários/insights devem respeitar o escopo aprovado, sem introduzir uma integração de IA generativa.

## 2. Ambiente e revisão confirmada

- Repositório local: `C:\Users\Silvio Melo\Desktop\iGrow-Reports`.
- Shell: PowerShell, Windows. Fuso: America/Sao_Paulo.
- GitHub: `https://github.com/igrowdigitalmkt/iGrow-Reports`.
- Branch em uso: `master`. Não criar um projeto novo nem substituir a aplicação.
- Último commit de código: `187f10d` (fix: lint e mock server-only após séries diárias, 5/10/2026), sobre `5e601f1` (feat: séries diárias e gráfico de evolução).
- Domínio original: `https://i-grow-reports.vercel.app`.
- Publicação confirmada pela API de deployments do GitHub para esse SHA: ambiente `Production`, estado `success`, URL `https://i-grow-reports-5by04a2bw-i-grow-digital.vercel.app`.
- Next.js 16.3.8, React 19.3, TypeScript 6, pnpm 11.19.0, Node esperado >=24 e <25, Supabase, Vercel, Decimal.js e jsPDF no fluxo novo de PDF.
- A árvore estava limpa após o envio desse commit. Conferir `git status` antes de qualquer edição: o usuário ou outro chat pode ter alterado arquivos depois.

O AGENTS.md exige consultar os guias pertinentes em `node_modules/next/dist/docs/` antes de modificar código Next.js. Os arquivos são `.md`. Exemplos: `01-app/03-api-reference/04-functions/use-router.md` e `01-app/03-api-reference/01-directives/use-client.md`.

## 3. Problema que motivou o trabalho atual

Silvio mostrou o dashboard com Resultados e Custo por resultado temporariamente indisponíveis, embora outros números já estivessem visíveis. Atualizar a página fazia os resultados reaparecerem. Requisito explícito: não mostrar uma análise parcial; os indicadores devem aparecer juntos depois da confirmação dos dados.

O dashboard anterior recebeu um bloqueio que exige cobertura diária completa E agregado Meta confirmado antes de liberar indicadores, gráficos e exportações. Ausência real de um indicador após confirmação continua sendo ausência, não zero. Uma análise completa já confirmada pode permanecer visível enquanto é atualizada.

Em paralelo, foi implementado um novo fluxo persistido por snapshots. Atenção: **o dashboard principal ainda utiliza sua fonte anterior**. A nova análise fica em `/cliente/[clientId]/snapshots`. Não declarar que a fonte principal já foi substituída.

## 4. O que já está implementado e publicado

- Fundação existente: autenticação, áreas de agência/cliente, clientes e vínculos, permissões/RLS, dashboard anterior e módulos de relatórios. Auditar módulos existentes antes de classificar funcionalidades da V1 como inexistentes.
- Ingestão por escopo: cliente, conexão, provedor, conta, nível, período, versões da API e contrato. Contrato Meta normalizado atual: 3.
- Preservação de payloads e snapshots confirmados, valores decimais como strings, estados disponível/zero/ausente/erro.
- Hierarquia de conta/campanha/conjunto/anúncio e resultados nativos; sem somar resultados incompatíveis ou métricas não aditivas entre contas/níveis.
- Fila com claims exclusivos, lease de 15 minutos, fencing por tentativa monotônica e orçamento de retry por ciclo de atualização. O snapshot confirmado anterior continua disponível durante nova coleta.
- `POST /api/workers/meta`: executor protegido, até quatro jobs sequenciais; deixa de iniciar novos claims depois de quatro minutos. Isso não interrompe um job já iniciado. `processed` não significa sucesso de confirmação.
- `GET /api/workers/meta/health`: protegido; confere configuração e disponibilidade estrutural sem processar jobs ou consultar a Meta. Não comprova token Meta válido nem coleta funcional.
- Catálogo e leitura autenticados por RLS; solicitações de coleta/atualização somente para operadores autorizados, com escopo derivado no servidor.
- Nova tela com período, conta, nível, entidade, busca e paginação de 25 itens. A paginação é local; a consulta ao banco ainda recebe o snapshot completo.
- Liberação conjunta somente após confirmação dos quatro níveis de todas as contas selecionadas; conciliação decimal dos gastos e dos subtotais pai/filhos, hierarquia, moeda e fuso. Escopo faltante ou inválido oculta toda a análise.
- Dados antigos confirmados conservam estado `stale` e horário original. Coleta confirmada vazia é distinta de coleta ausente.
- Tratamento específico de RPC indisponível/PGRST202, sem fabricar indicadores ou prometer coleta.
- Comparação opcional com período anterior consecutivo de mesma duração. Ambos precisam estar confirmados/conferidos antes da liberação. Cada período tem solicitação de atualização e data de coleta próprias.
- Comparação por ID e metadados compatíveis. Diferenças decimais exatas; percentual calculado com seis casas na exportação e duas na descrição. Base anterior zero não produz percentual. Mudanças de moeda/fuso/atribuição conhecida/chave/unidade/regra impedem comparação do indicador. Atribuição desconhecida continua desconhecida.
- CSV e JSON incluem os dois períodos, inclusive entidades exclusivas do anterior. CSV registra origem, versões, regra, atribuição e hierarquia, protege fórmulas e escapa textos. JSON conserva strings decimais.
- PDF A4 das entidades atuais, com valores anteriores, estado, IDs, versões e data original. Indica quantidade de entidades exclusivas do anterior, disponíveis integralmente no CSV/JSON. Paginação, fontes locais licenciadas, cabeçalhos/rodapés, nomes extensos, progresso e cancelamento. Emojis/caracteres sem glifo bloqueiam PDF com orientação para CSV/JSON, sem perda silenciosa de texto. Serialização final ainda síncrona.
- Troca de filtros com transição própria: números/tabelas/exportações anteriores ficam ocultos enquanto a nova seleção carrega. Datas inválidas recebem mensagem antes de navegar. Consultas automáticas pausam durante navegação, exportação e outra consulta. Formulário mantém GET nativo sem JavaScript.
- Série diária: `snapshot-series-loader.ts`, `snapshot-series-chart.tsx`, `snapshot-series-panel.tsx`, `snapshot-series-section.tsx`, `snapshot-series-actions.ts`, `snapshot-series.css` e 8 testes implementados em `5e601f1`, com correções em `187f10d` (5/10/2026). `pnpm check` local aprovado em 5/10/2026: 71 arquivos de teste, 597 testes, test:db, test:rollout e build. Pendente: homologação com sessão e dados reais.
- Migrações aplicadas após o pacote de snapshots (5/10/2026, SQL Editor, pelo responsável): `202610050001` a `202610050005`.
- Última verificação confirmada (histórica): **589 testes de aplicação**, lint, TypeScript, build, duas execuções de **497 verificações SQL/RLS** em PGlite aprovados (antes da adição das séries). `pnpm check` com os 8 novos testes pendente de execução local.

## 5. Banco real: o que já foi aplicado

Supabase produção: projeto `qlopniyghvpbgwxuwxrl`, iGrow Reports.

As 13 migrations `202610040001` a `202610040013` foram aplicadas em transação no SQL Editor, após autorização explícita. SHA256 do pacote aplicado: `495ae0b36280c8e73d13ac77f05b1597e0c714f3ada77318f5cd53f17a11c0ab`.

Diagnóstico independente: 33 requisitos, zero falhas, `schema_ready=true`. A API reconheceu a tabela de snapshots; catálogo sem identidade foi negado com 403/42501, confirmando proteção estrutural, não homologação de sessão autorizada.

**Não reaplicar esse pacote. Não usar `supabase db push` indiscriminadamente.** A instalação não registrou histórico CLI e não criou backup. Ausência de histórico CLI não significa banco vazio. Comparar objetos e revisões antes de qualquer migração futura. Não apagar clientes ou tabelas para sincronizar o histórico.

Referências: `docs/ATIVACAO_SNAPSHOTS.md`, `docs/OPERACAO.md`, `supabase/diagnostics/snapshot-readiness.sql`. Os primeiros parágrafos de inventário nessas referências são históricos; a seção de aplicação confirmada prevalece.

## 6. Pendências, na ordem recomendada

### A. Homologar o novo fluxo publicado com sessão e dados reais

1. Usar sessão autorizada existente. Conferir conta, período e quatro níveis em `/cliente/[clientId]/snapshots`.
2. Testar carga inicial, troca de datas/contas, modo comparação, consulta manual e atualização. Verificar ausência de indicadores parciais e de números do filtro anterior durante navegação.
3. Testar usuário de cliente/leitor e operador; negar acesso a outro cliente/agência, vínculo revogado e cliente/conta arquivados. Verificar que cliente não consegue solicitar coleta.
4. Baixar CSV/JSON/PDF reais e conferir IDs, datas, valores, disponibilidade, entidades e comparação; testar cancelamento de PDF. Homologação visual com fixtures não substitui esses testes.
5. Registrar evidência e limitações, sem expor dados pessoais ou segredos.

O controle de navegador falhou repetidamente no chat anterior; não foi concluída homologação interativa autenticada. O teste novo de navegação controla o estado de transição na renderização; não prova gesto real no navegador.

### B. Ativar a operação do novo coletor

1. Conferir configuração efetiva no ambiente Vercel, sem imprimir valores secretos.
2. No último inventário, faltavam `INTEGRATION_WORKER_SECRET` e `QSTASH_TOKEN` no arquivo operacional local disponível. Nenhum deles foi gerado/configurado por este chat. Não presumir que o ambiente remoto tem esses valores; revalidar presença.
3. Seguir `docs/OPERACAO.md` para health protegido, criptografia, configuração Meta, duração do plano e capacidade. Endpoint sem configuração havia retornado 503.
4. `pnpm worker:schedule` é somente preparação. `--apply` cria agendamento externo, exige credenciais, health positivo e ausência de ID existente. Frequência preparada: a cada 15 minutos, 96 chamadas/dia; retries HTTP QStash zero, recuperação na fila da aplicação. Não sobrescrever cron existente.
5. Homologar uma coleta real autorizada pela NOVA fila: enfileirar, claim, consulta Meta, persistência, confirmação, retries, atualização e preservação do snapshot anterior. Conferir parâmetros de atribuição e resultados com Ads Manager.
6. Testar concorrência/revogação/RLS no Supabase real. PGlite não comprova concorrência entre sessões ou serviços Auth/Storage.

Não foi processada coleta real pelo novo executor nesta sequência. Isso não significa que o dashboard anterior nunca tenha coletado dados reais.

### C. Continuar implementação sem depender dessas credenciais

1. Implementar séries diárias persistidas e gráficos de evolução no NOVO fluxo. Antes de alterar schema/contrato, investigar o motor diário existente e o adaptador Meta; não reconstruir o dashboard antigo. Definir identidade/cobertura diária, estados ausente/zero, coleta vazia, moeda/fuso/atribuição e preservação de precisão. Não derivar série diária distribuindo um agregado por dias nem somar métricas únicas indevidamente.
2. Testar calendário/cobertura, datas/fusos, períodos comparados, isolamento, lacunas, confirmação e exportação. Só liberar gráfico com cobertura correspondente confirmada.
3. Preparar a migração da fonte do dashboard principal para snapshots. Fazer após homologação, com compatibilidade e retorno controlado; preservar dados e relatórios anteriores. O novo fluxo ainda não garante geração transacional comum entre todos os snapshots ou entre períodos; não prometer atomicidade global inexistente.
4. Avaliar consulta/paginação no banco para grandes volumes e custo das exportações, se a homologação revelar necessidade. Não adicionar complexidade sem evidência.

### D. Fechar o restante da V1

Auditar o código existente e comparar com as seções A–Y do planejamento: templates e versionamento, comentários/insights, criativos, aprovação, links de relatório e revogação, histórico, destinatários/consentimento, WhatsApp oficial, webhook e eventos fora de ordem, outbox/deduplicação, envio incerto, agendamento de geração/entrega e observabilidade/recuperação. Esses itens não devem ser declarados todos inexistentes: parte da plataforma anterior já tem implementação. Falta conferir a cobertura e fechar/homologar o fluxo completo com o novo motor.

Nenhuma mensagem real deve ser enviada sem autorização específica correspondente. Não confundir agendamento de COLETA Meta com geração e ENTREGA periódica de relatórios.

## 7. Mapa de arquivos para continuar

| Área | Arquivos principais |
| --- | --- |
| Objetivo e registros | `docs/PLANEJAMENTO_V1.md`, `docs/IMPLEMENTACAO.md`, `docs/COMPARACAO_SNAPSHOTS.md`, `docs/OPERACAO.md`, `docs/ATIVACAO_SNAPSHOTS.md` |
| Página nova | `src/app/cliente/[clientId]/snapshots/page.tsx`, `loading.tsx`, `error.tsx` |
| Tela e filtros | `src/modules/client-portal/snapshot-dashboard.tsx`, `snapshot-dashboard.css`, `snapshot-dashboard-loader.ts`, `snapshot-dashboard-actions.ts`, `range.ts` |
| Leitura e projeção | `src/modules/integrations/snapshot-reader.ts`, `snapshot-bundle-reader.ts`, `snapshot-projection.ts`, `src/modules/meta/snapshot-view.ts` |
| Validação/comparação | `src/modules/meta/snapshot-reconciliation.ts`, `snapshot-comparison.ts`, `snapshot-format.ts`, `snapshot-entity-list.ts` |
| Exportações novas | `src/modules/meta/snapshot-export.ts`, `snapshot-comparison-export.ts`, `src/modules/reports/snapshot-pdf.ts`, `snapshot-pdf-error.ts`, `public/fonts/` |
| Coletor e executor | `src/modules/meta/job-worker.ts`, `worker-adapter.ts`, `worker-results.ts`, `worker-entity.ts`; `src/modules/integrations/worker-*.ts`, `repository.ts`; `src/app/api/workers/meta/` |
| Operação | `scripts/worker-schedule.mjs`, `snapshot-rollout.mjs`, `verify-production.mjs`, `verify-snapshot-pdfs.py` |
| Banco | `supabase/migrations/202610040001*` até `202610040013*`, `supabase/tests/`, `supabase/diagnostics/snapshot-readiness.sql` |
| Regressões principais | `tests/snapshot-dashboard*.test.ts`, `tests/snapshot-comparison.test.ts`, `tests/snapshot-projection.test.ts`, `tests/snapshot-pdf.test.ts`, `tests/fixtures/snapshot-pdf.ts` |
| Relatórios anteriores | `src/modules/reports/`, `src/modules/client-portal/report-actions.ts` |

Use `rg --files` e leia a implementação antes de alterar. Para a fonte anterior e séries diárias, procure por cobertura, confirmação de agregado e consultas Meta no módulo client-portal; a correção está documentada no histórico de IMPLEMENTACAO.

## 8. Comandos e validação

```powershell
git status --short
git log -5 --oneline
pnpm check
pnpm test:production
```

`pnpm check` executa lint, tipos, testes de aplicação, SQL/RLS, instalação pelo pacote de rollout em banco descartável e build. Não aplica banco remoto ou processa Meta. `pnpm test:production` verifica um servidor de build LOCAL e suas proteções HTTP; o nome não significa teste autenticado na Vercel.

Após build, conferir alterações geradas em `next-env.d.ts`; nos incrementos anteriores, restaurou-se somente esse arquivo gerado com `git restore -- next-env.d.ts`. Não descartar alterações úteis nem usar restore/reset global.

Para mudança no PDF: consultar instruções de PDF disponíveis no ambiente, se houver; gerar PDFs pelos testes, executar `scripts/verify-snapshot-pdfs.py` com Python+pdfplumber, renderizar em Poppler e inspecionar imagens. A existência de uma skill específica do Codex não é pré-requisito para outro assistente realizar esse fluxo. PDFs fictícios ficam em `artifacts/snapshot-pdf/` e não são entregas reais. Runtime Python usado nesta máquina: `C:\Users\Silvio Melo\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe`. Esse caminho pertence à instalação local: conferir disponibilidade ou usar outro Python com as dependências necessárias.

Para comprovar deploy, consultar API GitHub de deployments por SHA e seus statuses; exigir ambiente `Production` e estado `success`. Um push sozinho não confirma publicação. Esses endpoints responderam sem token no chat anterior. Não confundir sucesso do deployment com homologação funcional.

## 9. Preferências e autorizações do usuário

Silvio quer continuidade autônoma e mais tempo implementando, com atualizações curtas e concretas. Evitar pedir confirmação repetida para decisões rotineiras já autorizadas. Houve autorização para implementação, commits/envio e aplicação do pacote SQL revisado acima; isso não é autorização irrestrita para novas alterações destrutivas, compra de serviços, mensagens reais ou reaplicação de migrations.

Não expor tokens, segredos ou arquivos de ambiente. Não inventar credenciais ou funcionamento. Se falta uma dependência externa, avançar no código/testes independentes e explicar o bloqueio exato. Não atribuir percentual geral de conclusão sem uma lista ponderada de critérios concluídos e homologados.

O próximo chat deve distinguir três estados em todo relatório: implementado/testado localmente, publicado, homologado com serviço/dados reais. As séries diárias estão implementadas (`5e601f1` + `187f10d`), enviadas ao GitHub e validadas por `pnpm check` local; deploy de `187f10d` confirmado (Production, success). Revisão posterior corrigiu enfileiramento multi-dia, bloqueio de gráfico parcial e estados por dia (ver IMPLEMENTACAO, 5/10/2026). Homologação autenticada permanece pendente. Solicitações de coleta na tela de snapshots agora processam a fila imediatamente (`inline-drain.ts`), sem depender do agendador externo; homologado em produção em 5/10/2026 com dados reais (12 jobs de período + 7 diários confirmados; soma diária de valor usado igual ao agregado). Pendentes: conferência com Ads Manager, exportações, comparação e perfis cliente/leitor.

## 10. Primeira ação sugerida para o próximo chat

Estado em 5/10/2026 (fim da sessão Claude Code desktop): coleta imediata, análise por snapshots e série diária homologadas em produção com dados reais do Colégio Crescer (ver IMPLEMENTACAO, 5/10/2026). Próximos passos, em ordem:

1. (Feito) Conferência com o Ads Manager: valores idênticos após atualização, exceto alcance da Escola Crescer (−3). Ver IMPLEMENTACAO.
2. (Feito) "Atualizar série" na evolução diária.
2b. (Feito, exceto modo comparação) Resultados derivados das campanhas nas exportações do nível de conta.
3. Comparação de períodos homologada em produção (5/10/2026). Falta: baixar CSV/JSON/PDF reais, acesso de perfis cliente/leitor, conferir período anterior no Ads Manager, investigar erro intermitente se reaparecer.
4. Decidir a troca da fonte do dashboard principal para snapshots (C.3), agora que a coleta funciona sem agendador.
4b. (Feito) Migração `202610050001` aplicada em produção em 5/10/2026 e convite homologado. Pendente: SMTP próprio (necessário para editar modelos de e-mail e para limite de envio) e homologar a visão de cliente (dados restritos, sem coleta).
4c. (Feito) Migrações `202610050002` e `202610050003` aplicadas em produção em 5/10/2026. `202610050004` (resultado pronto por período) aplicada em 5/10. `202610050005` aplicada e `CRON_SECRET` criada em 5/10; conferir a primeira execução do agendamento diário (06:00) nos logs da Vercel. Próximo: calcular totais por conta e dia na coleta (consulta de 1 ano rápida no plano gratuito) e reduzir espaço de `meta_daily_actions`/metadados (ver IMPLEMENTACAO, medição de 5/10).
4d. Arquitetura de coleta incremental (adendo de 5/10 no planejamento): feitos resultado pronto por período (0004), atualização diária às 06:00 com janela 7/28 dias, validade de 24 h dos agregados (0005) e retenção de 180 dias para conjuntos/anúncios. **Conferir nos logs da Vercel a primeira execução (`meta-daily-refresh` e `meta-retention`).** Feitos também: carga do histórico em blocos de 56 dias por noite, pré-cálculo dos períodos padrão com agregados exatos do Meta (0006 aplicada). Rotina validada em produção por disparo manual em 5/10 (ver IMPLEMENTACAO); primeira abertura de 180/365 dias em ~3 s. Adiado: deduplicação de ações diárias. **Etapa de leitura de dados concluída; próxima frente indicada pelo responsável: mudanças de layout.**
4e. Layout: proposta aprovada e implementada em 5/10 (fases 1 a 5, ver IMPLEMENTACAO "novo layout"); publicada e conferida em produção. Próximo: telas de login, convite e seleção de espaço no novo visual; ajustes finos após o responsável usar o painel.
4f. WhatsApp: envio de relatório em PDF homologado em produção em 6/10 (ver IMPLEMENTACAO, "Homologação do WhatsApp"). Próximo: agendamento automático de envios, descadastro por resposta "PARAR", nova análise do nome de exibição e, depois, Tech Provider e cadastro integrado com QR.
4g. Decisão de 6/10: o envio automático usa o WhatsApp do próprio cliente da plataforma, conectado por QR Code (Evolution API numa VPS do responsável), como Metrifiquei/Criativivo; mensagem em texto com variáveis, grupos permitidos, PDF opcional por e-mail; a API oficial fica como opção avançada. Feito o fluxo de Agendamentos (ver IMPLEMENTACAO, "Agendamentos"). **A migração `202610070001_report_automations.sql` ainda NÃO foi aplicada em produção**: até lá a página mostra "Agendamentos ainda não instalados". Próximo: responsável aplica a 0001 no SQL Editor e cria a VPS; VPS criada e Evolution API instalada em 6/10 (`https://179-236-250-51.sslip.io`, ver IMPLEMENTACAO); tela de conexão por QR/código, grupos e envio pelo número conectado implementados. Próximo: homologar a conexão real, agendar a chamada da rota a cada 5 min na VPS (CRON_SECRET, com autorização), backup diário da VPS (autorização), descadastro por "PARAR", PDF por e-mail.
5. Restante da V1 sem implementação: aprovação de relatórios, link público com revogação, comentário do gestor, agendamento de geração/entrega e WhatsApp (webhook/outbox). Exigem novas migrations aplicadas pelo responsável.

## 11. Alternância entre Codex e Claude

- Ambos devem ler `AGENTS.md`, este guia e o planejamento, independentemente de quais arquivos seu ambiente carrega automaticamente. `CLAUDE.md` na raiz oferece o ponto de entrada para o Claude.
- Não presumir acesso às ferramentas, plugins, navegador autenticado, sessões ou credenciais do assistente anterior. Verificar as capacidades disponíveis e usar ferramentas equivalentes permitidas pelo ambiente atual. Se não houver acesso ao repositório, informar essa limitação antes de alegar implementação.
- Os registros de publicação, testes e banco acima são evidências históricas datadas. Conferir HEAD, alterações locais e resultados mais recentes; não tratá-los como verificação realizada pelo assistente atual. A documentação pode ficar desatualizada após outra rodada de trabalho.
- Evitar edição simultânea pelos dois assistentes no mesmo checkout. Não sobrescrever nem descartar trabalho de outro assistente ou do usuário. Antes de alternar, registrar arquivos alterados, commit, testes executados, publicação confirmada, pendências e próximo passo concreto.
- Atualizar este guia e `docs/IMPLEMENTACAO.md` ao concluir a etapa. Se houver trabalho incompleto, documentar o ponto exato, erros e comandos de reprodução; não fazer commit de segredos ou arquivos de ambiente.
- Preservar as autorizações registradas e as regras do ambiente atual. O guia não autoriza ações externas novas além do escopo indicado na seção 9.

### Mensagem para iniciar a continuidade em qualquer assistente

Continue o desenvolvimento do iGrow Reports no repositório existente. Primeiro leia `AGENTS.md`, `docs/CONTINUIDADE_PROJETO.md` e `docs/PLANEJAMENTO_V1.md`; se existir, leia também `CLAUDE.md`. Esses documentos registram o objetivo completo, o estado confirmado, as pendências e o ponto de continuidade. Confira a branch, a revisão, as alterações locais e os registros mais recentes antes de editar. Preserve o trabalho existente e prossiga com implementação e testes na ordem indicada, sem reconstruir funcionalidades prontas. Diferencie implementado/testado, publicado e homologado com dados reais. Use as ferramentas disponíveis no seu ambiente, sem presumir acesso às sessões, credenciais ou ferramentas de outro assistente. Ao concluir cada etapa, atualize o guia e os registros com alterações, testes, commit, publicação e próximo passo. Quero mais tempo dedicado à implementação, atualizações objetivas e poucas interrupções para decisões rotineiras. Respeite o escopo e as autorizações registradas para ações externas.
