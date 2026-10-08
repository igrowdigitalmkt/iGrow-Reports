-- Preserve the exact sender of group messages so an outgoing WhatsApp reaction
-- can refer to the original Baileys message key (including group participant).
alter table public.whatsapp_messages
  add column if not exists participant_jid text null
    check (participant_jid is null or participant_jid ~ '^[0-9]{8,20}@(lid|s[.]whatsapp[.]net)$');
