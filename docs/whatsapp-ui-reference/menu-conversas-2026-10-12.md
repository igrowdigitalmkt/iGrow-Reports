# Menu sincronizado de conversas

O botão de seta em cada linha abre ações nativas sem abrir ou marcar a conversa como lida. Disponível ao passar o mouse, focar com o teclado ou usar uma tela de toque.

O conector consulta snapshots autenticados das coleções `regular_low` e `regular_high`, sem persistir versões nem reproduzir eventos antigos. Fixação, arquivamento e leitura usam `chatModify`. Favoritos preservam a lista global completa e utilizam o índice, a coleção e a versão observados no registro nativo `favoritesAction`; a função fica indisponível quando esse registro não pode ser verificado. Cada escrita compara o estado esperado e só retorna sucesso após ler a confirmação do WhatsApp.

Silenciamento reaproveita a integração nativa existente, com duração e proteção contra estado alterado. Listas reutilizam a fila de associação existente. O menu não oferece bloqueio, limpeza, exclusão de conversas ou exclusão de mensagens.

Uma consulta em segundo plano atualiza favoritos, arquivamento e fixação a cada 30 segundos. A identidade é vinculada à agência e à sessão QR atual. Atualizações de metadados respeitam o timestamp consultado para evitar sobrescrever alterações concorrentes. As operações de leitura preservam novas mensagens recebidas durante a requisição.

Verificação: teste autorizado de favoritos e fixação, com confirmação de snapshots e restauração do estado inicial; testes do menu publicado para favoritos, fixação, leitura e arquivamento. A aba oficial do navegador pediu reconexão, portanto não houve comparação visual com uma sessão oficial conectada nesta etapa. Nenhuma conversa ou mensagem foi apagada. Testes automatizados rejeitam resposta sem confirmação, estado incompleto e pares fora da consulta autorizada.
