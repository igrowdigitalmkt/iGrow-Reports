# Preparação para operações reais (21/10/2026)

Nada neste documento foi executado contra campanhas reais. Pausar, retomar e alterar orçamento continuam exigindo autorização específica do proprietário.

## 1. Diagnóstico das permissões Meta

**Correção de um diagnóstico anterior.** O relatório de 20/10 afirmou que "a conexão atual não tem ads_management". Isso estava errado. A consulta ao banco de produção mostra que as três conexões (Colégio Crescer, RM Imobiliária, Clínica Hosana Lara) têm `ads_management` entre as permissões guardadas na conexão. O cartão "Operações" que eu vi indisponível era da conta **Escola Crescer**, cujo `account_status` é `3` (pendência de pagamento na Meta): a tela juntava "conta restrita", "conexão" e "permissão" em uma mensagem só. Agora são causas separadas.

Como funciona hoje:
1. **Login:** Facebook JS SDK com Facebook Login for Business (`META_LOGIN_APP_ID` / `META_LOGIN_CONFIG_ID` em `src/modules/meta/login-config.ts`). O código **não envia `scope`**: as permissões pedidas vêm da *configuração de login* cadastrada no painel Meta Developers. Mudar o que é pedido exige alterar essa configuração, não o código.
2. **Troca do token:** `connectMetaIntegration` troca o token curto por um token de longa duração no servidor (`fb_exchange_token`) e guarda o segredo cifrado (RPC `get_integration_secret`/`store`); o navegador nunca recebe o token longo.
3. **Permissão concedida (guardada):** `connectMetaForClient` lê `/me/permissions` no momento da conexão e grava em `meta_connections.scopes` apenas o que está `granted`. É um **instantâneo**: não prova que a permissão continua válida.
4. **Permissão atualmente válida:** só uma leitura ao vivo prova. O executor já fazia isso (`probeMetaWritePermission`, GET em `/me/permissions`). Agora a tela de Campanhas também faz, antes de oferecer qualquer ação (`src/modules/campaigns/manual/permissions.ts`), distinguindo: ausente, recusada, expirada, token revogado (código 190) e não confirmada.
5. **Vínculo:** a conexão pertence a um cliente (`meta_connections.client_id`) dentro de uma organização; as contas publicitárias são ligadas ao cliente por `client_ad_accounts`. O servidor confere organização, cliente, vínculo ativo, conexão e titularidade da entidade a cada operação.
6. **Revisão da Meta:** o uso de `ads_management` por usuários **sem função** no aplicativo exige Acesso Avançado (App Review e verificação da empresa). Não é possível ver o estado dessa revisão a partir daqui; como as conexões atuais receberam a permissão, os usuários que conectaram têm função no aplicativo ou o acesso já foi liberado. Para clientes novos, **confirmar no painel Meta Developers** (Revisão do app › Permissões e recursos) que `ads_management` está com Acesso Avançado.

### O que mudou no código (sem criar um segundo OAuth)
- Mensagens e estados distintos: `account_restricted` (conta com `account_status` ≠ 1, mostrando o status em português), `account_disconnected` (conexão ausente/offline), `write_permission_missing` (com motivo: `not_granted`, `declined`, `expired`, `token_invalid`, `unverified`).
- A leitura de dados continua funcionando nesses estados e a tela diz isso.
- Ação oferecida: botão **Abrir Integrações** (a tela de conexão Meta já existente) apenas quando reconectar/reautorizar resolve; nunca para conta restrita (isso se resolve no Gerenciador de Anúncios da Meta).
- Um membro sem papel de proprietário/administrador vê só a explicação e nada pode alterar.

### Ações externas necessárias do proprietário (não bloqueiam o resto)
1. Painel Meta Developers › Facebook Login for Business › configuração `1662561831866536`: conferir que a lista de permissões inclui `ads_management` (as conexões já feitas indicam que sim).
2. Confirmar Acesso Avançado/App Review de `ads_management` antes de conectar clientes que não tenham função no aplicativo.
3. Regularizar o pagamento da conta **Escola Crescer** (status 3) se quiser operá-la.
4. Reautorizar em **Integrações** qualquer conexão cuja leitura ao vivo acuse permissão ausente, recusada ou expirada.

## 2. Limite percentual do orçamento
- Antes: a interface aceitava no máximo 10× o orçamento atual (`novo × 100 ≤ atual × 1000`); o executor aceita aumento de até 1000% sobre o atual, ou seja, até 11× (`(novo − atual) × 100 ≤ atual × 1000`). A interface era um passo mais restritiva; o executor nunca foi ampliado.
- Agora a interface usa a mesma fórmula e o mesmo limite (importado de `policy.ts`, fonte única), com BigInt. Teste de paridade compara interface e `evaluateDelegatedAction` em toda a fronteira (valores de 1 a ~10¹¹).

## 3. Roteiro da primeira operação real (NÃO executar sem autorização)
Pré-requisito: uma campanha **criada só para teste**, com orçamento baixo, em conta com `account_status` 1, escolhida pelo proprietário.

1. Proprietário informa: cliente, conta, campanha (nome e ID) e o orçamento de teste.
2. Conferir em **Integrações** que a conexão está ativa e que a página da campanha mostra o cartão "Operações" sem avisos (leitura ao vivo de `ads_management` válida).
3. Registrar o estado anterior (status e orçamento) pela própria tela (o cartão mostra o estado lido agora na Meta).
4. **Estado real do executor (conferido em 21/10):** `AGENT_SCHEDULER_ENABLED` está ligado em produção e o direito `agent_executor_meta` está ligado globalmente, com override da organização iGrow Digital até **26/10/2026 13:07 UTC** (homologação controlada, Colégio Crescer, teto R$ 100,00/dia). Ou seja, os botões **já executam de verdade** para proprietário/administrador dessa organização. Antes do teste, o proprietário deve decidir: manter, renovar ou revogar o override (`private.entitlement_overrides`, linha `agent_executor_meta`); após o teste, revogar ou deixar expirar.
5. **A) Pausar:** botão Pausar › caixa de confirmação › Confirmar pausa. Esperado: "confirmada na Meta"; histórico com estado anterior ATIVA e confirmado PAUSADA; conferir no Gerenciador de Anúncios.
6. **B) Retomar:** Retomar › confirmar (marca o reconhecimento financeiro). Esperado: Ativa, orçamento inalterado.
7. **C) Orçamento:** alterar para um valor pequeno dentro do limite (p. ex. +10%), conferir "anterior → novo", confirmar. Esperado: orçamento novo confirmado na Meta e no histórico.
8. Verificar o ledger (`agent_action_jobs`, `agent_action_events`): `execution_origin = manual`, `requested_by` correto, `before_state`/`after_state` preenchidos, status `verified`, nenhuma operação em `needs_verification`.
9. Desligar o executor novamente e registrar o resultado.

Parar e investigar (sem repetir o envio) se qualquer passo aparecer como "aguardando verificação" ou "bloqueado".

## 4. Homologação
Recomendação mantida: **projeto Supabase novo e vazio** + cadeia completa de `supabase/migrations` (a mesma que `node supabase/tests/rls-smoke.mjs` replica do zero). Custos e dependências a aprovar pelo proprietário antes de criar: um projeto Supabase adicional (custo recorrente do plano), um projeto Vercel de homologação (já existe `i-grow-reports-homolog`), variáveis do ambiente (sem segredos de produção, sem cópia de dados de clientes) e uma aplicação Meta de teste. A homologação atual não deve ser resetada nem usada para Campanhas.
