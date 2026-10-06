-- Message templates by channel: WhatsApp text, WhatsApp with the report PDF, e-mail (with subject).
alter table public.message_templates
  add column channel text not null default 'whatsapp' check (channel in ('whatsapp','whatsapp_pdf','email')),
  add column subject text check (subject is null or char_length(btrim(subject)) between 1 and 200);
alter table public.message_templates add constraint message_templates_email_subject
  check (channel <> 'email' or subject is not null);
