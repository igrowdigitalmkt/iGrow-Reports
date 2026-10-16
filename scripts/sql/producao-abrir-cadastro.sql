-- ABERTURA DO CADASTRO PÚBLICO (NÃO EXECUTADO). Rodar UMA vez, somente com ordem expressa, DEPOIS de: código publicado, Asaas e webhook configurados,
-- cron saudável e uma contratação real validada (ativação, direitos e webhook). Faz duas coisas na MESMA transação:
--  1) liga o teste gratuito de 7 dias (aponta o plano "Teste gratuito" publicado pelo script comercial);
--  2) devolve a permissão de criar organização aos usuários autenticados (o cadastro volta a funcionar).
-- Assim nunca existe cadastro aberto sem teste configurado nem teste sem contratação operacional.
begin;
update private.billing_settings set trial_plan_version_id = 'c1000000-0000-4000-8000-000000000001'
  where exists (select 1 from private.plan_versions v join private.plans p on p.id = v.plan_id
    where v.id = 'c1000000-0000-4000-8000-000000000001' and v.status = 'published' and p.visibility = 'private' and not p.sellable);
grant execute on function public.create_own_agency(text, text) to authenticated;
-- CONFERÊNCIA (leitura): ambos devem ser verdadeiros; live_enabled não é alterado.
select (select trial_plan_version_id is not null from private.billing_settings) teste_ligado,
  has_function_privilege('authenticated','public.create_own_agency(text,text)','execute') cadastro_aberto,
  (select live_enabled from private.billing_settings) live_enabled;
commit;
