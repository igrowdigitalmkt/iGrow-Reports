-- Operacao MANUAL: o clique de um usuario autenticado e o ato explicito; nao e delegacao da IA.
-- Jobs manuais nao dependem de delegacao, mas continuam no mesmo ledger, na mesma fila
-- (uma mutacao nao resolvida por conta) e na mesma trilha de auditoria. Jobs da IA SEMPRE
-- exigem delegacao. NAO aplicada em producao.
alter table public.agent_action_jobs alter column delegation_id drop not null;
alter table public.agent_action_jobs add constraint agent_jobs_delegation_by_origin_check
  check (execution_origin = 'manual' or delegation_id is not null);
-- O FK composto (agency, client, conta, delegacao) deixa de ser verificado quando delegation_id e nulo
-- (MATCH SIMPLE): o vinculo cliente/conta do job manual e conferido pelo servidor e pelo runtime.
