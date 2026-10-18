# Fotografias do site comercial — briefing (18/10/2026)

O site já tem o espaço para fotos (`src/modules/marketing/sales-photos.ts`). Enquanto `src` estiver `null`, a seção não aparece. Para ativar: salve os arquivos em `public/photos/` (WebP, ~1600 px no maior lado, < 300 KB) e preencha `src` (ex.: `"/photos/mesa-dashboard.webp"`).

Regras: pessoas fictícias geradas/fotografadas com autorização de uso comercial, sem marcas de terceiros, sem logotipos, telas **desfocadas ou de costas** (a interface real é mostrada nas capturas do site; IA gera texto de interface ilegível). Paleta: azul `#4162DE`, escuro `#121720`, claro `#EFF0F5`; luz natural suave, profundidade de campo rasa, aspecto de fotografia editorial (câmera full-frame, 35–50 mm).

| Arquivo | Proporção | Prompt-base |
| --- | --- | --- |
| `mesa-dashboard.webp` | 1:1 | Fotografia ultrarrealista de uma gestora de marketing brasileira, 30 anos, sentada à mesa em escritório moderno, olhando para um monitor ultrawide com gráficos de barras azuis desfocados em modo apresentação, luz natural da janela, tons azul-petróleo e cinza, 50 mm f/1.8, grão sutil. |
| `maos-celular-relatorio.webp` | 16:10 | Fotografia ultrarrealista de uma mão segurando um smartphone com um relatório de resultados (gráfico azul e números desfocados) em uma cafeteria, fundo desfocado, luz quente lateral, 85 mm f/1.4. |
| `reuniao-apresentacao.webp` | 16:10 | Fotografia ultrarrealista de uma equipe diversa de 4 pessoas em uma sala de reunião, uma delas em pé apresentando resultados em uma TV grande com gráficos azuis desfocados, ambiente claro, 35 mm, estilo editorial corporativo. |

Se usar geração por IA: revise mãos, texto e reflexos; descarte imagens com artefatos. Se usar banco de imagens: verifique a licença comercial e guarde o comprovante.
