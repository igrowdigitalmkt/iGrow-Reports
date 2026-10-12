# Menu sincronizado de conversas

O botão de seta em cada linha abre ações nativas sem abrir ou marcar a conversa como lida. Disponível ao passar o mouse, focar com o teclado ou usar uma tela de toque.

O conector consulta snapshots e sequências completas de patches autenticados das coleções `regular_low` e `regular_high`, sem persistir versões nem reproduzir eventos antigos. Resolve PN/LID por USync e normaliza o sufixo de dispositivo `:0` retornado pelo SDK. Fixação, arquivamento e leitura usam `chatModify`. Cada escrita compara o estado esperado e só retorna sucesso após ler a confirmação do WhatsApp.

Favoritos são sincronizados somente do WhatsApp para a iGrow. O teste de escrita genérica de `favoritesAction` causou erro de sincronização na aba oficial, apesar da confirmação de leitura no servidor. Essa escrita foi removida do conector e os controles de alteração ficaram desativados no menu, cabeçalho e detalhes. Uma resposta criptograficamente válida do servidor não comprova que todos os clientes aceitam uma operação não implementada pelo SDK.

Silenciamento reaproveita a integração nativa existente, com duração e proteção contra estado alterado. Listas reutilizam a fila de associação existente. O menu não oferece bloqueio, limpeza, exclusão de conversas ou exclusão de mensagens.

Uma consulta em segundo plano atualiza favoritos, arquivamento e fixação a cada 30 segundos. A identidade é vinculada à agência e à sessão QR atual. Atualizações de metadados respeitam o timestamp consultado para evitar sobrescrever alterações concorrentes. As operações de leitura preservam novas mensagens recebidas durante a requisição.

Verificação: 881 testes passaram. Após a reconexão, fixação, arquivamento, marcação de leitura, silenciamento e associação à lista Lead foram observados no WhatsApp oficial e restaurados. A inclusão de Silvio nos favoritos pela interface oficial apareceu na iGrow; a remoção também foi confirmada pelo conector. Escritas de favoritos pela iGrow permanecem bloqueadas após provocarem desconexão. O estado final preserva Silvio fixado, não arquivado, lido, sem silenciamento, sem favorito e sem listas. Nenhuma conversa ou mensagem foi apagada. Testes automatizados rejeitam resposta sem confirmação, estado incompleto e pares fora da consulta autorizada.

