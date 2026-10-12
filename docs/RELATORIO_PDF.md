# Relatório em PDF — definição e plano (12/10/2026)

Status: **definição aprovada pelo responsável; nada do novo PDF está implementado.** O PDF atual (`src/modules/reports/pdf-download.ts`, `pdf-presentation.ts`, jsPDF) continua em uso até a troca.

## 1. Diagnóstico do PDF atual
Exemplo analisado: "RM Imobiliária 30/09–06/10", 7 dias, **233 páginas**. As páginas 6 a 232 são a tabela "Seleção incluída na análise" (cada campanha, conjunto e anúncio, repetida por bloco de 3 colunas, inclusive anúncios com gasto zero). Outros problemas: texto de 7–8 pt, fusos e cobertura no cabeçalho, nomes brutos de ações da Meta, resultados por dia "Indisponível", gráficos pequenos, análise do responsável perto do fim, número divergente para o mesmo rótulo.

## 2. Regras de conteúdo
- **Não existe "resultado principal".** Todos os resultados do período aparecem, por tipo, cada um com seu custo; tipos diferentes nunca são somados (ver memória do projeto e `docs/METRICAS.md`).
- **Resultado = o da campanha** (resultado que a Meta atribui ao objetivo de otimização, `result:provider:*`). O total bruto de ações da conta (ex.: 71 conversas contra 66 de resultado; 27.114 contra 9.552 de engajamento) só aparece em "Detalhes", com o nome "Todas as ações registradas na conta (inclui campanhas com outro objetivo)".
- Sem limite fixo de páginas, mas toda página precisa de informação útil. Nada de tabelas com centenas de linhas: a lista completa de campanhas/conjuntos/anúncios fica no CSV/JSON. Anexos têm teto (ex.: 10 anúncios por investimento, sem gasto zero).
- Ausência não vira zero. Fusos, cobertura e estimativas ficam no rodapé de "Sobre os dados".
- Linguagem neutra, sem "agência".

## 3. Blocos (o responsável liga e desliga por relatório)
| Bloco | Conteúdo | Padrão |
|---|---|---|
| Cabeçalho | Faixa de cor do responsável, logo, cliente, período, fonte | Ligado |
| Resumo | Frase com **todos** os tipos de resultado e custos; texto por regra, sem IA | Ligado |
| Indicadores | Valor usado (com variação), resultados e custo por tipo | Ligado |
| Alcance e entrega | Alcance, impressões, CPM, cliques, CPC, com variação | Ligado |
| Desempenho do período | Linhas: valor usado × resultado escolhido (eixos duplos), comparação opcional | Ligado |
| Análise e direcionamentos | Comentário do responsável; depois, rascunho da IA aprovado por ele (etapa 4 de `VISAO_IA.md`) | Ligado, perto do início |
| Público do período | Rosquinhas: plataformas, gênero, idade, região (alcance) | Ligado |
| Investimento por conta | Rosquinha por conta, **sempre** | Ligado |
| Saldo e pagamentos | Saldo/a pagar, média por dia, limite; **mantém os dados do cartão** (ex.: VISA *7129) | **Ligado** |
| Detalhes | Tabela diária, top anúncios (limitado), ações brutas, notas sobre os dados | Desligado |

Formato: A4 vertical, **fundo branco**, fonte Inter embutida, cabeçalho mais elaborado. A versão horizontal (apresentação) continua com objetivo próprio, usando o mesmo conteúdo.

## 4. Tecnologia
Teste técnico de 12/10 (pasta isolada, nada instalado no projeto): `@react-pdf/renderer` 4.9.0 com React 19.3.0, Node 26: gerou PDF de 2 páginas em ~0,8 s (25 KB) com Inter 400/500/700 embutida, acentuação correta, cabeçalho, rosquinhas e gráfico de linhas de eixos duplos. A documentação do Next instalado lista `@react-pdf/renderer` em `serverExternalPackages` por padrão. **Ainda não testado:** dentro do Next 16 do projeto (build e Vercel), geração no navegador (fontes por URL) e aparência final conferida pelo responsável.

## 5. Plano de execução
1. Responsável avalia o PDF do teste técnico (cabeçalho, rosquinhas, linhas, tipografia).
2. Instalar a biblioteca no projeto e provar build, rota de servidor e navegador; incluir fonte Inter nos arquivos estáticos.
3. Camada de dados do relatório: converter `AnalyticsDashboardData`/relatório salvo em um modelo de blocos (resultados por tipo, séries, público, saldos). Conferir que os números do PDF são iguais aos do painel (testes existentes de integridade).
4. Implementar os blocos e a escolha de blocos na tela de geração, com o novo PDF ao lado do antigo atrás de uma chave.
5. Testes: números iguais ao painel, nomes longos, muitas contas, ausência de dados, quebra de página, período anual.
6. Homologar com dados reais (baixar, abrir no celular, enviar pelo WhatsApp); só então trocar o padrão e remover o jsPDF antigo.

Pendências de dados: público (plataformas/gênero/idade/região) e saldos de conta precisam existir no snapshot usado pelo relatório; confirmar na etapa 3 de onde vêm hoje no painel.

## 6. Atualização de 12/10/2026 (aprovação do protótipo)
- O responsável aprovou o protótipo de 5 páginas (A4, fundo branco, Inter, cabeçalho em faixa clara com cor da marca) e pediu **fontes maiores, porque a maioria lê no celular**. Ordem: 1 resumo, valor usado e resultados por tipo em cartões; 2 alcance/impressões/CPM e desempenho; 3 análise e direcionamentos (rascunho da IA, opção B do plano de IA) e investimento por conta; 4 público; 5 saldo e pagamentos (com dados do cartão, ligado por padrão).
- Tamanhos em pt no protótipo: resumo 17, títulos 22, valores 27–32 (28–32 nos cartões), rótulos 14–16, notas 13, legendas 14, eixos 12, rodapé 11,5. Em A4 visto no celular o texto ainda encolhe (~0,65x). **Decisão pendente:** formato de página "celular" (proporção ~9:16, ex.: 450×800 pt) com os mesmos tamanhos, mantendo A4 como opção para imprimir.
- Verificação visual: o protótipo foi renderizado para imagem com pdf.js + Chrome sem cabeça (scripts em pasta temporária da sessão, não no repositório). Reproduzir esse processo ao implementar.
- Armadilhas do `@react-pdf/renderer`: item com `flexBasis: 0` numa coluna colapsa a altura; texto SVG precisa de `fontFamily` explícito; conteúdo que passa da página cria páginas extras (checar contagem de páginas nos testes).

## 7. Implementação (12/10/2026)
Feita em `src/modules/reports/pdf/` (ver `docs/IMPLEMENTACAO.md`, 12/10/2026). Fluxo contínuo de seções com título preso ao primeiro bloco (evita título sozinho no pé da página), 6 a 8 páginas com dados de teste. Chave `NEXT_PUBLIC_REPORT_PDF_V2=1` liga o PDF novo no download, no envio pelo WhatsApp do relatório salvo e no envio agendado; desligada por padrão. Público e saldo dependem de congelar esses dados no relatório salvo. Gráficos de resultado por dia dependem de séries diárias por tipo de resultado confirmado pela Meta; hoje só valor usado e cliques no link entram, para não mostrar resultado diário diferente do total.
