import assert from "node:assert/strict";
import { buildSnapshotRollout } from "../../scripts/snapshot-rollout.mjs";

// Called only with the disposable PGlite database after the legacy migrations.
export async function verifySnapshotRollout(db,root) {
  const packet = await buildSnapshotRollout(root);
  const agency = "eeeeeeee-0000-4000-8000-000000000001";
  const client = "eeeeeeee-0000-4000-8000-000000000002";
  await db.query("insert into public.agencies(id,name) values($1,'Rollout fixture agency')",[agency]);
  await db.query("insert into public.clients(id,agency_id,name) values($1,$2,'Existing client preserved')",[client,agency]);
  const original = (await db.query("select to_jsonb(c) as data from public.clients c where id=$1",[client])).rows;
  async function preserved() {
    assert.deepEqual((await db.query("select to_jsonb(c) as data from public.clients c where id=$1",[client])).rows,original);
  }
  async function noInstallation() {
    assert.equal((await db.query("select count(*)::integer as count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('integration_collection_jobs','integration_snapshots','integration_raw_payloads','integration_provider_health')")).rows[0].count,0);
    await preserved();
  }
  await assert.rejects(db.exec(packet.sql.replace("array['clients','client_users'","array['missing_rollout_dependency','client_users'")),/Pré-requisito ausente/);
  await db.exec("rollback;"); await noInstallation();

  await db.exec("create table public.integration_snapshots(id uuid);");
  await assert.rejects(db.exec(packet.sql),/Estrutura de ingestão já existente/);
  await db.exec("rollback;");
  assert.ok((await db.query("select to_regclass('public.integration_snapshots') is not null as present")).rows[0].present);
  await db.exec("drop table public.integration_snapshots;"); await noInstallation();

  const brokenAtEnd = packet.sql.replace("notify pgrst,'reload schema';","select 1/0;\nnotify pgrst,'reload schema';");
  await assert.rejects(db.exec(brokenAtEnd),/division by zero/);
  await db.exec("rollback;"); await noInstallation();

  const unsafeGrant = packet.sql.replace("do $verification$","grant execute on function public.request_meta_collection_refresh(uuid,uuid,date,date,text,integer,jsonb) to authenticated;\ndo $verification$");
  await assert.rejects(db.exec(unsafeGrant),/verificação final falhou/);
  await db.exec("rollback;"); await noInstallation();

  await db.exec(packet.sql); await preserved();
  assert.ok((await db.query("select to_regprocedure('public.list_client_snapshot_accounts(uuid)') is not null as present")).rows[0].present);
  await assert.rejects(db.exec(packet.sql),/Estrutura de ingestão já existente/);
  await db.exec("rollback;"); await preserved();

  await db.query("delete from public.clients where id=$1",[client]);
  await db.query("delete from public.audit_logs where agency_id=$1",[agency]);
  await db.query("delete from public.agencies where id=$1",[agency]);
  console.log("Pacote de snapshots aprovado: pré-requisitos, instalação parcial, rollback tardio, pós-validação, preservação de cliente e reaplicação bloqueada.");
}
