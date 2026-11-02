-- Gestão completa dos links compartilhados e das fontes de leads: excluir link, excluir fonte (só quando ainda não recebeu nenhum lead).
-- Aditiva: apenas concede o direito de exclusão ao servidor (service_role) em três tabelas. Nenhuma estrutura nem dado muda.
-- A aplicação só apaga link compartilhado, formulário em cache e fonte SEM leads; leads e histórico nunca são apagados por aqui
-- (a chave estrangeira de leads continua em "restrict").
-- Recuperação: revoke delete on table ... from service_role.

grant delete on table public.lead_share_links to service_role;
grant delete on table public.lead_forms to service_role;
grant delete on table public.lead_pages to service_role;

-- Código do link guardado CRIPTOGRAFADO (AES-256-GCM, chave do servidor) para o administrador poder copiar o link de novo.
-- Coluna opcional: links já criados continuam válidos (a conferência do acesso segue sendo só pelo hash).
alter table public.lead_share_links add column if not exists code_encrypted jsonb;
