# Listas: comparação nativa e correção — 12/10/2026

Conta QR conectada da iGrow, testes limitados ao contato Silvio autorizado pelo usuário. Comparação direta da plataforma e do WhatsApp Web, além da leitura autenticada de app-state.

## Falhas comprovadas

- A iGrow mostrava cinco associações; o seletor nativo mostrava Novo cliente e Lead selecionadas. A etiqueta de teste aparecia nos dados do contato, mas faltava no seletor.
- O SDK descartava `type`, `isActive`, `orderIndex`, `isImmutable` e `muteEndTimeMs` ao ler e escrever listas. A etiqueta 8 criada pela integração tinha somente nome, cor e deleted. As listas nativas existentes tinham `type: 5` e `isActive: true`.
- A ordem das listas na iGrow dependia da ordem não determinística devolvida pelo banco do conector.
- O seletor da iGrow preenchia todo o fundo de cada linha selecionada, diferente da referência.

## Correções

- Hotfix versionado sobre a imagem estável `2.3.7-native-settings-3`, sem incorporar pontes comerciais não publicadas. Nova imagem em produção: `igrow/evolution-api:2.3.7-native-lists-4`.
- Leitura preserva os campos autenticados de listas; escrita preserva os campos existentes. Novas listas incluem tipo customizado, estado ativo e ordem. A lista 8 foi reparada preservando seu nome e cor e sem recriação/exclusão.
- Snapshot consulta alterações remotas antes de devolver a projeção. A API filtra listas inativas, apagadas, imutáveis e filtros nativos; ordena pela ordem nativa com fallback no ID.
- Abrir o menu da iGrow solicita uma atualização imediata, além da sincronização periódica. Os indicadores de cor seguem as primeiras listas e as linhas usam fundo neutro, mantendo a paleta e o tema da plataforma.

## Testes reais

1. Inclusão de Novo pedido no WhatsApp Web e remoção posterior: observadas no app-state como add/remove no LID comprovado do contato.
2. Inclusão de Novo pedido pela interface da iGrow: confirmada como selecionada ao reabrir o seletor nativo. Um seletor já aberto no WhatsApp Web pode manter o estado anterior até ser reaberto.
3. Remoção pelo seletor do WhatsApp Web: concluída ao fechar o menu e recebida pela integração.
4. Lista 8 reparada: passou a aparecer no seletor nativo, selecionada. Após reinício do conector, leitura autenticada confirmou `type: 5`, `isActive: true`.
5. Seleção restaurada ao estado visual encontrado: Novo cliente (4), Lead (5) e lista de teste (8). Novo pedido (6) e Pagamento pendente (7) desmarcadas. Nenhuma conversa, mensagem ou lista foi apagada; nenhuma mensagem foi enviada.

Verificação local: 864 testes aprovados em 134 arquivos, lint, TypeScript e build aprovados. Esta rodada corrige as divergências observadas; não equivale a uma garantia sobre todos os recursos de listas.
