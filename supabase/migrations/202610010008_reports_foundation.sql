-- Report snapshots foundation.
-- Published versions are immutable and never depend on a live Meta request.

create table public.report_templates (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete restrict,
  name text not null check (char_length(name) between 2 and 160),
  description text,
  kind text not null default 'custom'
    check (kind in ('leads','conversations','sales','custom')),
  archived_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, id),
  constraint report_templates_creator_fkey foreign key (agency_id, created_by)
    references public.agency_users(agency_id, user_id) on delete set null (created_by)
);

create table public.report_template_versions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  template_id uuid not null,
  version_number integer not null check (version_number > 0),
  config jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (agency_id, id),
  unique (agency_id, template_id, version_number),
  foreign key (agency_id, template_id)
    references public.report_templates(agency_id, id) on delete restrict,
  constraint report_template_versions_creator_fkey foreign key (agency_id, created_by)
    references public.agency_users(agency_id, user_id) on delete set null (created_by)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_id uuid not null,
  title text not null default 'Relatório de performance'
    check (char_length(title) between 2 and 200),
  template_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (agency_id, id),
  foreign key (agency_id, client_id)
    references public.clients(agency_id, id) on delete restrict,
  foreign key (agency_id, template_id)
    references public.report_templates(agency_id, id) on delete restrict,
  constraint reports_creator_fkey foreign key (agency_id, created_by)
    references public.agency_users(agency_id, user_id) on delete set null (created_by)
);
create index reports_client_idx on public.reports(agency_id, client_id, created_at desc);

create table public.report_versions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  report_id uuid not null,
  client_id uuid not null,
  version_number integer not null check (version_number > 0),
  template_version_id uuid,
  date_from date not null,
  date_to date not null,
  currency text,
  timezone_name text,
  state text not null default 'ready'
    check (state in ('ready','published','superseded')),
  configuration_snapshot jsonb not null default '{}'::jsonb,
  data_collected_at timestamptz,
  generated_at timestamptz not null default now(),
  published_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (agency_id, id),
  unique (agency_id, report_id, version_number),
  foreign key (agency_id, report_id)
    references public.reports(agency_id, id) on delete restrict,
  foreign key (agency_id, client_id)
    references public.clients(agency_id, id) on delete restrict,
  foreign key (agency_id, template_version_id)
    references public.report_template_versions(agency_id, id) on delete restrict,
  constraint report_versions_period_check check (date_to >= date_from),
  constraint report_versions_creator_fkey foreign key (agency_id, created_by)
    references public.agency_users(agency_id, user_id) on delete set null (created_by)
);
create index report_versions_client_period_idx
  on public.report_versions(agency_id, client_id, date_to desc, generated_at desc);
create index report_versions_state_idx
  on public.report_versions(agency_id, state, published_at desc);
create table public.report_data_snapshots (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  report_version_id uuid not null,
  summary_json jsonb not null,
  quality_status text not null default 'complete'
    check (quality_status in ('complete','warning','blocked')),
  source_api_version text,
  collected_at timestamptz,
  created_at timestamptz not null default now(),
  unique (agency_id, report_version_id),
  foreign key (agency_id, report_version_id)
    references public.report_versions(agency_id, id) on delete restrict
);

create table public.report_metrics (
  agency_id uuid not null,
  report_version_id uuid not null,
  metric_key text not null,
  label text not null,
  unit text not null check (unit in ('currency','integer','percent','ratio')),
  numeric_value numeric,
  display_precision smallint not null default 2 check (display_precision between 0 and 6),
  definition_version integer not null default 1 check (definition_version > 0),
  created_at timestamptz not null default now(),
  primary key (agency_id, report_version_id, metric_key),
  foreign key (agency_id, report_version_id)
    references public.report_versions(agency_id, id) on delete restrict
);
create index report_metrics_version_idx
  on public.report_metrics(agency_id, report_version_id);

create function private.touch_report_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger report_templates_touch before update on public.report_templates
for each row execute function private.touch_report_updated_at();

create function private.block_report_snapshot_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Snapshot de relatório é imutável.' using errcode = '42501';
end;
$$;

create trigger report_template_versions_immutable
before update or delete on public.report_template_versions
for each row execute function private.block_report_snapshot_mutation();

create trigger report_data_snapshots_immutable
before update or delete on public.report_data_snapshots
for each row execute function private.block_report_snapshot_mutation();

create trigger report_metrics_immutable
before update or delete on public.report_metrics
for each row execute function private.block_report_snapshot_mutation();

create function private.guard_report_version_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.state = 'superseded'
    or (old.state = 'published' and new.state <> 'superseded') then
    raise exception 'Versão publicada é imutável.' using errcode = '42501';
  end if;
  if new.agency_id <> old.agency_id
    or new.report_id <> old.report_id
    or new.client_id <> old.client_id
    or new.version_number <> old.version_number
    or new.date_from <> old.date_from
    or new.date_to <> old.date_to
    or new.currency is distinct from old.currency
    or new.timezone_name is distinct from old.timezone_name
    or new.template_version_id is distinct from old.template_version_id
    or new.configuration_snapshot is distinct from old.configuration_snapshot
    or new.data_collected_at is distinct from old.data_collected_at
    or new.generated_at <> old.generated_at
    or new.created_by is distinct from old.created_by
    or new.created_at <> old.created_at then
    raise exception 'Conteúdo da versão não pode ser alterado.' using errcode = '42501';
  end if;
  if old.state = 'ready' and new.state not in ('ready','published') then
    raise exception 'Transição de estado inválida.' using errcode = '22023';
  end if;
  if old.state = 'published' and new.state <> 'superseded' then
    raise exception 'Transição de estado inválida.' using errcode = '22023';
  end if;
  if new.state = 'published' and new.published_at is null then
    raise exception 'Publicação exige data.' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger report_versions_guard
before update on public.report_versions
for each row execute function private.guard_report_version_mutation();
alter table public.report_templates enable row level security;
alter table public.report_template_versions enable row level security;
alter table public.reports enable row level security;
alter table public.report_versions enable row level security;
alter table public.report_data_snapshots enable row level security;
alter table public.report_metrics enable row level security;

revoke all on table public.report_templates, public.report_template_versions,
  public.reports, public.report_versions, public.report_data_snapshots,
  public.report_metrics from public, anon, authenticated;

grant select on table public.report_templates, public.report_template_versions,
  public.reports, public.report_versions, public.report_data_snapshots,
  public.report_metrics to authenticated;

grant insert (agency_id,name,description,kind) on public.report_templates to authenticated;
grant update (name,description,kind,archived_at) on public.report_templates to authenticated;
grant insert (agency_id,template_id,version_number,config) on public.report_template_versions to authenticated;

grant all on table public.report_templates, public.report_template_versions,
  public.reports, public.report_versions, public.report_data_snapshots,
  public.report_metrics to service_role;

create policy report_templates_read on public.report_templates for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy report_template_versions_read on public.report_template_versions for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy reports_read on public.reports for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy report_versions_read on public.report_versions for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy report_data_snapshots_read on public.report_data_snapshots for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy report_metrics_read on public.report_metrics for select to authenticated
  using (private.agency_role(agency_id) is not null);

create policy report_templates_insert on public.report_templates for insert to authenticated
  with check (
    private.has_agency_role(
      agency_id, array['owner','admin','editor']::public.agency_role[]
    )
  );
create policy report_templates_update on public.report_templates for update to authenticated
  using (
    private.has_agency_role(
      agency_id, array['owner','admin','editor']::public.agency_role[]
    )
  )
  with check (
    private.has_agency_role(
      agency_id, array['owner','admin','editor']::public.agency_role[]
    )
  );
create policy report_template_versions_insert on public.report_template_versions for insert to authenticated
  with check (
    private.has_agency_role(
      agency_id, array['owner','admin','editor']::public.agency_role[]
    )
  );
create function public.create_manual_report_version(
  p_agency_id uuid,
  p_client_id uuid,
  p_date_from date,
  p_date_to date,
  p_report_id uuid default null,
  p_title text default 'Relatório de performance'
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_report_id uuid;
  v_version_id uuid;
  v_version_number integer;
  v_summary record;
  v_api_version text;
  v_collected_at timestamptz;
  v_title text;
begin
  if not private.has_agency_role(
    p_agency_id, array['owner','admin','editor']::public.agency_role[]
  ) then
    raise exception 'Sem permissão para gerar relatório.' using errcode = '42501';
  end if;

  if not exists(
    select 1 from public.clients
    where agency_id = p_agency_id and id = p_client_id and archived_at is null
  ) then
    raise exception 'Cliente ativo indisponível.' using errcode = '22023';
  end if;

  select * into v_summary
  from public.get_client_portal_metric_summary(p_client_id,p_date_from,p_date_to);

  if v_summary.data_status <> 'ok' then
    raise exception 'Os dados do período não estão prontos para gerar relatório.'
      using errcode = '22023';
  end if;
  if v_summary.primary_metric_key is null then
    raise exception 'Configure o resultado principal antes de gerar relatório.'
      using errcode = '22023';
  end if;

  v_title := btrim(coalesce(p_title,''));
  if char_length(v_title) not between 2 and 200 then
    raise exception 'Título de relatório inválido.' using errcode = '22023';
  end if;

  if p_report_id is null then
    insert into public.reports(agency_id,client_id,title,created_by)
    values(p_agency_id,p_client_id,v_title,auth.uid())
    returning id into v_report_id;
    v_version_number := 1;
  else
    select id into v_report_id
    from public.reports
    where agency_id = p_agency_id and id = p_report_id and client_id = p_client_id;
    if v_report_id is null then
      raise exception 'Relatório indisponível.' using errcode = '22023';
    end if;
    select coalesce(max(version_number),0)+1 into v_version_number
    from public.report_versions
    where agency_id = p_agency_id and report_id = v_report_id;
  end if;

  select max(i.api_version), max(i.collected_at)
  into v_api_version, v_collected_at
  from public.meta_daily_insights i
  join public.client_ad_accounts ca
    on ca.agency_id = i.agency_id and ca.ad_account_id = i.ad_account_id
  where i.agency_id = p_agency_id
    and ca.client_id = p_client_id
    and ca.active
    and i.level = 'account'
    and i.insight_date between p_date_from and p_date_to;

  insert into public.report_versions(
    agency_id,report_id,client_id,version_number,date_from,date_to,
    currency,timezone_name,state,configuration_snapshot,data_collected_at,created_by
  ) values(
    p_agency_id,v_report_id,p_client_id,v_version_number,p_date_from,p_date_to,
    v_summary.currency,v_summary.timezone_name,'ready',
    jsonb_build_object(
      'primary_metric_key',v_summary.primary_metric_key,
      'ad_account_count',v_summary.ad_account_count,
      'source','meta_aggregated',
      'snapshot_version',1
    ),
    v_collected_at,auth.uid()
  ) returning id into v_version_id;

  insert into public.report_data_snapshots(
    agency_id,report_version_id,summary_json,quality_status,source_api_version,collected_at
  ) values(
    p_agency_id,v_version_id,
    jsonb_build_object(
      'spend',v_summary.spend,
      'impressions',v_summary.impressions,
      'link_clicks',v_summary.link_clicks,
      'primary_metric_key',v_summary.primary_metric_key,
      'primary_results',v_summary.primary_results,
      'attributed_revenue',v_summary.attributed_revenue,
      'ctr_link',v_summary.ctr_link,
      'cpc_link',v_summary.cpc_link,
      'cpm',v_summary.cpm,
      'cost_per_result',v_summary.cost_per_result,
      'roas',v_summary.roas,
      'latest_data_date',v_summary.latest_data_date
    ),
    'complete',v_api_version,v_collected_at
  );

  insert into public.report_metrics(
    agency_id,report_version_id,metric_key,label,unit,numeric_value,
    display_precision,definition_version
  )
  select
    p_agency_id,v_version_id,d.key,d.label,d.unit,
    case d.key
      when 'spend' then v_summary.spend
      when 'impressions' then v_summary.impressions::numeric
      when 'link_clicks' then v_summary.link_clicks::numeric
      when 'ctr_link' then v_summary.ctr_link
      when 'cpc_link' then v_summary.cpc_link
      when 'cpm' then v_summary.cpm
      when 'cost_per_result' then v_summary.cost_per_result
      when 'attributed_revenue' then v_summary.attributed_revenue
      when 'roas' then v_summary.roas
      when v_summary.primary_metric_key then v_summary.primary_results
      else null
    end,
    d.display_precision,d.definition_version
  from public.metric_definitions d
  where d.key in (
    'spend','impressions','link_clicks','ctr_link','cpc_link','cpm',
    'cost_per_result','attributed_revenue','roas',v_summary.primary_metric_key
  )
  and case d.key
      when 'spend' then v_summary.spend
      when 'impressions' then v_summary.impressions::numeric
      when 'link_clicks' then v_summary.link_clicks::numeric
      when 'ctr_link' then v_summary.ctr_link
      when 'cpc_link' then v_summary.cpc_link
      when 'cpm' then v_summary.cpm
      when 'cost_per_result' then v_summary.cost_per_result
      when 'attributed_revenue' then v_summary.attributed_revenue
      when 'roas' then v_summary.roas
      when v_summary.primary_metric_key then v_summary.primary_results
      else null
    end is not null;

  insert into public.audit_logs(agency_id,actor_id,action,entity_id,metadata)
  values(
    p_agency_id,auth.uid(),'report.version_created',v_version_id,
    jsonb_build_object(
      'client_id',p_client_id,
      'report_id',v_report_id,
      'version_number',v_version_number,
      'date_from',p_date_from,
      'date_to',p_date_to
    )
  );

  return v_version_id;
end;
$$;
create function public.publish_report_version(
  p_agency_id uuid,
  p_report_version_id uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_report_id uuid;
  v_client_id uuid;
begin
  if not private.has_agency_role(
    p_agency_id, array['owner','admin','editor']::public.agency_role[]
  ) then
    raise exception 'Sem permissão para publicar relatório.' using errcode = '42501';
  end if;

  select report_id,client_id into v_report_id,v_client_id
  from public.report_versions
  where agency_id = p_agency_id and id = p_report_version_id and state = 'ready';

  if v_report_id is null then
    raise exception 'Versão pronta indisponível.' using errcode = '22023';
  end if;

  update public.report_versions
  set state = 'superseded'
  where agency_id = p_agency_id
    and report_id = v_report_id
    and state = 'published'
    and id <> p_report_version_id;

  update public.report_versions
  set state = 'published', published_at = now()
  where agency_id = p_agency_id and id = p_report_version_id and state = 'ready';

  insert into public.audit_logs(agency_id,actor_id,action,entity_id,metadata)
  values(
    p_agency_id,auth.uid(),'report.version_published',p_report_version_id,
    jsonb_build_object('client_id',v_client_id,'report_id',v_report_id)
  );
end;
$$;

create function public.list_client_portal_reports(p_client_id uuid)
returns table(
  report_version_id uuid,
  report_id uuid,
  title text,
  version_number integer,
  date_from date,
  date_to date,
  currency text,
  timezone_name text,
  data_collected_at timestamptz,
  published_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_agency_id uuid;
begin
  select agency_id into v_agency_id from public.clients where id = p_client_id;
  if v_agency_id is null then
    raise exception 'Cliente indisponível.' using errcode = '22023';
  end if;
  if private.agency_role(v_agency_id) is null
    and not private.has_client_access(v_agency_id,p_client_id) then
    raise exception 'Sem permissão para consultar relatórios.' using errcode = '42501';
  end if;

  return query
  select rv.id,r.id,r.title,rv.version_number,rv.date_from,rv.date_to,
    rv.currency,rv.timezone_name,rv.data_collected_at,rv.published_at
  from public.report_versions rv
  join public.reports r
    on r.agency_id = rv.agency_id and r.id = rv.report_id
  where rv.agency_id = v_agency_id
    and rv.client_id = p_client_id
    and rv.state in ('published','superseded')
  order by rv.published_at desc, rv.id desc;
end;
$$;

create function public.get_client_portal_report_metrics(p_report_version_id uuid)
returns table(
  metric_key text,
  label text,
  unit text,
  numeric_value numeric,
  display_precision smallint
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_agency_id uuid;
  v_client_id uuid;
  v_state text;
begin
  select agency_id,client_id,state into v_agency_id,v_client_id,v_state
  from public.report_versions where id = p_report_version_id;

  if v_agency_id is null or v_state not in ('published','superseded') then
    raise exception 'Versão publicada indisponível.' using errcode = '22023';
  end if;
  if private.agency_role(v_agency_id) is null
    and not private.has_client_access(v_agency_id,v_client_id) then
    raise exception 'Sem permissão para consultar relatório.' using errcode = '42501';
  end if;

  return query
  select rm.metric_key,rm.label,rm.unit,rm.numeric_value,rm.display_precision
  from public.report_metrics rm
  where rm.agency_id = v_agency_id and rm.report_version_id = p_report_version_id
  order by case rm.metric_key
    when 'spend' then 1
    when 'leads' then 2
    when 'conversations' then 2
    when 'purchases' then 2
    when 'cost_per_result' then 3
    when 'ctr_link' then 4
    when 'link_clicks' then 5
    when 'cpc_link' then 6
    when 'cpm' then 7
    when 'attributed_revenue' then 8
    when 'roas' then 9
    else 50 end, rm.metric_key;
end;
$$;

revoke all on function private.touch_report_updated_at(),
  private.block_report_snapshot_mutation(), private.guard_report_version_mutation()
  from public, anon, authenticated, service_role;

revoke all on function public.create_manual_report_version(uuid,uuid,date,date,uuid,text),
  public.publish_report_version(uuid,uuid),
  public.list_client_portal_reports(uuid),
  public.get_client_portal_report_metrics(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.create_manual_report_version(uuid,uuid,date,date,uuid,text),
  public.publish_report_version(uuid,uuid),
  public.list_client_portal_reports(uuid),
  public.get_client_portal_report_metrics(uuid)
  to authenticated;
