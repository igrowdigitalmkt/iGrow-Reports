-- User-initiated deletion is restricted to outgoing messages, even through direct REST writes.
-- Restrictive policies combine with the existing ownership/module policies (AND).
create policy whatsapp_message_user_actions_sent_only
on public.whatsapp_message_user_actions as restrictive for all to authenticated
using (true)
with check (
  hidden_at is null or (
    exists (
      select 1 from public.whatsapp_messages m
      where m.id = whatsapp_message_user_actions.message_id
        and m.agency_id = whatsapp_message_user_actions.agency_id
        and m.direction = 'out' and m.revoked_at is null
    )
    and exists (
      select 1 from public.agency_users au
      where au.agency_id = whatsapp_message_user_actions.agency_id
        and au.user_id = (select auth.uid()) and au.role in ('owner','admin','editor')
    )
  )
);

-- Shared conversations and messages cannot be physically deleted by browser clients.
revoke delete on public.whatsapp_conversations, public.whatsapp_messages from anon, authenticated;
