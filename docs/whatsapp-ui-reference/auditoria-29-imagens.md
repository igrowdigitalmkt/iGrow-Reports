# Auditoria das 29 referências

Referências: `C:\Users\Silvio Melo\Desktop\WhatsApp Web - 29 Imagens de Referencia`.
Todas as imagens foram abertas individualmente. Alterações e validações seguem a ordem numérica; análise não significa implementação concluída. Os dados dos contatos e mensagens não serão copiados para produção.

| Imagem | Estado e pontos de comparação | Situação |
| --- | --- | --- |
| 01 | Exclusão: modal central na tela, 375px de largura, título em duas linhas, botões de 50px, fundo escurecido, checkbox verde, barra inferior. | Primeira etapa aplicada e validada: centro, título, cores, checkboxes e barra de seleção única. Duas opções de exclusão validadas na demonstração. Diferença intencional: explicação da exclusão local. |
| 02 | Encaminhamento: diálogo vertical, pesquisa contornada, avatares, checkboxes, lista rolável e seleção ao fundo. | Etapa aplicada e validada para destinatários em conversas: geometria, paleta, tipografia, pesquisa, seleção e confirmação condicional. Status e criação de grupo não implementados por falta de suporte neste fluxo. |
| 03 | Seleção de mensagens: faixa de destaque em toda a linha, checkboxes à esquerda, contagem e ações inferiores. | Etapa aplicada: destaque de largura total, checkbox alinhado, clique na linha, barra de 77px, contagem e ações na ordem da referência. Permissões próprias do iGrow preservadas. |
| 04 | Reações completas: painel compacto, categorias, pesquisa verde, grade de oito colunas. | Layout aplicado; desenhos dos emojis e ícones ainda diferem |
| 05 | Menu da mensagem: reações rápidas separadas, ícones, linhas e divisórias, posição junto ao balão. | Layout aplicado; notas, denúncia e desenhos dos assets pendentes. Ações e permissões próprias preservadas. |
| 06 | Pesquisa na conversa: painel à direita, cabeçalho, campo, resultados destacados e redução da área da conversa. | Layout e pesquisa local aplicados; calendário usa filtro nativo, escopo limitado às mensagens carregadas. |
| 07 | Menu do cabeçalho da conversa: alinhamento à direita, ações agrupadas por divisórias e ícones. | Layout aplicado; atalhos de pesquisa, seleção vazia, listas e fechar disponíveis. Funções de provedor ausentes pendentes. |
| 08 | Associação a listas: botão com cores sobrepostas, popover, bolinhas, checkboxes e gestão. | Layout aplicado e validado com dados fictícios; persistência autenticada ainda precisa de validação real. |
| 09 | Dados do contato, parte inferior: seções, separadores, grupo em comum e ações. | Painel, grupos em comum, favoritos, listas, exportação e bloqueio/desbloqueio nativo aplicados; ações adicionais ainda pendentes. |
| 10 | Dados do contato, parte superior: foto de 150px, identidade, atalhos, listas, notas, mídias e favoritos. | Pendente |
| 11 | Emojis do compositor: painel maior, categorias, pesquisa, grade de 12 colunas e abas inferiores. | Pendente |
| 12 | Anexos: menu vertical, ícones coloridos, separadores, ancoragem acima do botão. | Pendente |
| 13 | Responder: bloco citado acima do campo, faixa lateral, autor e fechar; conversa redimensionada. | Pendente |
| 14 | Telefone: painel esquerdo, pesquisa, instrução e teclado numérico. | Pendente |
| 15 | Novo contato: formulário com sublinhados, ícones e sincronização com celular. | Pendente |
| 16 | Nova conversa: pesquisa, atalhos, contato próprio e lista alfabética. | Pendente |
| 17 | Confirmação de associação: notificações brancas arredondadas empilhadas à esquerda. | Pendente |
| 18 | Menu de conversa na lista: posição junto à seta, ícones, divisória e ações. | Pendente |
| 19 | Filtros por lista: popover compacto abaixo da seta com cores e criar lista. | Pendente |
| 20 | Gestão de listas: cabeçalho, contagem, cores e menu de reordenação. | Pendente |
| 21 | Criar lista vazia: campo, emoji, cor, sugestões, inclusão de conversas e botão desabilitado. | Pendente |
| 22 | Menu da lista: foco da linha, editar, escolher cor e apagar. | Pendente |
| 23 | Adicionar pessoas à lista: modal vertical, pesquisa, conversas e confirmação circular. | Pendente |
| 24 | Criar lista preenchida: nome e cor, inclusão de conversas e botão habilitado. | Pendente |
| 25 | Seleção de conversas: três marcadas, barra de contagem, menu de ações e alinhamento dos avatares. | Pendente |
| 26 | Seleção de conversas vazia: zero selecionadas, caixas desmarcadas e destaque da conversa aberta. | Pendente |
| 27 | Menu principal: grupos de ações, divisórias, ícones e posição abaixo dos três pontos. | Pendente |
| 28 | Conversa sem listas: geometria geral, mensagens, reações, cabeçalho e compositor. | Pendente |
| 29 | Nenhuma conversa aberta: painel inicial, cartão, ilustração, atalhos e rodapé. | Pendente |

## Critérios de validação

Comparação principal em 1920×1080, resolução das referências. Conferir também 1536×864, 1366×768, 1024×768 e 390×844. Reavaliar componentes compartilhados após cada alteração. Operações sem suporte real exigem análise do conector antes da implementação. Fidelidade total permanece pendente até comparar todos os estados com evidências no navegador.

## Imagem 09 — parte inferior dos dados do contato

- Painel de 575px em 1920×1080. Em dimensões intermediárias, largura e margem cedida pela conversa seguem `min(575px, 47%)`, corrigindo a sobreposição do painel. Em celular, ocupa toda a conversa.
- Cabeçalho de 80px, texto de 20px, divisórias finas, margem lateral de 25px, grupo com avatar de 60px e ações de 78px. Mudar lista abre os vínculos existentes dentro do painel, com o estado de ocupação e permissões preservados.
- Consulta de grupos em comum usa o número da agência e comparação dos identificadores nativos, incluindo `phoneNumber` para participantes LID. Retorna somente nome/ID dos grupos confirmados, sem enviar os participantes ao navegador; identificação incompleta ou serviço indisponível são informados. A rota mantém escopo RLS e verifica acesso ao módulo WhatsApp.
- O serviço conectado confirmou um grupo com dois participantes LID, ambos com telefone associado. Essa verificação foi somente leitura; nomes e telefones não foram copiados para fixtures.
- Favoritos usa a operação existente da iGrow, com reversão da marca e erro explícito em caso de falha. Exportação baixa um TXT das mensagens carregadas, declara o escopo antes do download e não recupera texto de mensagens revogadas. Não exporta histórico remoto ou arquivos de mídia.
- QA reproduzível: `node scripts/qa-whatsapp-contact-details-reference.mjs`. Seis tamanhos/níveis de zoom, geometria, grupos fictícios, listas, exportação real de fixture, foco, Esc e cancelamento; nenhuma alteração enviada ao WhatsApp. Capturas em `artifacts/whatsapp-09-after-1920.png` e `artifacts/whatsapp-09-after-390.png`.
- Testes de rota cobrem isolamento por agência, restrição por módulo, canais, ausência de dados e falha de consulta. O adaptador cobre PN/LID e exportação cobre Unicode, ordem e mensagens apagadas.
- ESLint aprovado; 120 arquivos e 811 testes Vitest aprovados. A leitura dos campos de participantes foi conferida no [código oficial do Baileys](https://github.com/WhiskeySockets/Baileys/blob/master/src/Socket/groups.ts).
- Bloquear/desbloquear contato usa a sessão QR nativa: consulta `fetchBlocklist`, alteração `updateBlockStatus` e nova consulta para confirmar o resultado. Estado é atualizado a cada 15 segundos enquanto o painel está aberto. Confirmação, foco, Esc, mensagens de falha persistentes e acesso somente de leitura foram validados em desktop e celular. Consultas retornam somente um booleano, sem revelar a lista de bloqueados. LID sem associação comprovada pelo repositório Signal permanece indisponível; o próprio número não pode ser bloqueado.
- Rota verifica o módulo, permissão de escrita e agência antes de acessar o provedor. Testes executam o método real do patch com cliente simulado para bloquear/desbloquear, identidade desconhecida, sessão desconectada, própria conta e confirmação divergente. QA: `node scripts/qa-whatsapp-contact-block.mjs`; cria e remove um harness temporário local e intercepta todas as operações. Nenhum contato real foi bloqueado/desbloqueado. Verificação somente leitura no VPS confirmou consulta nativa por telefone e recusa segura de um LID ainda não mapeado.
- Validação desta continuação: 122 arquivos/820 testes aprovados; ESLint, TypeScript, QA do bloqueio e regressão do painel. Imagem do provedor: `igrow/evolution-api:2.3.7-contact-block-1`, preservando patches de etiquetas e estado da conversa.
- Pendências desta imagem: tema por conversa, verificação de criptografia, denunciar, limpar e apagar conversa, edição do contato e sublinha dos integrantes do grupo. Esses controles não foram simulados. Ícones ainda usam Lucide. A identidade superior será tratada na imagem 10. A imagem 09 ainda não representa equivalência de 100%.

## Evidências da primeira correção da imagem 01

- Antes: diálogo em x=1100, largura=375 em viewport 1920; centralizado apenas na conversa.
- Depois: x=772,5, largura=375, centro x=960. Em 390×844: x=15, largura=360, centro x=195.
- Cancelar fecha o diálogo em ambas as dimensões. Nenhuma exclusão real foi executada.
- Capturas locais: `artifacts/whatsapp-01-before.png`, `artifacts/whatsapp-01-after-1920.png` e `artifacts/whatsapp-01-after-390.png` (pasta ignorada pelo Git).
- ESLint do componente, TypeScript e Vitest aprovados: 116 arquivos, 790 testes.
- A suíte histórica `qa-whatsapp-ui-reference.mjs` parou na expectativa de cabeçalho de 84px; implementação atual e referências usam 80px. Ela precisa ser revisada contra as 29 capturas antes de ser considerada critério de aprovação.
- Explicações da exclusão local preservadas por diferença real de comportamento do produto.
- Validação final em 1920×1080, 1366×768 e 390×844 com ambas as opções. A demonstração bloqueou corretamente a ação de revogação, apresentou explicação e permitiu cancelar. Nenhuma mensagem real foi alterada.
- Centralização também conferida com deviceScaleFactor 1,25 e 1,5.
- Barra de seleção única: cancelar, contagem e apagar. Outras ações permanecem no menu da mensagem e na seleção múltipla.
- A conversa de demonstração d3 contém uma mensagem fictícia elegível para exibir os dois botões; isso não altera elegibilidade ou permissões de mensagens reais.
- Build de produção aprovado na primeira revisão; executado novamente após os últimos ajustes.

## Imagem 02 — encaminhamento

- Diálogo em 1920×1080: x=688, y=63, largura=545 e altura=954; pesquisa de 54px, avatares de 60px, linhas de 90px e checkboxes de 22px.
- Fundo do diálogo #161717 e hover #2e2f2f medidos na imagem. Escurecimento externo de 30%; nomes longos truncados sem desalinhar as linhas.
- Removida a linha extra com telefone abaixo de todos os nomes. A conversa do próprio número, quando identificada pelos dados existentes, mantém “Mensagens para mim”.
- Confirmação circular aparece apenas após escolher um destinatário. Limite de 10 destinatários preservado; novas caixas ficam desabilitadas ao atingir o limite, mantendo possível desmarcar.
- Pesquisa aceita espaços nas extremidades e busca nome, telefone e cliente; destinatários de outro canal continuam excluídos. Seleção persiste ao trocar o filtro. Resultado vazio recebe mensagem explícita.
- Esc e botão fechar encerram o diálogo e devolvem o foco à mensagem; Tab/Shift+Tab ficam dentro do modal. Campos ficam bloqueados enquanto o envio está em andamento.
- QA reproduzível: `node scripts/qa-whatsapp-forward-reference.mjs`, com servidor de demonstração em 3158. Sete cenários aprovados: 1920×1080, 1536×864, 1366×768, 1024×768, 390×844, 1536×864 @1,25 e 1280×720 @1,5. Nenhum POST ao WhatsApp foi executado.
- Capturas: `artifacts/whatsapp-02-after-1920.png` e `artifacts/whatsapp-02-after-390.png`.
- Limitação: a seção “Meu status” e o atalho de criar grupo da referência exigem operações não disponíveis no fluxo atual. Não foram acrescentados controles fictícios ou espaço vazio para simulá-los. Por isso, esta etapa não representa equivalência total da imagem.
- ESLint e TypeScript aprovados; 116 arquivos e 790 testes Vitest aprovados. Build de produção executado após as alterações.

## Imagem 03 — seleção de mensagens

- Linhas selecionáveis agora ocupam toda a largura útil da conversa, com fundo #151616 e altura mínima de 90px. Checkbox de 22px fica no mesmo eixo para mensagens enviadas e recebidas. Marcação verde é instantânea.
- Em desktop, área das mensagens em seleção usa 130px à esquerda e 25px à direita; seleção desloca os balões sem alterar a estrutura interna do player de áudio. Em celular, margens adaptadas de 64px e 18px.
- A linha inteira é clicável, inclusive o espaço vazio. Os controles de reações e reprodução permanecem inativos durante a seleção para evitar ações involuntárias.
- Barra de seleção múltipla: 77px em desktop, 67px em celular; “N itens selecionados”; favoritar, apagar, encaminhar e baixar. Copiar e fixar continuam no menu normal da mensagem. Seleção única mantém a barra compacta da imagem 01.
- Apagar continua bloqueado em seleção com mensagens recebidas. Download fica bloqueado para seleção sem mídia, mensagens revogadas e demonstração; usa a rota autenticada já existente para mídias reais, com erro explícito e liberação das URLs temporárias.
- QA: `node scripts/qa-whatsapp-selection-reference.mjs`. Seis configurações aprovadas: 1920×1080, 1366×768, 1024×768, 390×844, 1536×864 @1,25 e 1280×720 @1,5. Verificações de alinhamento, cor, largura, seleção pelo espaço vazio, permissões, encaminhamento e cancelamento. Nenhuma mutação real.
- Capturas: `artifacts/whatsapp-03-after-1920.png` e `artifacts/whatsapp-03-after-390.png`.
- ESLint, TypeScript, 116 arquivos/790 testes e build aprovados. Download efetivo de mídias e ações autenticadas ainda precisam de validação com dados reais; nenhuma confirmação de provedor foi simulada.

## Imagem 04 — painel completo de reações

- Painel de 488×404px em 1920×1080, cantos de 16px, oito categorias e oito colunas. Busca de 54px com contorno verde, indicador de categoria de 30px e conteúdo com rolagem interna. Reações rápidas ficam ocultas enquanto o painel completo está aberto.
- As primeiras quatro linhas seguem a ordem da referência. Gestos entram em “Smileys e pessoas”; atividades, natureza, comidas, viagens, objetos, símbolos e bandeiras ficam acessíveis por categorias.
- Busca ignora espaços externos e acentos; troca de categoria limpa a busca e reinicia a rolagem. Setas, Home e End navegam nas categorias; Esc fecha. O campo de busca recebe foco ao abrir.
- Posicionamento considera as dimensões reais do painel e limita o popup à janela. O seletor do compositor mantém sua apresentação e nove abas, incluindo recentes.
- QA reproduzível: `node scripts/qa-whatsapp-reaction-reference.mjs`. Seis configurações: 1920×1080, 1366×768, 1024×768, 390×844, 1536×864 @1,25 e 1280×720 @1,5 (deviceScaleFactor). Busca, ordem inicial, teclado, limites do popup e regressão do compositor aprovados, sem erros de navegador ou POST ao WhatsApp.
- Capturas: `artifacts/whatsapp-04-after-1920.png` e `artifacts/whatsapp-04-after-390.png`.
- Pendência visual: emojis ainda são renderizados pelo conjunto nativo do sistema; ícones de categorias usam Lucide. Os desenhos não são idênticos aos assets da referência. Esta etapa não representa fidelidade de 100%.
- ESLint, TypeScript e build de produção aprovados; 116 arquivos e 790 testes Vitest aprovados. Reações autenticadas continuam usando o fluxo existente; não foi realizado envio real ao provedor.

## Imagem 05 — menu da mensagem

- Reações rápidas em faixa própria de 306×52px, fundo #161717 e borda arredondada. Menu separado por 6px, largura de 270px, cantos de 22px, linhas de 45px, texto de 18px e ícones de 20px (medidas antes do zoom CSS responsivo).
- Ordem inicial: responder, copiar, reagir, encaminhar, fixar e favoritar. Divisória separa dados da mensagem, selecionar e apagar quando permitido. O novo atalho “Reagir” abre o painel completo da imagem 04.
- Popup abre ao lado do balão e mantém limites da janela; em espaço insuficiente, reposiciona verticalmente. Reações também usam a faixa independente quando abertas pelo ícone de sorriso.
- Menu recebe foco na primeira ação habilitada depois do posicionamento. Setas para cima/baixo, Home e End navegam entre ações habilitadas. Esc fecha e devolve foco ao botão que abriu. Reações rápidas ficam ocultas em mensagens revogadas.
- QA: `node scripts/qa-whatsapp-message-menu-reference.mjs`. Seis configurações aprovadas: 1920×1080, 1366×768, 1024×768, 390×844, 1536×864 @1,25 e 1280×720 @1,5. Geometria ajustada ao zoom CSS existente, ordem, divisória, teclado, foco, resposta e abertura de reações verificados sem POST ao WhatsApp.
- Capturas: `artifacts/whatsapp-05-after-1920.png` e `artifacts/whatsapp-05-after-390.png`.
- Diferenças pendentes: adicionar texto às notas e denunciar não estão disponíveis no fluxo atual. Dados da mensagem e selecionar continuam disponíveis; apagar mantém a elegibilidade do produto. Emojis nativos e ícones Lucide diferem dos desenhos da referência. Esta etapa não representa equivalência total.
- ESLint, TypeScript, 116 arquivos/790 testes e build de produção aprovados. Painel completo de reações revalidado nas seis configurações.

## Imagem 06 — pesquisa na conversa

- Painel de 575px em 1920×1080; largura e margem cedida pela conversa usam a mesma regra, evitando sobreposição em telas intermediárias. No celular ocupa toda a conversa. Cabeçalho de 80px no desktop e 64px no celular, título de 20px.
- Campo de 54px com borda branca, lupa, limpar e calendário ao lado. Calendário abre filtro de data nativo funcional para as mensagens carregadas, com botão limpar data.
- Resultados do mais recente ao mais antigo: horário em 14px, trecho em 18px e correspondências verdes, preservando o texto original. Trechos longos limitados a duas linhas e recortados próximos do primeiro termo encontrado. Status das mensagens enviadas reutiliza o componente real de entrega.
- Pesquisa ignora espaços externos e diferença entre maiúsculas/minúsculas. Mensagens revogadas ficam excluídas. Estados inicial e vazio explícitos; quantidade anunciada para leitores de tela.
- Clicar no resultado navega ao balão e realça brevemente a linha. Em celular também fecha o painel. Preferência por movimento reduzido respeitada. Limpar mantém foco no campo; fechar e Esc devolvem foco ao botão de pesquisa.
- QA: `node scripts/qa-whatsapp-chat-search-reference.mjs`. Seis configurações: 1920×1080, 1366×768, 1024×768, 390×844, 1536×864 @1,25 e 1280×720 @1,5. Geometria, ausência de sobreposição, destaque, ordem, limpeza, filtro com/sem resultados, navegação e foco aprovados sem POST ao WhatsApp.
- Capturas: `artifacts/whatsapp-06-after-1920.png` e `artifacts/whatsapp-06-after-390.png`.
- Diferenças: busca permanece nas mensagens carregadas, sem consulta a histórico remoto. Rodapé informa esse escopo em lugar da data de sincronização específica do WhatsApp original. Calendário nativo e ícones Lucide ainda diferem dos assets oficiais; equivalência visual total permanece pendente.
- ESLint, TypeScript, 116 arquivos/790 testes e build final aprovados. Menu da mensagem revalidado nas seis configurações.

## Imagem 07 — menu do cabeçalho da conversa

- Largura de 284px, alinhamento à direita do botão, início próximo de y=70 em 1920×1080, fundo #161717, cantos de 22px e borda #343737. Linhas de 45px, texto de 18px, ícones de 20px e separador antes de arquivar. Estilos restritos ao cabeçalho da conversa.
- Ordem das ações disponíveis: dados do contato/informações do grupo, pesquisar, selecionar mensagens, favoritos, mudar lista, fechar conversa e arquivar. Mudar lista usa a associação existente no cabeçalho. Pesquisa abre o painel da imagem 06. Fechar apenas retorna à lista.
- Selecionar mensagens abre checkboxes com zero itens selecionados e apenas o botão cancelar. Primeira marcação entra no fluxo existente, com as mesmas permissões e ações da imagem 03. Trocar de conversa limpa esse estado.
- Primeiro item recebe foco ao abrir; setas, Home e End navegam entre itens habilitados. Esc fecha e devolve foco ao botão; clique fora fecha. Arquivar e favoritos ficam desabilitados na demonstração.
- QA: `node scripts/qa-whatsapp-conversation-menu-reference.mjs`. Seis configurações: 1920×1080, 1366×768, 1024×768, 390×844, 1536×864 @1,25 e 1280×720 @1,5. Largura, limites, alinhamento, ordem, divisória, teclado, foco, pesquisa, seleção vazia e fechar verificados sem POST ao WhatsApp.
- Capturas: `artifacts/whatsapp-07-after-1920.png` e `artifacts/whatsapp-07-after-390.png`.
- Pendências: silenciar, mensagens temporárias, tema por conversa, exportar, links/chamadas em grupo, denunciar, bloquear, limpar e apagar conversa não estão implementados neste fluxo. Menu tem menor altura que a referência devido às ações ausentes; ícones também não são os assets oficiais. Fidelidade total permanece pendente.
- ESLint, TypeScript, 116 arquivos/790 testes e build final aprovados. Seleção e pesquisa revalidadas nas seis configurações. Associação de listas e fechamento por clique fora incluídos no QA final do menu.

## Imagem 08 — associação a listas

- Popover de 345×368px com quatro listas na demonstração, fundo #1d2020, cantos de 20px, linhas de 56px e texto de 18px. Bolinhas de 15px e checkboxes de 23px com fundo branco e marca escura. Removido o título adicional que não aparece na referência.
- Botão de 50px no desktop mostra contagem com singular/plural e duas cores sobrepostas, das últimas listas na ordem exibida. No celular fica compacto mantendo as cores visíveis; popover é posicionado dentro da janela.
- Divisória e atalhos “Nova lista” e “Gerenciar listas” usam os fluxos existentes. No celular, esses atalhos mostram a coluna de criação/gestão ao sair da conversa, corrigindo o conteúdo que antes permanecia oculto.
- Esc fecha e devolve foco ao botão; clique fora fecha. Primeiro controle habilitado recebe foco. Busy e erro preservados; checkbox nativo continua associado ao nome da lista.
- Demonstração QR contém quatro listas fictícias associadas apenas à conversa d2. São somente leitura, sem persistência ou chamadas à API; outros canais continuam sem essas listas. Conversa d1 permite conferir o estado desmarcado.
- QA: `node scripts/qa-whatsapp-list-membership-reference.mjs`. Seis configurações: 1920×1080, 1366×768, 1024×768, 390×844, 1536×864 @1,25 e 1280×720 @1,5. Dimensões, limites, cores, checkboxes marcados/desmarcados, foco, fechamento, criação e gestão conferidos sem POST/PATCH/DELETE ao WhatsApp.
- Capturas: `artifacts/whatsapp-08-after-1920.png` e `artifacts/whatsapp-08-after-390.png`.
- Persistência real de associações mantém a rota existente e ainda precisa de validação autenticada. Desenhos dos ícones e posição absoluta do botão no cabeçalho ainda diferem da referência; fidelidade total permanece pendente.
- ESLint, TypeScript, 116 arquivos/790 testes e build final aprovados. Menu do cabeçalho revalidado nas seis configurações após incluir as listas fictícias.
