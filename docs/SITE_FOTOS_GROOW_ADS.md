# Fotografias do site comercial — briefing (18/10/2026)

O site já tem o espaço para fotos (`src/modules/marketing/sales-photos.ts`). Enquanto `src` estiver `null`, a seção não aparece. Para ativar: salve os arquivos em `public/photos/` (WebP, ~1600 px no maior lado, < 300 KB) e preencha `src` (ex.: `"/photos/mesa-dashboard.webp"`).

Regras: pessoas fictícias geradas/fotografadas com autorização de uso comercial, sem marcas de terceiros, sem logotipos, telas **desfocadas ou de costas** (a interface real é mostrada nas capturas do site; IA gera texto de interface ilegível). Paleta: azul `#4162DE`, escuro `#121720`, claro `#EFF0F5`; luz natural suave, profundidade de campo rasa, aspecto de fotografia editorial (câmera full-frame, 35–50 mm).

| Arquivo | Proporção | Prompt-base |
| --- | --- | --- |
| `mesa-dashboard.webp` | 1:1 | Fotografia ultrarrealista de uma gestora de marketing brasileira, 30 anos, sentada à mesa em escritório moderno, olhando para um monitor ultrawide com gráficos de barras azuis desfocados em modo apresentação, luz natural da janela, tons azul-petróleo e cinza, 50 mm f/1.8, grão sutil. |
| `maos-celular-relatorio.webp` | 16:10 | Fotografia ultrarrealista de uma mão segurando um smartphone com um relatório de resultados (gráfico azul e números desfocados) em uma cafeteria, fundo desfocado, luz quente lateral, 85 mm f/1.4. |
| `reuniao-apresentacao.webp` | 16:10 | Fotografia ultrarrealista de uma equipe diversa de 4 pessoas em uma sala de reunião, uma delas em pé apresentando resultados em uma TV grande com gráficos azuis desfocados, ambiente claro, 35 mm, estilo editorial corporativo. |

Se usar geração por IA: revise mãos, texto e reflexos; descarte imagens com artefatos. Se usar banco de imagens: verifique a licença comercial e guarde o comprovante.

## Direção aprovada em 18/10/2026 (substitui o estilo "amador/candid" acima)

Referência do proprietário: fotografia comercial polida e cinematográfica, pessoa de perfil ou em três quartos diante de um monitor grande, dashboard bem visível, ambiente de tecnologia/agência moderno, luz suave com profundidade de campo rasa; duas referências com painéis holográficos translúcidos de IA. Contexto obrigatório: **gestores de tráfego, agências, profissionais de performance**. Nunca padaria, loja ou cenas fora desse universo.

Processo técnico (já usado nas fotos atuais): gerar com FLUX.2 Pro (`black-forest-labs/flux-2-pro`, proporções aceitas: 1:1, 16:9, 3:2, 2:3, 4:5, 5:4, 9:16, 3:4, 4:3) com a tela do aparelho em verde chapado (#00FF00), sem logos/marcas; depois substituir o verde por uma captura REAL de `public/product/` em perspectiva (homografia + croma suave), retocar logos de terceiros que apareçam. Não usar logos de Meta/Google nas imagens.

Prompts pendentes (aguardam crédito no Replicate):
1. Mulher de cabelo cacheado e óculos redondos, suéter azul-petróleo, loft moderno com tijolo e janelas industriais, monitor grande à esquerda em três quartos, tela verde.
2. Homem barbudo de óculos, de perfil, em escritório de vidro ao entardecer, monitor grande em três quartos, tela verde.
3. Homem recostado à noite diante do monitor (tela verde) com painéis holográficos translúcidos de IA e esfera de rede neural sem texto nem logos.
