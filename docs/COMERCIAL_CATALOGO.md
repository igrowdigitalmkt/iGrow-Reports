# Catálogo comercial e direitos de utilização (etapa 2.1)

Status: implementado na branch `feat/commercial-catalog`; migration `202610140004_commercial_catalog.sql` **aplicada só na homologação** (`igrow-homologacao`, registro `commercial_catalog_0140004`) e homologada com ressalvas (seção abaixo). **Não aplicada em produção**; nada commitado nem publicado. Sem cobrança e sem Asaas nesta etapa.

## Regras
- **Planos têm versões.** Versão publicada é imutável (no banco também); mudar preço, teste ou limites exige novo rascunho e publicação. Quem usa a versão anterior mantém as condições dela.
- **Organização gerenciada = tem plano atribuído** (`private.agency_plan_assignments`). Sem atribuição, nada muda (comportamento atual). A migration não atribui nada e não cria planos.
- **Precedência:** interruptor global (só funcionalidades) > concessão ativa > plano atribuído > "não incluso" (recurso negado / limite 0). Papéis e módulos da equipe continuam exigidos à parte.
- **Plano da organização** (`agency_plan_assignments`): `kind='administrative'` é concessão gratuita do operador (motivo obrigatório, auditada como `commercial.plan_granted_admin`). `kind='subscription'` fica reservado à futura integração do Asaas: nenhuma função administrativa cria, troca nem remove esse tipo; assinatura paga nunca nasce de ativação manual.
- **Concessão** (`entitlement_overrides`): por organização, com motivo, responsável e prazo; imutável, só revogável. Não é plano privado (visibilidade/atribuição do plano) nem cupom (fase futura).
- **Catálogo de recursos** (`entitlement_definitions`) só lista o que o código aplica hoje. Funcionalidades: `ai_assistant`, `client_portal`. Limites: `clients`, `team_members`, `ad_accounts`, `whatsapp_numbers` (API oficial; QR Code não conta), `report_automations`, `ai_budget_usd_cents`. Novo recurso = migration + código que o aplique.

## Onde é aplicado
- **Banco (gatilhos, com trava por organização/recurso para operações simultâneas):** clientes (inserir e desarquivar), equipe (membros e convites pendentes), contas de anúncio Meta/Google (uma conta em vários clientes conta uma vez), números oficiais de WhatsApp (regravar o mesmo número não conta), automações ativas (criar e reativar), portal do cliente (convites e acessos). Só bloqueia novas adições; nada existente é removido. Erros: `53400` (limite) e `42501` (recurso indisponível), com mensagem em português mostrada em clientes, convites e agendamentos.
- **Servidor:** IA (`guarded-text.ts`): recurso `ai_assistant` e teto `ai_budget_usd_cents` (vale o menor entre o teto do plano e o da organização). Sem a função no banco (antes da migration) a IA segue como antes; qualquer outra falha nega.
- **Não aplicado ainda:** acesso a Google Ads por organização e demais telas; limites de consumo além do orçamento de IA; sincronização com assinatura paga (etapa 2.2).

## Super Admin (`/admin`)
`Planos` (lista, criar, dados, rascunho → publicar, histórico), `Recursos e interruptores` (catálogo e desativação global com motivo e confirmação), `Organizações e concessões` (atribuir/trocar/remover plano com aviso do que já excede, direitos em vigor com uso atual, concessões). Toda alteração grava `commercial.*` na auditoria da plataforma.
Campos que só terão efeito mais adiante estão rotulados na tela: visibilidade pública, ordem, recomendado (página de vendas) e dias de teste (cadastro com teste).

## Homologação sugerida (projeto `igrow-homologacao`, só com autorização)
1. Aplicar `202610140004_commercial_catalog.sql` depois da `202610140003`. A homologação só tem as tabelas do Super Admin: para ver telas e limites de verdade é preciso também o restante do esquema (clientes, equipe, WhatsApp, automações) ou testar só planos, recursos e atribuição.
2. Em `/admin/planos` crie um plano de teste, preencha o rascunho e publique; confira a versão no histórico; crie nova versão e veja a anterior preservada.
3. Em `/admin/organizacoes`, atribua o plano a uma organização de teste e confira "Direitos em vigor"; remova o plano e confirme que volta a "sem restrição".
4. Com esquema completo: criar clientes/convites além do limite deve recusar com mensagem clara; conceder um limite maior libera; revogar volta ao limite.
5. Desativar `client_portal` em `/admin/recursos` deve bloquear convites de todas as organizações; reativar em seguida.

## Validação local (etapa 2.1, revisão final)
- Ambiente de verificação visual sem tocar em nenhum banco remoto: banco real do projeto em memória (PGlite + todas as migrations) atrás de um PostgREST/GoTrue mínimo, com dados fictícios, usado só para abrir `/admin/planos`, `/admin/recursos` e `/admin/organizacoes` no navegador. Achados e corrigidos: ações do Super Admin não podiam receber função como filho (erro real de renderização); formulários perdiam o que foi digitado após um erro; rolagem horizontal no celular.
- Compatibilidade conferida em produção só com leitura do esquema (colunas usadas pelos gatilhos existem; sem conflito de nomes; hoje só há 2 organizações).

## Recuperação (sem apagar nada)
1. A migration só adiciona objetos; sem plano atribuído nada é restringido. Se algo estranho aparecer, **remover o plano da organização** em `/admin/organizacoes` (ou desativar o recurso) devolve o comportamento anterior na hora.
2. Reverter o código pela Vercel é seguro: o código antigo ignora o catálogo.
3. Emergência extrema, só com autorização: desligar a aplicação de limites em uma tabela (`alter table public.clients disable trigger enforce_clients_limit;` e equivalentes: `enforce_team_members_limit` em agency_users/agency_invitations, `enforce_ad_accounts_limit` em client_ad_accounts/client_google_accounts, `enforce_whatsapp_numbers_limit`, `enforce_automations_limit`, `enforce_client_portal_feature` em client_users/client_portal_invitations) e religar com `enable trigger`. Não há `drop` no procedimento padrão.

## Recomendação sobre WhatsApp (não implementada)
- **Modalidades reais:** (1) número **oficial** (API da Meta, vários por organização, credencial por número); (2) **QR Code** via Evolution API na VPS (1 sessão por organização, `igrow-<agencyId>`).
- **Custo para a plataforma:** o oficial roda quase só no Supabase/Vercel (webhooks e caixa de entrada). O QR mantém uma conexão ativa por organização na VPS compartilhada (Hostinger KVM 2: 2 vCPU, 8 GB RAM, 100 GB SSD) com histórico de 7 dias e mídia; é o que pode saturar a VPS e traz risco de bloqueio do número pelo WhatsApp.
- **Recomendação:** transformar o QR em **funcionalidade de plano** (`whatsapp_qr`, liga/desliga por plano e concessão, com interruptor global de emergência), aplicada ao conectar e ao enviar por QR; manter o limite de números oficiais (sugestão inicial 1 a 3 por plano, a decidir); medir RAM/CPU/disco por sessão ativa antes de fixar quantas organizações com QR a VPS suporta. Como há só uma sessão por organização, um limite numérico não faria sentido.

## Homologação definitiva (projeto `igrow-homologacao`, 14/10/2026)
**Resultado: HOMOLOGADA COM RESSALVAS.** Produção não foi tocada (scripts recusam o ref de produção; o app de homologação usa `scripts/homolog-start-app.mjs`).
- **Esquema da homologação:** subconjunto das migrations (fundação, storage privado, auditoria de clientes, destinatários, portal do cliente, métricas Meta, relatórios, automações, equipe e demais até `202610140003`) mais `commercial_catalog_0140004`. Não aplicadas lá: analytics/dashboards/ingestão/integridade/snapshots, caixa de entrada/QR/mídia/listas do WhatsApp e `202610120005`. Portanto limites de números de WhatsApp e partes de métricas não foram exercitados de ponta a ponta.
- **Testes reais** (`scripts/check-commercial-homolog.mjs`, conexões HTTP independentes, 34 verificações, todas OK): limite de clientes com 6 e 10 tentativas simultâneas pelo último lugar (só 1 aceita, restante 53400, total exato); limite de equipe com convites simultâneos; 4 pedidos simultâneos de rascunho e 4 publicações simultâneas (só 1 vence, histórico consistente); acesso direto às 17 funções administrativas por usuário comum, anon e operador só com senha (todos recusados); isolamento entre organizações; tabelas privadas não expostas; concessão exige motivo e `subscription` não nasce pela API.
- **Deadlock (teste C):** reproduzido com função auxiliar de teste; o PostgreSQL aborta uma transação (40P01) e ela pode ser repetida. É caso sintético: as travas reais são pegas uma por operação.
- **Interface real** (Super Admin com MFA, navegador): criar/editar plano, rascunho, publicar, nova versão, concessão e remoção de plano, concessão por organização, interruptor global; persistência conferida no banco; estados de carregamento e mensagens; desktop largo, tablet, celular, tema claro e escuro.
- **Organizações sem plano:** continuam sem restrição (conferido também por SQL).
- **Achados corrigidos nesta fase:** filhos-função servidor→cliente, formulários que apagavam campos após erro, rolagem horizontal no celular, listagem sem `current_version_id`, busca por id, funções auxiliares de gatilho executáveis por PUBLIC, `platform_publish_draft` sem trava do plano (corrigido na própria migration, ainda não aplicada em produção), mensagem de sucesso que ficava velha (some em 7 s).
- **Ressalvas:** (1) esquema parcial na homologação; (2) ~~contraste do texto "muted" no tema claro em ~4,45:1~~ corrigido: `--muted` claro passou de `#6a7384` para `#636c7d` (4,93:1 sobre o fundo, 5,29:1 sobre cartões, 4,80:1 sobre superfícies elevadas; o tema escuro já tinha 5,03 a 5,71:1 e não mudou); (3) concorrência testada via PostgREST, não com carga; (4) **interruptor global de funcionalidade também afeta organizações sem plano** (decisão de desenho: é kill-switch de emergência); (5) objetos de teste na homologação (abaixo).
- **Objetos de teste na homologação (fictícios, pode manter ou limpar com autorização):** função `public.zz_teste21_lock_pair`, tabela `public.zz_teste21_resultados`, dados "TESTE-2.1", planos `teste21-*`, operador de teste e usuários fictícios (credenciais só em `.env.homolog-teste21`, ignorado pelo git).
- **Publicação em produção (quando autorizada):** 1) aplicar a migration `202610140004` (só uma vez; sem reaplicar), 2) só depois publicar o código, 3) conferir `/admin/planos` e que as 2 organizações reais seguem "sem plano". Recuperação sem `drop`: remover plano da organização / desativar recurso / reverter o deploy.

## Conferência da migration contra a produção (só leitura, 14/10/2026)
Todas as tabelas e colunas usadas existem em produção (clients, agency_users, agency_invitations, client_ad_accounts, client_google_accounts, whatsapp_connections, report_automations, client_users, client_portal_invitations, ai_usage, agencies); `private.agency_role`, `private.platform_operator_role` e `private.platform_audit_log` (etapa 1) existem; nenhum objeto da migration existe antes (funções, tabelas `private`, triggers `enforce_*`, `agency_ai_entitlement`); RLS ativa nas tabelas-alvo; produção tem 2 organizações e nenhuma é alterada. A migration não contém dados de teste nem objetos `zz_teste21`/`teste21`; o único dado inserido é o catálogo estático de recursos (8 definições) e nenhum plano, atribuição, concessão ou interruptor desligado.

## Procedimento de publicação (NÃO executado; exige autorização explícita)
1. Antes: branch limpa, `pnpm check` verde, e-mail/MFA do dono em dia; anotar o último deploy da Vercel (para rollback do código).
2. Aplicar `202610140004_commercial_catalog.sql` **uma única vez** em produção (SQL editor ou `apply_migration`), nunca em horário de pico.
3. Confirmar (só leitura): tabelas `private.plans`, `plan_versions`, `plan_version_entitlements`, `agency_plan_assignments`, `entitlement_overrides`, `entitlement_definitions` existem; `select count(*) from private.agency_plan_assignments` = 0; `select key, globally_enabled from private.entitlement_definitions` = todas `true`; triggers `enforce_*` presentes.
4. Com o código antigo ainda no ar: conferir que clientes, convites e IA continuam funcionando (a migration não restringe ninguém sem plano).
5. Publicar o código (merge → deploy). O código novo tolera a migration já aplicada.
6. Entrar em `/admin` com MFA: abrir Planos, Recursos e Organizações (devem listar vazio/sem plano e as 2 organizações reais "Nenhum (sem restrição)").
7. Verificar organizações existentes: criar/arquivar nada; apenas abrir o painel de cada uma e uma geração de IA de teste do dono.
8. Observar erros por ~1 h nos logs da Vercel e da API do Supabase (53400, 42501, "Limite do plano").
9. Falha: (a) erro só de tela → reverter o deploy na Vercel (a migration é compatível com o código antigo); (b) restrição inesperada → remover o plano da organização em `/admin/organizacoes` ou reativar o recurso em `/admin/recursos`; (c) emergência extrema, só com autorização: `alter table ... disable trigger enforce_...` (ver Recuperação). Nunca `drop` nem apagar dados.

## Decisão: WhatsApp por QR Code (registrada, não implementada)
O QR Code será no futuro uma **funcionalidade controlável por plano** (`whatsapp_qr`), com **interruptor global de emergência**. Números da API oficial mantêm limite quantitativo. **Nenhuma quantidade definida agora**; conexões existentes e Evolution API não foram alteradas; sem bloqueio comercial em produção.

## Limitações conhecidas
- Concorrência foi validada em homologação com conexões reais independentes (ver acima); PGlite local não executa transações simultâneas.
- Duas transações que adquirem travas de recursos diferentes em ordem oposta podem, raramente, gerar deadlock (o Postgres aborta uma delas).
- Conexões WhatsApp por QR Code não entram no limite de números.
- Aplicar a migration **antes** do novo código é o ideal; o código antigo ignora o catálogo e o novo tolera a ausência da função da IA.
