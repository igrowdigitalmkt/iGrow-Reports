import { createHash } from "node:crypto";
import { mkdir,readFile,readdir,writeFile } from "node:fs/promises";
import { dirname,resolve } from "node:path";
import { fileURLToPath,pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)),"..");
const digest = value => createHash("sha256").update(value).digest("hex");

export async function buildSnapshotRollout(projectRoot = root) {
  const directory = resolve(projectRoot,"supabase/migrations");
  const files = (await readdir(directory)).filter(name => /^2026100400\d{2}_[a-z_]+\.sql$/.test(name)).sort();
  if (files.length!==13 || files.some((name,index) => !name.startsWith(`20261004${String(index+1).padStart(4,"0")}_`))) {
    throw new Error("A sequência de migrations de snapshots não corresponde ao pacote revisado de 001 a 013.");
  }
  const migrations = [];
  for (const file of files) {
    const source = await readFile(resolve(directory,file),"utf8");
    if (/^\s*(begin|commit|rollback)\s*;/im.test(source)) throw new Error("Migration com controle transacional próprio não pode integrar este pacote.");
    migrations.push({ file,sha256: digest(source),source: source.replace(/^\uFEFF/,"") });
  }
  const diagnostic = (await readFile(resolve(projectRoot,"supabase/diagnostics/snapshot-readiness.sql"),"utf8")).trim().replace(/;$/,"");
  const sql = `-- iGrow snapshots: fresh ingestion installation only.
-- Confirm the production project and backup before execution.
-- Do not use for partially installed schemas or to repair CLI history.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('igrow-snapshot-rollout-202610040013'));
do $preconditions$
declare object_name text;
begin
  foreach object_name in array array['clients','client_users','integrations','meta_connections','meta_ad_accounts','client_ad_accounts'] loop
    if to_regclass('public.' || object_name) is null then
      raise exception 'Pré-requisito ausente: %',object_name;
    end if;
  end loop;
  if to_regprocedure('private.has_agency_role(uuid,public.agency_role[])') is null
    or to_regprocedure('private.has_client_access(uuid,uuid)') is null
    or (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role'))<>3 then
    raise exception 'Pré-requisitos de autorização ausentes.';
  end if;
  foreach object_name in array array['integration_collection_jobs','integration_raw_payloads','integration_snapshots','integration_provider_health'] loop
    if to_regclass('public.' || object_name) is not null then
      raise exception 'Estrutura de ingestão já existente; pacote bloqueado: %',object_name;
    end if;
  end loop;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname in (
      'claim_integration_collection_job','claim_meta_collection_job','finish_integration_collection_job',
      'persist_integration_collection_result','record_integration_provider_health',
      'list_client_snapshot_accounts','get_confirmed_collection_snapshot','request_meta_collection_refresh')) then
    raise exception 'Funções de ingestão já existentes; verificar instalação parcial.';
  end if;
end;
$preconditions$;
${migrations.map(({ file,sha256,source }) => `\n-- BEGIN ${file} SHA256 ${sha256}\n${source}\n-- END ${file}\n`).join("")}
do $verification$
declare verified boolean;
begin
  select bool_and(ready) into verified from (
${diagnostic}
  ) readiness;
  if verified is distinct from true then raise exception 'A verificação final falhou; instalação revertida.'; end if;
end;
$verification$;
notify pgrst,'reload schema';
commit;
`;
  return { sql,manifest: { formatVersion: 1,migrations: migrations.map(({ file,sha256 }) => ({ file,sha256 })),
    diagnosticSha256: digest(diagnostic),sqlSha256: digest(sql),mode: "fresh_ingestion_only",migrationHistoryUpdated: false } };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const packet = await buildSnapshotRollout();
  const output = resolve(root,"artifacts/snapshot-rollout");
  await mkdir(output,{ recursive: true });
  await writeFile(resolve(output,"install.sql"),packet.sql,"utf8");
  await writeFile(resolve(output,"manifest.json"),JSON.stringify(packet.manifest,null,2)+"\n","utf8");
  console.log(`Pacote preparado: ${resolve(output,"install.sql")}`);
  console.log(`SHA256: ${packet.manifest.sqlSha256}`);
  console.log("Nenhuma conexão ou alteração remota foi executada.");
}
