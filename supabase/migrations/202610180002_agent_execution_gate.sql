-- Executor comercial: opt-in DESLIGADO por padrao. Nao aplicar em producao sem aprovacao.
-- Sem essa feature explicitamente habilitada, nenhuma acao Meta pode chegar ao POST.
insert into private.entitlement_definitions
  (key, kind, label, description, sort_order, globally_enabled, disabled_reason)
values
  ('agent_executor_meta', 'feature', 'Agente executor Meta',
   'Execucao delegada de alteracoes reais em contas Meta Ads.', 15, false,
   'Aguardando homologacao controlada e aprovacao do proprietario.')
on conflict (key) do nothing;

-- RPC SOMENTE service_role para PostgREST (private nao e schema exposto).
-- Falha fechada para funcao ausente, recurso global inativo, plano inelegivel
-- e assinatura financeiramente restrita.
create function public.agent_meta_execution_allowed(p_agency_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare permission private.entitlement_result;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Operacao reservada ao servico' using errcode = '42501';
  end if;
  permission := private.resolve_entitlement(p_agency_id, 'agent_executor_meta');
  return coalesce(permission.enabled, false)
    and not public.agency_billing_restricted(p_agency_id);
end;
$$;
revoke all on function public.agent_meta_execution_allowed(uuid) from public, anon, authenticated;
grant execute on function public.agent_meta_execution_allowed(uuid) to service_role;

-- Claim atomico e escopado a organizacao: impossivel adquirir duas vezes.
create function public.agent_claim_action(p_agency_id uuid, p_job_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Operacao reservada ao servico' using errcode = '42501';
  end if;
  return private.agent_claim_action(p_agency_id, p_job_id);
end;
$$;
revoke all on function public.agent_claim_action(uuid,uuid) from public, anon, authenticated;
grant execute on function public.agent_claim_action(uuid,uuid) to service_role;
