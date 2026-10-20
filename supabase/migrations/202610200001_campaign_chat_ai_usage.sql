-- Contabiliza o chat consultivo de Campanhas (Assistente Groow) na mesma tabela e cota mensal que ja controlam a IA de texto.
-- ARQUIVO LOCAL PARA REVISAO: NAO aplicada em nenhum banco. Nao altera dados existentes nem migrations historicas.
--
-- Categorias atuais de ai_usage.feature (202610190001_agent_decision_ai_usage.sql):
--   report_comment, portfolio_summary, whatsapp_summary, agent_decision
-- Esta migration preserva todas e acrescenta: campaign_chat.

-- Remove TODA restricao de checagem que limita os valores de ai_usage.feature (por definicao, nao pelo nome): se o nome de alguma
-- divergir em um ambiente, ela nao pode continuar bloqueando a nova categoria. A restricao canonica abaixo sempre e recriada.
do $$
declare r record;
begin
  for r in select c.conname from pg_constraint c
            where c.conrelid = 'public.ai_usage'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) ~ '\mfeature\M.*= ANY'
  loop
    raise notice 'ai_usage: removendo restricao de categoria %', r.conname;
    execute format('alter table public.ai_usage drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.ai_usage add constraint ai_usage_feature_check
  check (feature in ('report_comment','portfolio_summary','whatsapp_summary','agent_decision','campaign_chat'));

-- Permite que o codigo CONFIRME, em tempo de execucao, que o banco do ambiente aceita a categoria. Sem esta funcao (migration nao
-- aplicada) ou diante de qualquer erro, o chat permanece indisponivel: nenhuma chamada paga e feita sem contabilizacao possivel.
create or replace function public.ai_usage_supports_feature(p_feature text)
returns boolean language sql stable security definer set search_path = '' as $$
  -- TODAS as restricoes de checagem que mencionam a coluna feature precisam aceitar a categoria (cobre ambientes em que o nome da
  -- restricao antiga divergiu e continua valendo). Sem nenhuma restricao encontrada, o resultado e falso.
  select coalesce(bool_and(position(quote_literal(p_feature) in pg_get_constraintdef(c.oid)) > 0), false)
  from pg_constraint c
  where c.conrelid = 'public.ai_usage'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%feature%';
$$;
revoke all on function public.ai_usage_supports_feature(text) from public, anon, authenticated;
grant execute on function public.ai_usage_supports_feature(text) to service_role;
