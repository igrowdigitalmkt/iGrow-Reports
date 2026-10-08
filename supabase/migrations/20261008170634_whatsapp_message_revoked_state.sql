-- A shared tombstone records the WhatsApp revocation of a message originally
-- sent by the connected number; the inbox always displays "Mensagem apagada".
-- Never delete conversation rows, received messages or audit keys.
alter table public.whatsapp_messages
  add column if not exists revoked_at timestamptz null;
create index if not exists whatsapp_messages_revoked_by_chat
  on public.whatsapp_messages(conversation_id,revoked_at)
  where revoked_at is not null;
