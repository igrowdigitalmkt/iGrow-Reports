// Compares the dashboard analytics before and after the 202610050002/0003
// optimizations: private.analytics_values on generated inputs (empty/complete
// periods, missing indicators, unconfirmed actions, unknown provider results),
// then the full dashboard RPCs on identical deterministic data. Exits non-zero
// on any difference.
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createAnalyticsBenchDb } from "./analytics-bench-db.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const legacy = await createAnalyticsBenchDb(root, { exclude: ["202610050002_analytics_values_single_pass.sql", "202610050003_analytics_canonical_once.sql", "202610050004_client_analytics_cache.sql"] });
const current = await createAnalyticsBenchDb(root);

let seed = 7;
const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = values => values[Math.floor(random() * values.length)];
const maybe = (value, chance = 0.85) => random() < chance ? value : undefined;
const actionKeys = ["lead", "link_click", "landing_page_view", "onsite_conversion.messaging_conversation_started_7d", "omni_purchase", "complete_registration"];
const scalarKeys = ["instagram_profile_visits", "clicks", "inline_post_engagement", "outbound_clicks", "video_plays", "video_p25", "video_p50", "video_p75", "video_p95", "video_p100"];

function row() {
  const actions = {};
  for (const key of actionKeys) if (random() < 0.6) actions[key] = Math.round(random() * 50);
  const out = {
    spend: maybe(+(random() * 100).toFixed(4)), impressions: maybe(Math.round(random() * 9999)), link_clicks: maybe(Math.round(random() * 300)),
    reach: Math.round(random() * 500), actions, revenues: random() < 0.5 ? { omni_purchase: +(random() * 900).toFixed(2) } : {},
    actions_confirmed: pick([true, false, undefined]),
  };
  for (const key of scalarKeys) { const value = maybe(Math.round(random() * 80), 0.8); if (value !== undefined) out[key] = value; }
  for (const key of ["result:leads", "result:messages"]) if (random() < 0.4) out[key] = Math.round(random() * 9);
  const known = pick(["1", "1", "1", null, undefined]);
  if (known !== undefined) out.provider_results = { "result:provider_known": known, ...(random() < 0.7 ? { "result:provider:action:lead": Math.round(random() * 9) } : {}),
    ...(random() < 0.3 ? { "result:provider:action:onsite_conversion.messaging_conversation_started_7d": Math.round(random() * 5) } : {}) };
  if (random() < 0.3) {
    out.analytics_version = "7";
    out.canonical_values = { spend: +(random() * 100).toFixed(4), clicks: Math.round(random() * 99), "action:lead": Math.round(random() * 9),
      "result:provider_known": 1, "result:provider:action:lead": Math.round(random() * 9) };
    if (random() < 0.5) out.analytics_version = "11";
  }
  return out;
}

const cases = [];
for (let i = 0; i < 400; i++) {
  const size = pick([0, 0, 1, 2, 3, 7, 30]);
  cases.push({ rows: Array.from({ length: size }, row), complete: random() < 0.5, money: random() < 0.85,
    actions: actionKeys.filter(() => random() < 0.7), revenue: pick(["omni_purchase", null]),
    unique: random() < 0.3 ? { reach: 10, frequency: 1.2, unique_clicks: 4 } : null, nullRows: random() < 0.05 });
}
const sql = "select private.analytics_values($1::jsonb,'leads','lead',$2,$3::text[],$4,$5,$6::jsonb) v";
let differences = 0;
for (const [index, item] of cases.entries()) {
  const params = [item.nullRows ? null : JSON.stringify(item.rows), item.revenue, item.actions, item.complete, item.money, item.unique ? JSON.stringify(item.unique) : null];
  const [a, b] = await Promise.all([legacy.query(sql, params), current.query(sql, params)]);
  if (!isDeepStrictEqual(a.rows[0].v, b.rows[0].v)) {
    differences += 1;
    if (differences <= 3) console.log(`Diferença no caso ${index}:`, JSON.stringify(item).slice(0, 400), "\nantes:", JSON.stringify(a.rows[0].v), "\ndepois:", JSON.stringify(b.rows[0].v));
  }
}
console.log(`${cases.length} casos comparados, ${differences} diferença(s).`);

// Full dashboard RPCs on identical data: v11 rows with canonical values, raw
// daily actions that differ from the canonical ones, several accounts/campaigns.
const owner = "10000000-0000-4000-8000-0000000000e1", agency = "aaaaaaaa-0000-4000-8000-0000000000e1";
const client = "11111111-0000-4000-8000-0000000000e1";
const seedSql = `
  insert into auth.users(id,email,email_confirmed_at) values ('${owner}','eq@example.test',now());
  insert into agencies(id,name) values ('${agency}','Agência equivalência');
  insert into agency_users(agency_id,user_id,role) values ('${agency}','${owner}','owner');
  insert into integrations(agency_id,provider) values ('${agency}','meta');
  insert into clients(id,agency_id,name) values ('${client}','${agency}','Cliente equivalência');
  insert into meta_connections(id,agency_id,integration_id,client_id) values ('22222222-0000-4000-8000-0000000000e1','${agency}',(select id from integrations limit 1),'${client}');
  insert into meta_ad_accounts(id,agency_id,meta_connection_id,external_id,name,currency,timezone_name,business_id)
    select ('33333333-0000-4000-8000-00000000000'||a)::uuid,'${agency}','22222222-0000-4000-8000-0000000000e1','act_9'||a,'Conta '||a,'BRL','America/Sao_Paulo','1' from generate_series(1,2) a;
  insert into client_ad_accounts(agency_id,client_id,ad_account_id) select '${agency}','${client}',id from meta_ad_accounts;
  insert into client_metric_mappings(agency_id,client_id,primary_metric_key,primary_action_type,revenue_action_type) values ('${agency}','${client}','leads','lead','omni_purchase');
  insert into meta_daily_insights(agency_id,ad_account_id,insight_date,level,external_entity_id,entity_name,spend,impressions,reach,link_clicks,api_version,metadata,collected_at)
  select '${agency}',a.id,d::date,lv.level,case lv.level when 'account' then a.external_id else substr(a.external_id,5)||'0'||lv.n end,'E'||lv.n,
    ((extract(doy from d)::int*7+lv.n*3) % 97)::numeric+0.25,((extract(doy from d)::int*13+lv.n) % 991)::bigint,50,((extract(doy from d)::int+lv.n) % 37)::bigint,'v24.0',
    case when (extract(doy from d)::int+lv.n) % 3=0 then jsonb_build_object('analytics_version','6','clicks',10,'frequency',1.2)
    else jsonb_build_object('analytics_version','11','actions_confirmed',(extract(doy from d)::int % 4)<>0,'clicks',12,'frequency',1.1,'unique_clicks',8,
      'canonical_values',jsonb_build_object('spend',((extract(doy from d)::int*5+lv.n) % 89)::numeric+0.5,'clicks',(extract(doy from d)::int % 41),
        'action:lead',(extract(doy from d)::int % 5),'action:landing_page_view',(extract(doy from d)::int % 17),'value:action:omni_purchase',(extract(doy from d)::int % 11)*2.5,
        'result:provider_known',case when (extract(doy from d)::int % 9)=0 then null else 1 end,'result:provider:action:lead',(extract(doy from d)::int % 5)),
      'provider_results',jsonb_build_object('result:provider_known',1,'result:provider:action:lead',1)) end,
    '2026-10-05T10:00:00Z'
  from meta_ad_accounts a cross join generate_series('2026-06-01'::date,'2026-10-04'::date,interval '1 day') d
  cross join (select 'account' level,0 n union all select 'campaign',g from generate_series(1,3) g) lv;
  insert into meta_daily_actions(agency_id,ad_account_id,insight_date,level,external_entity_id,action_type,action_value,value_amount)
  select i.agency_id,i.ad_account_id,i.insight_date,i.level,i.external_entity_id,t.k,(extract(doy from i.insight_date)::int % 7)+t.o,
    case when t.k='omni_purchase' then 9.5 end
  from meta_daily_insights i cross join (values ('lead',0),('link_click',3),('omni_purchase',1),('video_view',2)) t(k,o);
  insert into meta_collection_runs(agency_id,client_id,ad_account_id,date_from,date_to,status,levels,collected_at)
  select '${agency}','${client}',a.id,s::date,least(s::date+29,'2026-10-04'::date),'complete',array['account','campaign'],'2026-10-05T10:00:00Z'
  from meta_ad_accounts a cross join generate_series('2026-04-01'::date,'2026-10-04'::date,interval '30 day') s;`;
await legacy.exec(seedSql); await current.exec(seedSql);
const accountIds = (await current.query("select array_agg(id order by id) ids from meta_ad_accounts")).rows[0].ids;
const rpcs = [
  ["dashboard 30 dias", `select get_client_analytics('${client}','2026-09-05','2026-10-04',null) v`],
  ["dashboard 60 dias, uma conta", `select get_client_analytics('${client}','2026-08-06','2026-10-04',array['${accountIds[0]}']::uuid[]) v`],
  ["campanhas selecionadas", `select get_campaign_scoped_analytics('${client}','2026-09-05','2026-10-04',array['${accountIds[0]}']::uuid[],array['campaign:9101','campaign:9103']) v`],
  ["hierarquia", `select get_client_analytics_hierarchy('${client}','2026-09-05','2026-10-04',null) v`],
];
for (const [label, sql] of rpcs) {
  const run = async db => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
    try { return (await db.query(sql)).rows[0].v; } catch (error) { return { error: String(error.message) }; } finally { await db.exec("reset role;"); } };
  const [a, b] = [await run(legacy), await run(current)];
  const same = isDeepStrictEqual(a, b);
  if (!same) differences += 1;
  console.log(`${label}: ${same ? "idêntico" : "DIFERENTE"} (${JSON.stringify(a).length} bytes)${JSON.stringify(a).length < 200 ? " " + JSON.stringify(a) : ""}`);
}
await legacy.close(); await current.close();
process.exit(differences ? 1 : 0);
