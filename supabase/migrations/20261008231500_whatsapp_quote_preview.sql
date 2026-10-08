-- Stores only the referenced WhatsApp message id and a short quoted text preview.
-- No quoted media bytes or contact phone numbers are copied.
alter table public.whatsapp_messages
  add column if not exists quoted_external_id text,
  add column if not exists quoted_preview text;
comment on column public.whatsapp_messages.quoted_external_id is 'ID of the quoted WhatsApp message, scoped to the same conversation';
comment on column public.whatsapp_messages.quoted_preview is 'Bounded text summary from the WhatsApp reply payload';
