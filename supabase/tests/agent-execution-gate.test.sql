begin;
set local search_path=public,extensions;
select no_plan();

select ok(exists(select 1 from private.entitlement_definitions
  where key='agent_executor_meta' and not globally_enabled),
  'Executor nasce desabilitado globalmente');
select ok(not has_function_privilege('authenticated', 'public.agent_meta_execution_allowed(uuid)', 'EXECUTE'),
  'Autenticados nao consultam gate de execucao por RPC');
select ok(not has_function_privilege('authenticated', 'public.agent_claim_action(uuid,uuid)', 'EXECUTE'),
  'Autenticados nao podem adquirir jobs por RPC');
select ok(not has_function_privilege('anon', 'public.agent_claim_action(uuid,uuid)', 'EXECUTE'),
  'Anon nao pode adquirir jobs');
select ok(has_function_privilege('service_role','public.agent_claim_action(uuid,uuid)','EXECUTE'),
  'Somente service_role recebe permissao de claim');
select ok(has_function_privilege('service_role','public.agent_meta_execution_allowed(uuid)','EXECUTE'),
  'Somente service_role recebe gate');

-- Conta ficticia sem plano nem concessao, e feature global DESLIGADA.
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select is(public.agent_meta_execution_allowed('10000000-0000-4000-8000-000000000001'), false,
  'Mesmo service_role nao contorna o desligamento global');
select is(public.agent_claim_action('10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000003'), false,
  'Claim de job inexistente nunca autoriza execucao');
reset role;
select * from finish();
rollback;
