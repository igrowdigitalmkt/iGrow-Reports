# Chat de Campanhas (Assistente Groow): proteções, reserva atômica e homologação

Estado (20/10/2026): **código pronto e desligado, tudo local**. Nenhuma chamada real à Anthropic, migration aplicada, commit, push, deploy ou alteração de variável foi feita. Distinção usada neste documento: **implementado no código** ≠ **verificado em PGlite** (uma conexão) ≠ **verificado em PostgreSQL real** (nada ainda) ≠ **homologado com chamada real** (nada ainda).

## 1. Ambientes (inspeção somente leitura, 20/10/2026)

| Item | Produção | Homologação |
|---|---|---|
| Supabase | `qlopniyghvpbgwxuwxrl` ("iGrow Reports") | `xvjvfvinnnrgnhskglvd` ("igrow-homologacao"): **projeto independente, confirmado ao vivo** |
| Vercel | `i-grow-reports` (equipe i-grow-digital, publica a partir de `master`) | `i-grow-reports-homolog` (`prj_8v24wg80LBTzcXD6AAWJJ8ANJ3xF`): **só documentado** (`docs/HOMOLOGACAO_CHECKOUT.md`); o acesso à Vercel retornou 403 e não há CLI aqui, então o estado vivo, as variáveis e o commit publicado **não foram confirmados** |
| Estado do banco | Sem objetos de reserva; restrições `ai_usage_feature_check` e `ai_usage_status_check` com nomes e definições padrão (nenhuma restrição divergente) | Idem |
| Migrations | Histórico até `agent_analysis_runs_19_0003`; `202610200001/2` ausentes | Mesmo ponto; menos entradas porque várias foram agrupadas ao aplicar (nomes remotos são carimbos de data, não os nomes dos arquivos) |

Conclusões: (1) existe banco de homologação realmente separado; (2) **não se presume** que o nome "homolog" do projeto Vercel aponte para ele — isso só se confirma lendo os **nomes** das variáveis e o host (nunca os valores) na fase B; (3) pelo documento, a homologação **intencionalmente não tem** `ANTHROPIC_API_KEY` nem credenciais Meta e publica um código mais antigo copiado por CLI, sem crons: precisa de novo deploy desta branch, da chave e de um cliente com dados Meta confirmados (semente sintética ou conta autorizada por você) para que a conversa tenha o que analisar; (4) o chat não pode ser testado em produção sem afetar usuários reais, então **só em homologação**.

## 1b. Consolidação local antes da Fase A (20/10/2026)

- **Build de produção:** `next build --webpack` e `next build` (Turbopack) concluem, com TypeScript e geração das 42 páginas; as rotas novas constam. Impedimento de ambiente (não de código): no worktree o Turbopack recusa `node_modules` (link para fora da raiz); o build Turbopack foi provado com `turbopack.root` temporário, já revertido. Os builds rodaram com as credenciais neutralizadas (chave da Anthropic vazia, Supabase apontando para uma porta local), sem acesso externo. Ainda falta um build no ambiente real (Vercel de homologação).
- **Navegação:** 30 verificações no navegador com fixtures locais (já removidas): Dashboard, Campanhas, Métricas, Relatórios, detalhes dos três níveis, breadcrumbs, voltar/avançar, atualizar cada URL, detalhe em outra aba, troca de cliente e URLs adulteradas. A lista de clientes só foi verificada no código (a demonstração não tem links). Seleção analítica do Dashboard (abrir, selecionar campanha/conjunto/anúncio, aplicar, escopo preservado entre seções analíticas, voltar/avançar, sair para Campanhas): 16 verificações com o componente real e ações de servidor simuladas. Troca de período e de conta recria o painel (a chave do componente inclui datas e contas); não exercitada no navegador porque a fixture ignora a busca.
- **Catálogo × métricas:** a lista de Campanhas não é mais bloqueada pela cobertura incompleta. Sem cobertura completa o catálogo vem somente da leitura ao vivo na Meta (`catalogOnly`), todas as entidades saem sem valores (`metricsPending`, nunca zero) e a tela avisa. Sem catálogo confiável e sem métricas: estado próprio, nenhuma linha, nunca dado antigo. Métricas confirmadas e Meta indisponível: histórico visível e veiculação "Indisponível". O Dashboard continua protegido (inalterado). **Assistente:** com métricas não confirmadas o servidor recusa antes de reservar ou chamar o modelo, e o painel explica; as verificações do backend não foram enfraquecidas.
- **Desempenho:** a leitura ao vivo de um subconjunto de contas (detalhes) reaproveita a leitura completa do mesmo cliente (45 s), sem trazer outras contas; índice de filhos na tabela.
- **Regressões encontradas e corrigidas:** a seleção analítica gerava entrada duplicada no histórico ao aplicar; o painel de seleção permanecia aberto ao voltar de outra seção; conta de outro cliente nos detalhes mostrava aviso genérico em vez de "não encontrado". Testes: 539 em 60 arquivos (campanhas, navegação, loader, cache, assistente, analytics, permissões, Meta, IA, relatórios) passam; `tsc` e `eslint` limpos.
- **Limitações:** os testes de navegação e de estados usaram fixtures e ações simuladas; nada foi lido de campanhas reais. O estado "catálogo parcial" depende de uma conta falhar na Meta e só foi simulado. A captura do Dashboard com seleção aplicada usa dados simulados simplificados (custos por tipo indisponíveis nela).
- **Não executado:** Fases A, B e C, migrations, deploy, IA real.

## 2. Proteções implementadas

| Situação | Proteção | Limite |
|---|---|---|
| Autorização | Organização vem da sessão; cliente, contas e escopo reconstruídos no servidor; pedido só carrega identificadores | — |
| Chamada paga sem registro possível | Interruptor `CAMPAIGN_CHAT_ENABLED=1` (padrão desligado), categoria aceita no banco, `ai_reservations_ready()`, modelo configurado, contabilização sem falha: qualquer falha ⇒ indisponível | Probes com cache de 60 s |
| Orçamento e concorrência | **Reserva atômica no PostgreSQL** (seção 4): teto calculado no banco, idempotência por `(organização, funcionalidade, request_key)`, `scope_hash` impede reutilizar o identificador com outro contexto | Concorrência entre conexões **não verificada em PostgreSQL real** |
| Falha ao liquidar | Uma nova tentativa idempotente; persistindo, a reserva continua contando pelo valor estimado, a resposta é **retida** (`accounting_failed`) e um disjuntor (10 min, por instância) suspende novas chamadas | Disjuntor por instância |
| Provedor falha sem informar uso | `unknown_consumption` (nunca custo zero; conta pela estimativa até conciliação). 429/modelo ausente ⇒ liberada (recusa certa) | Conciliação manual |
| Retentativas do SDK | Desligadas (`maxRetries: 0`) | O usuário repete (nova solicitação, nova reserva) |
| Números | Valores de desempenho só por marcador; o servidor escreve o número | Seção 8 |

## 3. Migrations (locais, **não aplicadas**; ordem fixa)

**`202610200001_campaign_chat_ai_usage.sql`**: acrescenta `campaign_chat` às quatro categorias existentes e cria `ai_usage_supports_feature(text)`. Revisão desta etapa: a restrição antiga **não é mais removida pelo nome**; um bloco `DO` remove toda restrição de checagem que limita `feature` (por definição) e a canônica é recriada. A função exige que **todas** as restrições sobre `feature` aceitem a categoria.

**`202610200002_ai_usage_reservations.sql`**: estados `reserved` e `unknown_consumption`, cinco colunas, índice único de idempotência, `reserve_ai_usage`, `settle_ai_usage`, `sweep_stale_ai_reservations`, `ai_reservations_ready`. Revisão desta etapa: (a) **risco corrigido** — o `drop constraint ... ai_usage_status_check` pelo nome deixaria outra restrição de estado (nome diferente) bloqueando `reserved`; agora um bloco `DO` remove toda restrição de estado por definição; (b) **falso positivo corrigido** — `ai_reservations_ready()` olhava só a restrição com aquele nome; agora exige que TODAS as restrições de estado aceitem os dois valores e faz uma **sonda funcional**: insere uma reserva e um consumo desconhecido de teste e **desfaz tudo** (subtransação revertida por exceção); qualquer rejeição ou erro inesperado ⇒ `false`. Sem organizações no banco, só vale a parte estrutural. Todas as funções seguem `SECURITY DEFINER`, `search_path` vazio, `revoke` de `public/anon/authenticated`, `grant` só ao `service_role`, e exigem `auth.role() = 'service_role'`.

Dependências a confirmar (somente leitura) antes de aplicar: tabelas `agencies`, `clients`, `ai_usage` (e seu histórico `202610120002`), `ai_settings`, `ai_client_settings`; funções `agency_ai_entitlement` e `ai_month_cost`; restrições de `ai_usage` sem nomes divergentes (conferido nos dois bancos). `ai_month_cost` e os relatórios somam `cost_usd` de todas as linhas, então continuam compatíveis; `settings-actions.ts` só conta status conhecidos; o painel de plataforma (`202610150010`) filtra `status = 'ok'` e **não** mostra reservas/consumo desconhecido (melhoria futura). Reversão comentada no fim de cada arquivo (só sem linhas `campaign_chat`/`reserved`/`unknown_consumption`/`needs_reconciliation`).

**Verificação local:** `node supabase/tests/rls-smoke.mjs` aplica **todas** as migrations reais em PGlite; `supabase/tests/ai-reservation.test.sql` (pgTAP, inclui restrições divergentes simuladas e a sonda) passa. PGlite tem uma única conexão: prova a lógica SQL e a serialização sequencial.

## 4. Reserva financeira atômica

Fluxo: autenticar → autorizar → montar fatos → filtro rápido → **reservar** → chamar o modelo → verificar → **liquidar** → entregar (ou reter). `reserve_ai_usage` roda em UMA transação sob `pg_advisory_xact_lock` por organização: marca reservas abandonadas (>15 min ⇒ `unknown_consumption`), aplica idempotência, lê a configuração ATUAL (plano, interruptores, `ai_settings`), compara gasto do mês (todas as linhas) + estimativa com o teto — `least(configuração, plano)`, **calculado no banco, nunca vindo do chamador** — e insere. Resultados: `reserved`, `duplicate_in_flight/completed/unknown`, `conflict`, `budget`, `disabled`, `plan`, `restricted`, `invalid`; só `reserved` autoriza chamada paga. `settle_ai_usage` é idempotente e confere a organização: `completed` (custo real), `released` (recusa certa, custo 0), `unknown` (mantém a estimativa e marca conciliação).

**Cálculo do valor reservado (uma única regra e uma única tabela de preços, `PRICE_PER_MTOK` em `guarded-text.ts`, modelo `claude-sonnet-5-5`):** (bytes UTF-8 de TUDO o que é enviado — instrução, fatos, pergunta e histórico — + 500 tokens de margem) × US$ 2,50/M (taxa mais cara de entrada, a de escrita em cache de 5 min; a leitura de cache custa US$ 0,20/M e a entrada normal US$ 2,00/M) + 900 tokens de saída × US$ 10/M (`max_tokens` limita a saída, inclusive raciocínio, que é cobrado como saída). Como um token tem pelo menos um byte, é um limite superior **prático**, não contratual. Pior caso por pergunta ≈ US$ 0,16 (60 mil caracteres); o filtro rápido do portão usa a mesma função com caracteres no lugar de bytes (nunca excede a reserva). Preços conferidos na tabela do provedor (consulta de 20/10/2026, tabela em cache de 06/10/2026; reconferir no painel antes da homologação): entrada 2, saída 10, escrita de cache 5 min 2,5 (1 h seria 4, não usada), leitura 0,2.

**Quatro conceitos distintos:** **reserva estimada** (`reserved_usd`, o que bloqueia o orçamento enquanto a chamada ocorre); **custo informado pelo provedor** (tokens reais ⇒ `cost_usd` calculado, substitui a reserva na liquidação; a diferença fica em `delta_usd`); **consumo desconhecido** (`unknown_consumption`: sem uso informado; mantém a estimativa até conciliar); **exposição residual** (abaixo).

**Exposição residual (não eliminada):** (1) o custo real pode superar a reserva se a contagem de tokens ou os preços do provedor mudarem; (2) o teto global **ainda não é rigoroso**: relatórios, carteira, WhatsApp e motor de decisão gravam o custo só DEPOIS da chamada, então uma chamada deles em andamento pode ultrapassar o teto pelo custo de cada chamada simultânea; (3) consumo desconhecido conta pela estimativa, maior ou menor que o real; (4) disjuntor e mapas em memória são só complementares; (5) sem `ai_reservations_ready()` o chat fica indisponível.

**Outros consumidores (limitação):** `runGuardedGeneration` em `src/modules/ai/guarded-text.ts` (ponto único de `report_comment`, `portfolio_summary`, `whatsapp_summary`) pode ser envolvido com `reserveAiUsage`/`settleAiUsage` numa única alteração; `src/modules/agent-executor/decision-cycle.ts` (`agent_decision`) grava depois da chamada e **não foi alterado** (motor de decisão preservado). Enquanto isso não for feito, a proteção do orçamento compartilhado é do chat, não de todos.

**Não verificado em PostgreSQL real:** concorrência entre conexões (`pg_advisory_xact_lock`), índice único sob disputa, liquidação simultânea, comportamento das migrations em um banco com dados reais, sonda funcional com dados reais. `scripts/ai-reservation-concurrency-check.mjs` cobre isso e **não foi executado**. Condições para executá-lo: banco de homologação (referência permitida **e** a de produção rejeitada na URL), `HOMOLOG_CONFIRM=1`, duas organizações sintéticas cujo nome começa com `TESTE-HOMOLOG`, plano com IA e orçamento mensal pequeno na organização A; usa o banco por HTTP (PostgREST, pool de conexões independentes), confirma sobreposição real no tempo, que o gasto no banco nunca ultrapassa o teto efetivo, idempotência, `conflict`, liquidação repetida, isolamento entre organizações (reserva e liquidação cruzadas), e libera as reservas de teste ao final. Nunca imprime a chave.

## 5. Procedimento da primeira homologação, em fases (NÃO executado; cada fase exige autorização específica)

**Fase A — Banco (Supabase `xvjvfvinnnrgnhskglvd`).**
1. Leitura: listar migrations e confirmar as dependências da seção 3 e a ausência de restrições divergentes.
2. Aplicar `202610200001` e depois `202610200002` (nomes carimbados), só na homologação, uma por vez.
3. Confirmar `select public.ai_usage_supports_feature('campaign_chat'), public.ai_reservations_ready();` ⇒ `true, true`; funções `SECURITY DEFINER` com `search_path` vazio; privilégios só do `service_role`.
4. Criar (ou você indicar) duas organizações/clientes sintéticos `TESTE-HOMOLOG-*`; orçamento da A pequeno; você fornece a chave de serviço no seu terminal (não nesta conversa).
5. Rodar o script de concorrência; conferir idempotência, liquidação e que nada ficou aberto: `select status, reserved_usd, cost_usd, request_key, needs_reconciliation from public.ai_usage where request_key like 'conc-%' order by created_at;`.

**Fase B — Aplicação (Vercel homologação).**
1. Ler (só nomes) as variáveis do projeto e confirmar que o host do Supabase é o de homologação; confirmar que não há credenciais de produção.
2. Você define `ANTHROPIC_API_KEY` na homologação (valor nunca em chat nem em log).
3. Publicar **esta branch** na homologação por CLI (sem merge, sem push, sem tocar a produção); conferir que o executor Meta e o Dashboard permanecem como estavam.
4. Preparar dados: cliente com dados Meta confirmados (semente sintética ou conta autorizada por você) e usuário de teste com acesso a Campanhas.
5. Ativação controlada: `CAMPAIGN_CHAT_ENABLED=1` **só** na homologação e novo deploy (variáveis só valem em deploy novo).

**Fase C — IA (chamadas pagas, teto de US$ 1,00 no orçamento da organização de teste; cada pergunta reserva no máximo ≈ US$ 0,16).**
Onde testar: **/clientes/ID/campanhas** (menu do cliente; a rota global antiga só redireciona) e as telas de detalhes `/clientes/ID/campanhas/meta/CONTA/(campanha|conjunto|anuncio)/ID`, que compartilham o mesmo assistente e as mesmas conversas por contexto.
1. Primeira pergunta real sobre uma campanha; 2. resposta contextual (conjunto e anúncio); 3. pergunta de continuidade; 4. conferir `ai_usage` (uma linha por pergunta, liquidada, custo real no lugar da reserva, nenhum `needs_reconciliation`, nenhum `accounting_failed`); 5. conferir o orçamento (gasto do mês ≤ teto); 6. bloqueios: orçamento reduzido, outra organização/conta fora do vínculo, interruptor da organização e do cliente desligados, `CAMPAIGN_CHAT_ENABLED` removido; 7. **desativar** ao final.

## 6. Desativação

Imediata: remover `CAMPAIGN_CHAT_ENABLED` (ou `0`) e redeploy da homologação; em emergência, desligar a IA da organização em IA e Configurações. O código também desliga sozinho se a contabilização falhar ou se `ai_reservations_ready()` deixar de retornar verdadeiro. Reversão do banco só conforme os blocos comentados nas migrations, sem linhas pendentes.

## 7. Pendências para produção (não autorizadas)

Aplicar as migrations em produção só depois da homologação aprovada e de autorização específica; reservar também em `runGuardedGeneration` e no motor de decisão (ou aceitar a exposição residual por escrito); rotina para `sweep_stale_ai_reservations` e conciliação de `needs_reconciliation`; painel de plataforma mostrando reservas e consumo desconhecido; definir a conta de teste de produção ou manter o chat desligado lá. Critério de aprovação: custo por pergunta conhecido, nenhum `accounting_failed`, nenhuma resposta com valor trocado de entidade, bloqueios funcionando.

## 8. Limites da verificação numérica

Valores de desempenho só passam por marcador; o servidor escreve o número. Isso impede números inventados e valores digitados de outra entidade, mas **não garante a correção semântica integral**: um marcador válido pode ser citado numa frase sobre a entidade errada, e a redação/raciocínio não são validados. Datas só valem por inteiro (dd/mm/aaaa ou hh:mm).
