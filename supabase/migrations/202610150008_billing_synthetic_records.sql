-- Etapa 2.2D: registros FINANCEIROS FICTÍCIOS (testes sem contrapartida real no Asaas) ficam fora da reconciliação.
-- Sem isto, quando o cron permanente for ligado, a conferência trataria toda assinatura fictícia como "removida" (404 no Asaas) e a alteraria.
-- A marca fica no cliente financeiro da organização (billing_customers.synthetic). Nada é marcado por esta migration; marcar exige um
-- passo explícito e autorizado (public.billing_mark_synthetic). Não apaga, não cancela e não altera nenhum registro existente.
-- Só billing_reconcile_work muda (mesma função da 0005 + exclusão dos fictícios). A manutenção periódica (prazos) não é alterada.
-- Aplicada SOMENTE em igrow-homologacao (xvjvfvinnnrgnhskglvd) em 15/10/2026; NÃO aplicada em produção.

alter table private.billing_customers add column if not exists synthetic boolean not null default false;

create or replace function public.billing_reconcile_work(p_limit integer default 20, p_environment text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_intents jsonb; v_subs jsonb;
begin
  with picked as (
    select i.id from private.billing_checkout_intents i
    where i.dispatched_at is not null and (p_environment is null or i.environment = p_environment)
      and not exists (select 1 from private.billing_customers syn where syn.agency_id = i.agency_id and syn.environment = i.environment and syn.synthetic)
      and ((i.status in ('dispatching', 'unknown', 'awaiting_payment') and i.dispatched_at < now() - interval '2 minutes')
        -- Expirada e NÃO conferida: continua sendo conferida enquanto for necessário (a cada 4 min no 1º dia, depois a cada 30 min); sem prazo final.
        or (i.status = 'expired' and i.verified_after_expiry_at is null)
        -- Já conferida: nova conferência a cada 6 horas por 3 dias após a expiração (o checkout não pode mais ser pago; é só defesa extra).
        or (i.status = 'expired' and i.verified_after_expiry_at is not null and i.expires_at > now() - interval '3 days'))
      and (i.recovery_checked_at is null or i.recovery_checked_at < now() - case
             when i.status = 'expired' and i.verified_after_expiry_at is not null then interval '6 hours'
             when i.status = 'expired' and i.expires_at < now() - interval '1 day' then interval '30 minutes'
             else interval '4 minutes' end)
    order by i.created_at limit 25 for update of i skip locked),
  stamped as (
    update private.billing_checkout_intents i set recovery_checked_at = now() from picked where i.id = picked.id
    returning i.id, i.environment, i.agency_id, i.status)
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'environment', s.environment, 'status', s.status, 'asaas_customer_id', bc.asaas_customer_id)), '[]'::jsonb)
    into v_intents
    from stamped s join private.billing_customers bc on bc.agency_id = s.agency_id and bc.environment = s.environment;

  -- Assinaturas a conferir: REIVINDICADAS (carimbo de tentativa, skip locked), por prioridade e em rodízio. Uma assinatura com erro não volta ao
  -- topo da fila a cada rodada (nova tentativa só depois de 4 min) e não impede a conferência das demais; quem precisa de atendimento vem antes.
  with eligible as (
    select s.id, case when s.status in ('past_due', 'suspended') then 1
                      when s.status = 'active' and s.next_due_date <= ((now() at time zone 'America/Sao_Paulo')::date + 1) then 2
                      when s.status = 'pending' then 3 else 4 end as prio
    from private.billing_subscriptions s
    where s.status in ('pending', 'active', 'past_due', 'suspended') and (p_environment is null or s.environment = p_environment)
      and not exists (select 1 from private.billing_customers syn where syn.agency_id = s.agency_id and syn.environment = s.environment and syn.synthetic)
      and (s.last_reconciled_at is null or s.last_reconciled_at < now() - case
             when s.status = 'pending' and s.created_at > now() - interval '3 days' then interval '5 minutes'
             when s.status in ('past_due', 'suspended') then interval '1 hour'
             when s.status = 'active' and s.next_due_date <= ((now() at time zone 'America/Sao_Paulo')::date + 1) then interval '1 hour'
             else interval '1 day' end)
      and (s.reconcile_attempted_at is null or s.reconcile_attempted_at < now() - interval '4 minutes')
    order by 2, s.reconcile_attempted_at nulls first, s.last_reconciled_at nulls first
    limit greatest(1, least(coalesce(p_limit, 20), 100)) for update of s skip locked),
  stamped as (
    update private.billing_subscriptions s set reconcile_attempted_at = now() from eligible e where s.id = e.id
    returning s.id, s.environment, s.asaas_subscription_id, e.prio, s.last_reconciled_at)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'environment', environment, 'asaas_subscription_id', asaas_subscription_id)
           order by prio, last_reconciled_at nulls first), '[]'::jsonb) into v_subs from stamped;

  return jsonb_build_object(
    -- Assinatura pendente (pagamento ainda não refletido) é conferida a cada 5 minutos por 3 dias; as demais, uma vez por dia.
    'reconcile', v_subs,
    'remote_cancel', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'environment', c.environment, 'asaas_subscription_id', c.asaas_subscription_id))
      from (select rs.id, rs.environment, rs.asaas_subscription_id from private.billing_subscriptions rs where rs.remote_cancel_pending and not exists (select 1 from private.billing_customers syn where syn.agency_id = rs.agency_id and syn.environment = rs.environment and syn.synthetic) limit 50) c), '[]'::jsonb),
    'intents', v_intents);
end $$;

-- Marca (ou desmarca) uma organização como FICTÍCIA para fins de reconciliação.
-- Só o servidor (service_role) executa; usuários comuns, anônimos e o painel do operador NÃO têm acesso. Proteções:
--  - exige motivo (mínimo de 10 caracteres) para marcar;
--  - RECUSA marcar organização com cliente financeiro no formato real do Asaas (cus_ + 12 dígitos): quem tem contrapartida real nunca é excluído;
--  - exige que a organização tenha cliente financeiro (nada é criado);
--  - toda marcação/desmarcação fica na auditoria financeira imutável (billing.synthetic_marked / billing.synthetic_unmarked) com o motivo.
create function public.billing_mark_synthetic(p_agency_id uuid, p_synthetic boolean default true, p_reason text default null)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v_rows integer; v_mark boolean := coalesce(p_synthetic, true);
begin
  if v_mark and (p_reason is null or char_length(btrim(p_reason)) < 10) then
    raise exception 'Informe o motivo da marcação (mínimo de 10 caracteres).' using errcode = '22023';
  end if;
  if v_mark and exists (select 1 from private.billing_customers c where c.agency_id = p_agency_id and c.asaas_customer_id ~ '^cus_[0-9]{12}$') then
    raise exception 'Organização com cliente financeiro real do Asaas não pode ser marcada como fictícia.' using errcode = '42501';
  end if;
  if not exists (select 1 from private.billing_customers where agency_id = p_agency_id) then
    raise exception 'Organização sem cliente financeiro.' using errcode = 'P0002';
  end if;
  update private.billing_customers set synthetic = v_mark where agency_id = p_agency_id and synthetic is distinct from v_mark;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    perform private.billing_audit('system', null, p_agency_id, null, case when v_mark then 'billing.synthetic_marked' else 'billing.synthetic_unmarked' end,
      jsonb_build_object('reason', left(btrim(coalesce(p_reason, '')), 200), 'customers', v_rows));
  end if;
  return v_rows;
end $$;

-- Relatório verificável das organizações marcadas (identificadores, ligações financeiras e motivo registrado).
create function public.billing_synthetic_report()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'agency_id', a.id, 'agency_name', a.name,
    'customers', (select jsonb_agg(c.asaas_customer_id order by c.asaas_customer_id) from private.billing_customers c where c.agency_id = a.id),
    'subscriptions', (select jsonb_agg(s.asaas_subscription_id order by s.asaas_subscription_id) from private.billing_subscriptions s where s.agency_id = a.id),
    'marked_reason', (select l.metadata ->> 'reason' from private.billing_audit_log l where l.agency_id = a.id and l.action = 'billing.synthetic_marked' order by l.id desc limit 1)
  ) order by a.name), '[]'::jsonb)
  from public.agencies a where exists (select 1 from private.billing_customers c where c.agency_id = a.id and c.synthetic);
$$;

revoke all on function public.billing_mark_synthetic(uuid, boolean, text), public.billing_synthetic_report() from public, anon, authenticated;
grant execute on function public.billing_mark_synthetic(uuid, boolean, text), public.billing_synthetic_report() to service_role;
