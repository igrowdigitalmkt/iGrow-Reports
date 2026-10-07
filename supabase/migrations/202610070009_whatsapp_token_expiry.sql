-- When the WhatsApp access token stops working. Tokens from Embedded Signup last 60 days; a
-- permanent system-user token keeps this empty.
alter table public.whatsapp_connections add column if not exists token_expires_at timestamptz;
