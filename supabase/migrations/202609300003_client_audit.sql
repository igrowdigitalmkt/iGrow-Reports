-- Audit in the same transaction as the mutation. Never store notes or names in logs.
create function private.audit_client_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_action text;
begin
  if tg_op = 'INSERT' then v_action := 'client.created';
  elsif old.archived_at is distinct from new.archived_at then
    v_action := case when new.archived_at is null then 'client.reactivated' else 'client.archived' end;
  elsif old.name is distinct from new.name or old.notes is distinct from new.notes or old.logo_path is distinct from new.logo_path then
    v_action := 'client.updated';
  else return new;
  end if;
  insert into public.audit_logs(agency_id,actor_id,action,entity_id)
    values(new.agency_id,auth.uid(),v_action,new.id);
  return new;
end;
$$;
revoke all on function private.audit_client_change() from public,anon,authenticated,service_role;
create trigger audit_client_change after insert or update on public.clients
for each row execute function private.audit_client_change();
