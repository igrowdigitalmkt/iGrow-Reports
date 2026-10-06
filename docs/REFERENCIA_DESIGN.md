# Referência de design — observação da Criativivo (5/10/2026)

Observação guiada pelo responsável no navegador do app, como **referência de estilo e experiência** para o layout do iGrow Reports. Não copiar marca, logotipo, imagens, textos de marketing nem código; adaptar à identidade do iGrow. Nenhum dado de clientes foi registrado.

## Base técnica identificada
- Componentes no padrão **shadcn/ui** (tokens HSL em `.dark`, sidebar `data-sidebar`), Tailwind, gráficos **Tremor**.
- Tipografia: **Inter** 400/500/600/700.

## Paleta (tema escuro)
| Token | Valor | Uso |
|---|---|---|
| background / card | `hsl(220 85% 5%)` (#020918) | fundo da página |
| foreground | `hsl(210 20% 98%)` (#F9FAFB) | texto principal |
| primary | `hsl(214 100% 50%)` (#006FFF) | botões e destaques |
| secondary / muted / border / input | `hsl(215 28% 17%)` (#1F2937) | superfícies e bordas |
| muted-foreground | `hsl(218 11% 65%)` | texto secundário |
| sidebar | #1D283A | menu lateral |
| modal | #1C2536, borda #222F44 | diálogos |
| campos | #374151, borda #4B5563 | inputs/selects |
| sucesso / aviso / info / erro | `hsl(142 65% 55%)` / `hsl(38 92% 60%)` / `hsl(214 95% 65%)` / `hsl(0 72% 50%)` | toasts e estados |
| gráficos | azul `hsl(214 100% 60%)`, esmeralda `hsl(158 64% 60%)`, laranja `hsl(25 95% 60%)`, cinza `hsl(220 9% 60%)` | séries Tremor |

## Medidas recorrentes
- Raio: **14 px** em botões, campos e itens de menu; **16 px** em modais; pílulas (`9999px`) em chamadas secundárias.
- Altura de controles: **40 px** (campos, botões), botão principal grande 44–48 px.
- Texto: corpo 14 px (controles), rótulos 14 px peso 500 acima do campo; títulos de modal 20 px peso 600.
- Sidebar: 255 px, itens 32 px, ícone + 14 px, agrupados por seção com título discreto; contadores à direita.
- Overlay de modal: preto 80%.

## Fluxo de acesso observado
1. Página inicial pública → "Login" / "Começar Agora".
2. Cadastro (`/login?mode=signup`): card central 384 px; nome, e-mail, senha + confirmação (mostrar senha), telefone com país, "Como nos conheceu?"; link para login. Tempos: TTFB 0,2 s, DOM 1,5 s, load 3,5 s.
3. Após criar a conta: entra direto no app (`/campaigns`), sem confirmação de e-mail intermediária; modal de planos, depois questionário de boas-vindas (Instagram, faixa de clientes, cargo) com botão "Avançar".
4. Faixa superior com contagem regressiva do teste e botão "Ver planos".

## Painel Meta Ads (`/campaigns`)
Ordem vertical: título + seletor de conta + período → ações (PDF, Organizar, Comparar) → grade de KPIs → Performance (gráfico) → tabela de campanhas → Melhores Anúncios → Funil de Conversão → Dados Demográficos → Meta de Investimento → "Organizar seções", "Verificar Saldo", "PDF Avançado" / "PDF da Página".

- **Cabeçalho:** h1 30 px/700 com ícone da plataforma; seletor de conta e período à direita (botões #1C2536, borda #222F44, raio 14, 40 px). Padding do `main` 32 px.
- **KPIs:** cerca de 30 cards (Investimento, ROAS, CPA, CTR, CPC, CPM, Frequência, Resultados...), grade de 3 colunas no desktop e 2 no tablet, espaço de 24 px. Card #1D283A, borda #222F44, raio 16, padding 24, ~138 px de altura. Rótulo 14 px/400 com ícone (i) de explicação; valor 24 px/600. À direita, um quadrado de 48 px com fundo `rgba(0,111,255,.1)`, raio 16 e ícone azul #006FFF. A ordem dos cards é configurável ("Organizar").
- **Performance:** o gráfico não aparece sozinho. O estado vazio mostra um texto e o botão "Gerar Gráfico" (#006FFF, 44 px), que busca a série diária só quando o usuário pede. h2 20 px/600.
- **Tabela de campanhas:** busca, filtro por objetivo (pílula colorida), "Apenas anúncios", período próprio, templates de colunas. Cabeçalho em maiúsculas 12 px/500, espaçamento 0,6 px, cor #D1D5DB; células com padding 16 px; botões de controle na tabela #2A3549.
- **Funil:** blocos azuis empilhados que estreitam (Impressões → Cliques → Resultados), com valor grande, custo unitário e a taxa de conversão entre cada etapa; topo, meio e fundo escolhidos em selects; "Valor investido" em pílula azul acima.
- **Meta de investimento:** lista de campanhas com status "Sem meta definida" e projeção; ao selecionar uma, aparece o detalhe (estado vazio com ícone circular e texto).
- **Responsivo:** abaixo de ~1024 px a sidebar vira barra inferior fixa com 4 abas (ícone + rótulo; a ativa em azul com fundo destacado). Os botões de ação ocupam a largura toda em linha.

## Carregamento observado
- Recarga de `/campaigns`: TTFB 0,2 s, DOM 1,1 s, load 1,9 s. Às ~1,2 s saem em paralelo cerca de 30 chamadas curtas ao Supabase (perfil, plano, assinaturas, equipe, logs), cada uma com 100–150 ms.
- Às ~3,5 s a estrutura aparece com "Selecione uma conta". Às ~4,2 s a última conta usada é restaurada sozinha, e a tabela chega logo depois (~4,3 s).
- **Estado de carregamento dos KPIs:** em vez de esqueleto cinza, cada card fica cheio de azul primário com a borda superior ondulada ("líquido"), mantendo rótulo e ícone visíveis. Quando o valor chega, o card volta ao fundo normal. Assim o usuário sabe que está carregando e não que está travado.
- Os valores dos cards chegam juntos; a página não fica parcialmente preenchida.

## Lições para o iGrow
1. Manter a estrutura (título, filtros, rótulos dos cards) visível desde o início e animar só a área do valor.
2. Lembrar a última conta e o período escolhidos.
3. Carregar sob demanda o que é pesado e secundário (gráfico diário, demografia), com estado vazio claro e uma ação explícita.
4. Usar tokens próprios do iGrow com a mesma estrutura: fundo muito escuro, superfícies em azul-acinzentado, uma cor primária forte, raio 14/16 e controles de 40 px.

## Em observação
- Páginas "Visão geral" e "Compilado", modal de comparação de períodos e o gráfico gerado.
