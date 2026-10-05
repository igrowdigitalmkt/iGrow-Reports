// Local volume benchmark for the main dashboard analytics RPC. Runs every
// migration in PGlite (WASM, single thread: slower than Supabase, so compare
// timings relative to each other, not as absolute production latency).
// Usage: node scripts/analytics-bench.mjs [clients=1] [accounts=3] [campaigns=4] [days=730] [--legacy]
// --legacy skips the 2026-10-05 analytics optimizations to measure the previous version.
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createAnalyticsBenchDb } from "./analytics-bench-db.mjs";

const legacy = process.argv.includes("--legacy");
const [clients = 1, accounts = 3, campaigns = 4, days = 730] = process.argv.slice(2).filter(arg => !arg.startsWith("--")).map(Number);
const root = fileURLToPath(new URL("../", import.meta.url));
const db = await createAnalyticsBenchDb(root, { exclude: legacy ? ["202610050002_analytics_values_single_pass.sql", "202610050003_analytics_canonical_once.sql"] : [] });
const owner = "10000000-0000-4000-8000-0000000000b1";
const agency = "aaaaaaaa-0000-4000-8000-0000000000b1";
const end = "2026-10-04";

let started = performance.now();
await db.exec(`
  insert into auth.users(id,email,email_confirmed_at) values ('${owner}','bench-owner@example.test',now());
  insert into agencies(id,name) values ('${agency}','Agência benchmark');
  insert into agency_users(agency_id,user_id,role) values ('${agency}','${owner}','owner');
  insert into integrations(agency_id,provider) values ('${agency}','meta');
`);
await db.exec(`
  insert into clients(id,agency_id,name)
    select ('11111111-0000-4000-8000-'||lpad(c::text,12,'0'))::uuid,'${agency}','Cliente '||c from generate_series(1,${clients}) c;
  insert into meta_connections(id,agency_id,integration_id,client_id)
    select ('22222222-0000-4000-8000-'||lpad(c::text,12,'0'))::uuid,'${agency}',(select id from integrations limit 1),
      ('11111111-0000-4000-8000-'||lpad(c::text,12,'0'))::uuid from generate_series(1,${clients}) c;
  insert into meta_ad_accounts(id,agency_id,meta_connection_id,external_id,name,currency,timezone_name,business_id)
    select ('33333333-0000-4000-'||lpad(c::text,4,'0')||'-'||lpad(a::text,12,'0'))::uuid,'${agency}',
      ('22222222-0000-4000-8000-'||lpad(c::text,12,'0'))::uuid,'act_'||(c*1000+a),'Conta '||c||'-'||a,'BRL','America/Sao_Paulo','123'
    from generate_series(1,${clients}) c, generate_series(1,${accounts}) a;
  insert into client_ad_accounts(agency_id,client_id,ad_account_id)
    select '${agency}',('11111111-0000-4000-8000-'||lpad(c::text,12,'0'))::uuid,('33333333-0000-4000-'||lpad(c::text,4,'0')||'-'||lpad(a::text,12,'0'))::uuid
    from generate_series(1,${clients}) c, generate_series(1,${accounts}) a;
  insert into client_metric_mappings(agency_id,client_id,primary_metric_key,primary_action_type)
    select '${agency}',('11111111-0000-4000-8000-'||lpad(c::text,12,'0'))::uuid,'leads','lead' from generate_series(1,${clients}) c;
`);
await db.exec("select setseed(0.42);");
// Daily rows: one account row plus N campaigns, metadata shaped like production (105 canonical values).
await db.exec(`
  create temp table bench_canonical as select jsonb_object_agg('metric_'||k,(k*1.5)::numeric) ||
    jsonb_build_object('analytics_version','11') as v from generate_series(1,100) k;
  insert into meta_daily_insights(agency_id,ad_account_id,insight_date,level,external_entity_id,entity_name,spend,impressions,reach,link_clicks,api_version,metadata)
  select '${agency}',a.id,d::date,lv.level,
    case lv.level when 'account' then a.external_id else (a.external_id||'0'||lv.n) end,
    case lv.level when 'account' then a.name else 'Campanha '||lv.n end,
    (random()*100)::numeric(24,8),(random()*10000)::bigint,(random()*5000)::bigint,(random()*300)::bigint,'v24.0',
    jsonb_build_object('analytics_version','11','actions_confirmed',true,'clicks',100,'frequency',1.4,'unique_clicks',80,
      'canonical_values',(select v from bench_canonical)||jsonb_build_object('action:lead',3,'action:link_click',40,'result:provider_known',1,'result:provider:action:lead',3),
      'provider_results',jsonb_build_object('result:provider_known',1,'result:provider:action:lead',3),
      'inline_post_engagement',30,'outbound_clicks',12,'video_play_actions',50,'video_p25_watched_actions',20,
      'video_p50_watched_actions',10,'video_p75_watched_actions',6,'video_p95_watched_actions',3,'video_p100_watched_actions',2)
  from meta_ad_accounts a
  cross join generate_series('${end}'::date-${days - 1},'${end}'::date,interval '1 day') d
  cross join lateral (select 'account' level,0 n union all select 'campaign',g from generate_series(1,${campaigns}) g) lv;
  insert into meta_daily_actions(agency_id,ad_account_id,insight_date,level,external_entity_id,action_type,action_value)
  select i.agency_id,i.ad_account_id,i.insight_date,i.level,i.external_entity_id,t.action_type,(random()*20)::numeric(24,8)
  from meta_daily_insights i cross join (select unnest(array['lead','link_click','landing_page_view','post_engagement','page_engagement',
    'video_view','comment','like','post_reaction','onsite_conversion.messaging_conversation_started_7d','omni_landing_page_view',
    'onsite_conversion.post_save','post','complete_registration','offsite_conversion.fb_pixel_lead']) action_type) t;
  insert into meta_collection_runs(agency_id,client_id,ad_account_id,date_from,date_to,status,levels)
  select '${agency}',ca.client_id,ca.ad_account_id,s::date,least(s::date+29,'${end}'::date),'complete',array['account','campaign']
  from client_ad_accounts ca cross join generate_series('${end}'::date-${days * 2},'${end}'::date,interval '30 day') s;
  analyze;
`);
const counts = await db.query(`select (select count(*) from meta_daily_insights) insights,(select count(*) from meta_daily_actions) actions,
  pg_size_pretty(pg_total_relation_size('meta_daily_insights')+pg_total_relation_size('meta_daily_actions')) size`);
console.log(`Carga: ${JSON.stringify(counts.rows[0])} em ${Math.round(performance.now() - started)} ms`);

const client = "11111111-0000-4000-8000-000000000001";
// Exact-period Meta aggregate cache (meta_dashboard_scopes) shaped like production:
// every campaign, ad set and ad of each account with ~200 indicator values.
const entitiesPerAccount = Number(process.env.BENCH_ENTITIES ?? 370);
const withCatalogValues = process.env.BENCH_CATALOG_VALUES !== "0";
async function seedScope(from) {
  await db.exec(`
    with acc as (select a.id,a.name,a.currency from meta_ad_accounts a join client_ad_accounts ca on ca.ad_account_id=a.id where ca.client_id='${client}'),
    vals as (select jsonb_object_agg('metric_'||k,k*1.25) v from generate_series(1,200) k),
    ent as (select acc.*,e,case when e<=20 then 'campaign' when e<=80 then 'adset' else 'ad' end lvl from acc cross join generate_series(1,${entitiesPerAccount}) e)
    insert into meta_dashboard_scopes(agency_id,client_id,scope_key,date_from,date_to,collected_at,payload)
    select '${agency}','${client}',md5((select string_agg(id::text,',' order by id::text) from acc)||'|'),'${from}','${end}',now(),
      jsonb_build_object('version',11,'summary',(select v from vals),'previousSummary',(select v from vals),'accountValues',
        (select jsonb_object_agg(id,(select v from vals)) from acc),
        'metrics',(select jsonb_agg(jsonb_build_object('key','metric_'||k,'label','Métrica '||k,'unit','integer','precision',0,'desirable','up')) from generate_series(1,200) k),
        'entityValues',(select jsonb_object_agg(id||':'||lvl||':'||e,(select v from vals)) from ent),
        'entityCatalog',(select jsonb_agg(jsonb_build_object('key',lvl||':'||e,'id',e::text,'level',lvl,'name','Entidade '||e,'accountId',id,'accountName',name,'currency',currency)
          ||case when ${withCatalogValues} then jsonb_build_object('values',(select v from vals)) else '{}' end) from ent),
        'estimatedMetricKeys','[]'::jsonb)
    on conflict (agency_id,client_id,scope_key,date_from,date_to) do update set payload=excluded.payload,collected_at=now();`);
}
// BENCH_EXPERIMENT=nodaily|nocampaigns rewrites one CTE to measure its share of
// the cost (results are intentionally incomplete).
if (process.env.BENCH_EXPERIMENT) {
  const empty = {
    nodaily: [/daily as \(\n[\s\S]*?having dc\.covered or count\(i\.ad_account_id\)>0\n  \),/, "daily as (select null::text label,null::date day,null::jsonb metric_values where false),"],
    nocampaigns: [/campaigns as \(\n[\s\S]*?group by i\.external_entity_id,i\.ad_account_id,a\.name,a\.currency,cat\.keys\n  \),/, "campaigns as (select null::text id,null::text name,null::uuid account_id,null::text account_name,null::text currency,null::text status,null::jsonb metric_values where false),"],
  }[process.env.BENCH_EXPERIMENT];
  const def = (await db.query("select pg_get_functiondef('private.client_analytics_base(uuid,date,date,uuid[])'::regprocedure) d")).rows[0].d.replaceAll("\r", "");
  const patched = def.replace(empty[0], empty[1]);
  if (patched === def) throw new Error("experimento não aplicado");
  await db.exec(patched);
  console.log(`experimento ${process.env.BENCH_EXPERIMENT} aplicado`);
}
const scopeSize = async () => (await db.query("select pg_size_pretty(sum(pg_column_size(payload))::bigint) s from meta_dashboard_scopes")).rows[0].s;
for (const span of [30, 90, 180, 365]) {
  if (entitiesPerAccount > 0) await seedScope(new Date(Date.parse(`${end}T12:00:00Z`) - (span - 1) * 86_400_000).toISOString().slice(0, 10));
  const from = new Date(Date.parse(`${end}T12:00:00Z`) - (span - 1) * 86_400_000).toISOString().slice(0, 10);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
  started = performance.now();
  const result = await db.query(`select get_client_analytics('${client}','${from}','${end}',null)::text body`);
  const ms = Math.round(performance.now() - started);
  await db.exec("reset role;");
  const body = result.rows[0].body;
  // Collection timestamps differ per run; compare the analytical content only.
  const parsed = JSON.parse(body); delete parsed.coverage.latestCollectedAt;
  const digest = createHash("sha256").update(JSON.stringify(parsed)).digest("hex").slice(0, 12);
  console.log(`${String(span).padStart(3)} dias: ${String(ms).padStart(6)} ms · resposta ${(body.length / 1024).toFixed(0)} KB · sha ${digest}${entitiesPerAccount > 0 ? ` · cache ${await scopeSize()}` : ""}`);
}
if (process.argv.includes("--split")) {
  // Superuser session with the owner's identity: private helpers are not granted to authenticated.
  for (const span of [90, 365]) {
    const from = new Date(Date.parse(`${end}T12:00:00Z`) - (span - 1) * 86_400_000).toISOString().slice(0, 10);
    await seedScope(from);
    await db.query(`select set_config('request.jwt.claim.sub','${owner}',false)`);
    const accounts = (await db.query(`select array_agg(ad_account_id order by ad_account_id::text) ids from client_ad_accounts where client_id='${client}'`)).rows[0].ids;
    const arr = `'{${accounts.join(",")}}'::uuid[]`;
    let t = performance.now();
    const data = (await db.query(`select private.client_analytics_base('${client}','${from}','${end}',null) v`)).rows[0].v;
    const base = Math.round(performance.now() - t);
    t = performance.now(); await db.query(`select length(private.valid_dashboard_scope('${client}','${from}','${end}',${arr},'{}')::text)`);
    const valid = Math.round(performance.now() - t);
    t = performance.now(); await db.query(`select length(private.enrich_dashboard_scope($1::jsonb,'${client}','${from}','${end}',${arr},'{}')::text)`, [JSON.stringify(data)]);
    const enrich = Math.round(performance.now() - t);
    console.log(`${span} dias · base ${base} ms · leitura do cache ${valid} ms · enriquecimento ${enrich} ms`);
  }
}
await db.close();
