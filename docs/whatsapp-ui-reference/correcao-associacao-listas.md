# Falha ao associar conversa a uma lista

A captura enviada mostra “Não foi possível atualizar os contatos dessa lista.” ao marcar uma lista na conversa.

Os logs do projeto Supabase confirmaram `permission denied for table whatsapp_custom_list_members`. A consulta de privilégios confirmou SELECT, INSERT e DELETE habilitados para authenticated, com UPDATE desabilitado. As políticas existentes também não incluem UPDATE.

A rota PATCH usava upsert com resolução padrão de conflito, que exige UPDATE. A inclusão agora usa `ignoreDuplicates: true`, mantendo vínculos existentes sem sobrescrevê-los. Nenhuma permissão ou política foi ampliada, e nenhuma migração é necessária.

Validação:

- Quatro testes da rota com o cliente Supabase real e transporte HTTP simulado: incluir/repetir, remover, rejeitar conversa de outro número e preservar erro de banco.
- Sete testes SQL com as migrações reais em PostgreSQL/PGlite: reproduzir a falha anterior, incluir com DO NOTHING, repetir sem duplicar e remover com as permissões atuais.
- Consulta de privilégios e logs feita no Supabase de produção; alterações de vínculos reais não foram executadas.

A correção e os ajustes visuais das imagens 01–08 permanecem locais. A versão publicada ainda precisa receber essas alterações para que a tela da captura mude.
