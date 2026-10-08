# Integração da referência WhatsApp Web — 08/10/2026

## Materiais recebidos

Os três arquivos fornecidos pelo usuário foram preservados nesta pasta:
- `INTEGRACAO_PROJETO_EXISTENTE.md` — regras de implementação e segurança.
- `styles.css` — código CSS original enviado pelo usuário, sem alterações.
- `main.tsx.reference.txt` — TSX original enviado pelo usuário, arquivado como texto para não ser compilado pelo Next.js. O `main.tsx` importa `./mock`, que não foi fornecido.

A referência recria uma interface em código próprio; não contém código-fonte original do WhatsApp.

## Adaptação no iGrow

**Visual:** `src/modules/whatsapp/inbox-reference.css` traduz os estilos de `styles.css` para classes `.wai-*` do iGrow, importado depois do CSS existente. O arquivo é isolado, sem seletores globais `:root`, `body`, `.app`, `.rail`, `.inbox` ou `.bubble`, de modo que não interfere no restante da plataforma.

**Funcionalidade:** `src/modules/whatsapp/inbox-view.tsx` preserva os handlers reais de envio, reação, seleção, encaminhamento, fixação, favoritos, mídias e regras de exclusão. Implementa pesquisa local das mensagens da conversa aberta. Não importa os arrays fictícios, `setMessages` simulados ou ações demonstrativas de `main.tsx`.

**Integração:** autenticação, permissões, Supabase, webhooks, QR Code, API oficial, limites de mensagens e limpeza ao desconectar continuam nos módulos existentes, sem substituição.

## Correspondência visual

| Elemento da referência | Correspondência no iGrow |
| --- | --- |
| Rail de 80px; 65px no tablet; 55px no celular | `.wai-rail`, com números de WhatsApp realmente conectados |
| Caixa de conversas responsiva, cabeçalho de 84px | `.wai-list`, `.wai-list-head` |
| Pesquisa de 50px e chips de 40px | `.wai-search`, `.wai-filters` |
| Conversas de 94px com avatar de 60px | `.wai-row`, `.wai-avatar` |
| Cabeçalho de chat de 72px e balões | `.wai-chat-head`, `.wai-bubble` |
| Horários, confirmação de leitura e reações | `.wai-meta`, `.wai-tick`, `.wai-reactions` |
| Compositor, anexos, emojis, respostas citadas | `.wai-composer`, `.wai-reply-banner` |
| Menu com reações e ações | Componente `Bubble`, vinculado ao backend real |
| Marcação de várias mensagens | Checkboxes e barra inferior |
| Exclusão apenas de mensagens enviadas | Validação no servidor, conforme política existente |
| Pesquisa dentro da conversa | `.wai-chat-search-panel`, resultados da conversa atual |
| Celular sem hover | Toque longo abre as ações; compositor permanece na tela |

Os atalhos de chamadas, atualizações, comunidades e avisos do exemplo foram omitidos porque não têm integração real autorizada. Não se acrescentam botões apenas decorativos sem função.

## Testes e limitações

Validação manual executada em **1536×864**, **1366×768**, **1024×768** e **390×844**, incluindo layout, menu, pesquisa, seleção e ausência de overflow; teste de dispositivo touchscreen com toque longo e compositor.

Para repetir em PowerShell:
1. `$env:ENABLE_DEMO='true'; pnpm exec next dev -p 3158`
2. Em outro terminal: `node scripts/qa-whatsapp-ui-reference.mjs`

A suíte acima usa apenas a demonstração isolada e **não envia nem exclui mensagens reais**. A equivalência exata em todos os estados e a sincronização ponta a ponta com aparelho real ainda requerem QA com uma conta de teste autorizada. Não afirmar que um comando foi sincronizado antes da confirmação do conector.
