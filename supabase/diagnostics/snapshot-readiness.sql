-- Operator-only, read-only preflight. Does not inspect customer rows, credentials
-- or migration history, and works even when ingestion tables do not exist.
with required_functions(stage,signature,role_name,migration) as (values
  ('read','public.list_client_snapshot_accounts(uuid)','authenticated','202610040012'),
  ('read','public.get_confirmed_collection_snapshot(uuid,uuid,text,text,date,date,text,text,integer)','authenticated','202610040011'),
  ('worker','public.claim_meta_collection_job(timestamp with time zone)','service_role','202610040013'),
  ('worker','public.authorize_integration_collection_job(uuid,integer)','service_role','202610040010'),
  ('worker','public.persist_integration_collection_result(uuid,integer,text,jsonb,jsonb,jsonb)','service_role','202610040008'),
  ('worker','public.finish_integration_collection_job(uuid,integer,text,timestamp with time zone,text,text,timestamp with time zone)','service_role','202610040008'),
  ('worker','public.record_integration_provider_health(uuid,text,boolean,text,integer)','service_role','202610040008'),
  ('refresh','public.request_meta_collection_refresh(uuid,uuid,date,date,text,integer,jsonb)','service_role','202610040013')
), functions as (
  select r.*,to_regprocedure(signature)::oid as oid from required_functions r
), required_tables(stage,table_name,migration) as (values
  ('worker','integration_collection_jobs','202610040001'),
  ('worker','integration_raw_payloads','202610040001'),
  ('read','integration_snapshots','202610040001'),
  ('worker','integration_provider_health','202610040005')
), required_columns(table_name,column_name,required_not_null,migration) as (values
  ('integration_collection_jobs','api_version',true,'202610040001'),
  ('integration_collection_jobs','contract_version',true,'202610040001'),
  ('integration_collection_jobs','retry_epoch_attempt',true,'202610040013'),
  ('integration_snapshots','attempt_count',false,'202610040008')
), checks as (
  select stage,'function'::text as kind,signature as object_name,migration,
    exists(select 1 from pg_proc p where p.oid=f.oid and p.prosecdef) as ready
  from functions f
  union all
  select stage,'execute',signature || ' / ' || role_name,migration,
    coalesce((select has_function_privilege(r.oid,f.oid,'EXECUTE') from pg_roles r where r.rolname=f.role_name),false)
  from functions f
  union all
  select stage,'access',signature || ' / restricted',migration,
    f.oid is not null and not exists(
      select 1 from pg_roles r where r.rolname in ('anon','authenticated')
        and r.rolname<>f.role_name and has_function_privilege(r.oid,f.oid,'EXECUTE'))
  from functions f
  union all
  select stage,'rls','public.' || table_name,migration,
    exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=t.table_name and c.relkind='r' and c.relrowsecurity)
  from required_tables t
  union all
  select 'worker','column','public.' || table_name || '.' || column_name,migration,
    exists(select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=r.table_name and a.attname=r.column_name
        and a.attnum>0 and not a.attisdropped and (not r.required_not_null or a.attnotnull))
  from required_columns r
  union all
  select 'worker','retry_contract','public.claim_meta_collection_job.retry_attempt_count','202610040013',
    exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.claim_meta_collection_job(timestamp with time zone)')
      and 'retry_attempt_count'=any(p.proargnames))
)
select stage,kind,object_name,migration,coalesce(ready,false) as ready,
  bool_and(coalesce(ready,false)) over () as schema_ready
from checks order by stage,kind,object_name;
