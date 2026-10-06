-- PostgreSQL regular expressions accept at most 255 repetitions, so {1,512} rejected every name.
alter table public.whatsapp_connections drop constraint whatsapp_connections_template_name_check;
alter table public.whatsapp_connections add constraint whatsapp_connections_template_name_check
  check (template_name ~ '^[a-z0-9_]+$' and char_length(template_name) <= 512);
