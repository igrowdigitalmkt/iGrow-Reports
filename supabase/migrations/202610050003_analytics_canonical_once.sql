-- Expand each daily row's canonical values once, when it is read, instead of
-- once per aggregate (period summary, day, account total, campaign). Results
-- are unchanged: the expanded row no longer carries the raw canonical_values,
-- which makes a second canonical_daily_row call a no-op, and the action
-- catalog keeps using the raw daily actions as before.
create or replace function private.canonical_daily_row(p_row jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare v_values jsonb:=p_row->'canonical_values';v_actions jsonb;v_revenues jsonb;v_results jsonb;
begin
  if p_row->>'analytics_version' is distinct from '11' or jsonb_typeof(v_values) is distinct from 'object' then return p_row;end if;
  select coalesce(jsonb_object_agg(substr(key,8),value),'{}') into v_actions from jsonb_each(v_values) where key like 'action:%';
  select coalesce(jsonb_object_agg(substr(key,14),value),'{}') into v_revenues from jsonb_each(v_values) where key like 'value:action:%';
  select coalesce(jsonb_object_agg(key,value),'{}') into v_results from jsonb_each(v_values)
    where key='result:provider_known' or key like 'result:provider:%';
  return (p_row-'canonical_values')||v_values||jsonb_build_object('actions',v_actions,'revenues',v_revenues,'provider_results',v_results);
end;
$$;
revoke all on function private.canonical_daily_row(jsonb) from public,anon,authenticated,service_role;

do $$
declare v_definition text;v_before text;
begin
  v_definition:=replace(pg_get_functiondef('private.client_analytics_base(uuid,date,date,uuid[])'::regprocedure),E'\r','');
  v_before:=v_definition;
  v_definition:=replace(v_definition,E'    select i.*,p.label,\n      jsonb_build_object(\n        ''analytics_version''',
    E'    select i.*,p.label,coalesce(ac.actions,''{}''::jsonb) as raw_actions,\n      private.canonical_daily_row(jsonb_build_object(\n        ''analytics_version''');
  v_definition:=replace(v_definition,E'\n      ) as value_row\n',E'\n      )) as value_row\n');
  v_definition:=replace(v_definition,'jsonb_object_keys(i.value_row->''actions'') action_type','jsonb_object_keys(i.raw_actions) action_type');
  if v_definition=v_before or position('raw_actions) action_type' in v_definition)=0 or position(')) as value_row' in v_definition)=0 then
    raise exception 'client_analytics_base não corresponde à versão esperada.';
  end if;
  execute v_definition;

  v_definition:=replace(pg_get_functiondef('private.campaign_analytics_base(uuid,date,date,uuid[],text[])'::regprocedure),E'\r','');
  v_before:=v_definition;
  v_definition:=replace(v_definition,E'select p.label,i.insight_date,jsonb_build_object(\n      ''analytics_version''',
    E'select p.label,i.insight_date,private.canonical_daily_row(jsonb_build_object(\n      ''analytics_version''');
  v_definition:=replace(v_definition,E'\n    ) value_row from periods p',E'\n    )) value_row from periods p');
  if v_definition=v_before or position(')) value_row from periods p' in v_definition)=0 then
    raise exception 'campaign_analytics_base não corresponde à versão esperada.';
  end if;
  execute v_definition;
end;
$$;
