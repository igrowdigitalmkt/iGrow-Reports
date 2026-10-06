-- Opt-out by reply: when someone answers "PARAR" on WhatsApp, every recipient of the agency with
-- that phone stops receiving reports. Called by the server (webhook) without a signed-in user;
-- only service_role may execute it.
create function public.service_recipient_opt_out(p_agency_id uuid, p_phone text, p_source text)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v_recipient public.client_recipients; v_count integer := 0;
begin
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Telefone inválido.' using errcode = '22023'; end if;
  if p_source is null or char_length(btrim(p_source)) not between 2 and 1000 then raise exception 'Informe a origem.' using errcode = '22023'; end if;
  for v_recipient in
    select * from public.client_recipients
    where agency_id = p_agency_id and phone = p_phone and consent_status <> 'revoked'
    for update
  loop
    update public.client_recipients set consent_status = 'revoked', unsubscribed_at = now(), updated_at = now() where id = v_recipient.id;
    insert into public.recipient_consent_events(agency_id, client_id, recipient_id, event_type, phone, source, occurred_at, actor_id)
      values (p_agency_id, v_recipient.client_id, v_recipient.id, 'revoked', p_phone, btrim(p_source), now(), null);
    insert into public.audit_logs(agency_id, actor_id, action, entity_id, metadata)
      values (p_agency_id, null, 'recipient.revoked', v_recipient.id, jsonb_build_object('via', 'reply'));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function public.service_recipient_opt_out(uuid, text, text) from public, anon, authenticated;
grant execute on function public.service_recipient_opt_out(uuid, text, text) to service_role;
