-- Allow the integration catalog to grow without changing the tenant model.
alter table public.integrations drop constraint if exists integrations_provider_check;
alter table public.integrations add constraint integrations_provider_check
  check (provider in ('meta','google','tiktok','linkedin','youtube','whatsapp','qstash'));
