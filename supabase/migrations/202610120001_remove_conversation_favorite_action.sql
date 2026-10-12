-- Conversation favorites were removed. Message stars remain unchanged.
-- Retain legacy metadata for compatibility with historical identity migrations.
drop function if exists public.set_whatsapp_conversation_favorite(uuid, boolean);
