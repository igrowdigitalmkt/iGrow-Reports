# Referências para evolução do iGrow Reports

Estudo em 02/10/2026. Fontes: PDF do dashboard do Reportei enviado pelo usuário, navegação autenticada no Reportei e no AgencyAnalytics, e leitura pontual do projeto iGrow Reports. Este documento é uma proposta; não representa funcionalidades implementadas.

## Escopo e limites

No AgencyAnalytics foram examinadas as telas do cliente IGROW, campanhas e anúncios Meta Ads, seletor de métricas, modo de apresentação, portal do cliente, relatórios, modelos, KPIs, benchmarks, fontes de dados, métricas personalizadas e painéis consolidados (Roll-Ups).

No Reportei foram examinados projeto, integrações, dashboard, preparação de relatórios, modelos, preparação de automação, equipe, apresentação do módulo de metas, assistentes de análise e formulário da linha do tempo.

Não foram criados relatórios, dashboards, indicadores, usuários, automações ou conexões. A conta temporária tem áreas vazias; textos de apresentação comprovam a proposta de um recurso, mas não seu funcionamento completo. Benchmarks foram localizados, sem validar números ou metodologia. Flux, Studio, envios e resultados de IA não foram testados. Não houve acesso ao código interno dessas plataformas.

## Observações verificadas

### Reportei

- O PDF organiza resumo consolidado, Facebook da página e dois blocos separados do Meta Ads, um por conta.
- Indicadores, séries temporais, ações por tipo, público, dispositivos e rankings de campanhas/conjuntos/anúncios aparecem em sequência.
- Postagens, Reels e anúncios têm miniaturas, facilitando reconhecer o conteúdo.
- O tipo de resultado aparece junto ao número e ao custo por resultado.
- A criação de relatório oferece modelo, período, comparação, integrações e seleção de campanhas.
- Há modelos próprios reutilizáveis e opções de análise por IA.
- A preparação de automação distingue relatórios por e-mail de resumos pelo WhatsApp e oferece alerta de falha na integração.
- Uma observação explícita informa que relatórios automáticos incluem a conta inteira, sem recorte de campanhas, unidades ou pipelines.
- Metas e alertas são apresentados no módulo Controle; a linha do tempo permite registrar marcos e vincular um relatório.
- O arquivo enviado é uma única página longa; algumas tabelas ultrapassam sua largura. Não deve servir como referência de paginação A4.

### AgencyAnalytics

- A navegação distingue clientes, relatórios, painéis consolidados, KPIs, dados e modelos.
- O cliente tem áreas de dashboards, relatórios, dados, usuários, portal, benchmarks e KPIs.
- Meta Ads oferece campanhas, conjuntos, anúncios, demografia, conversões personalizadas e eventos personalizados.
- A tela examinada combina gráfico temporal, ranking, distribuição por plataforma de publicação, indicadores e tabela pesquisável.
- A tabela permite navegar de campanha para conjuntos. A tabela de anúncios identifica também campanha e conjunto.
- O seletor de métricas tem busca e grupos como reconhecimento, cliques, conversões, custos, comércio eletrônico, engajamento, mensagens e vídeo.
- O modo de apresentação remove a navegação e destaca os gráficos e indicadores do dashboard.
- O portal permite selecionar dashboards visíveis aos clientes e apresenta configurações de logo, cor e usuários.
- A biblioteca separa modelos de relatórios, páginas, clientes e e-mails.
- KPIs são apresentados como acompanhamento de desempenho com alertas.
- Roll-Ups são apresentados como consolidação e comparação entre vários clientes.
- A área de dados distingue fontes conectadas, contexto do cliente, arquivos, métricas personalizadas e visões personalizadas.
- Métricas personalizadas são descritas como cálculos sobre os dados conectados que podem ser usados pela IA.

## Proposta combinada

Preservar as quatro abas já definidas pelo usuário: Visão geral, Campanhas, Todas as métricas e Relatórios. A geração continua exclusivamente na Visão geral; Relatórios continua dedicada a gerir documentos. A seleção de entidades permanece a fonte do escopo da análise.

| Prioridade | Melhoria | Referência e benefício | Dependência |
|---|---|---|---|
| 1 | Blocos reordenáveis de indicadores, gráficos, tabelas e comentários | Combinar o detalhamento do Reportei com a composição de páginas do AgencyAnalytics | Persistir ordem e configuração por cliente/usuário; preservar os seis indicadores fixos |
| 1 | Resumo geral seguido de blocos por plataforma e conta | Explicar a contribuição de cada fonte sem misturar conceitos | Respeitar o escopo filtrado e identificar totais estimados |
| 1 | Miniaturas e identificação completa de anúncios | Reconhecer criativos e comparar desempenho em reunião | Associar criativos aos anúncios e disponibilizar imagens estáveis para PDF |
| 1 | Comentários do administrador por bloco e conclusão com próximos passos | Transformar uma sequência de números em análise compreensível | Salvar texto e congelá-lo junto com o relatório |
| 1 | Melhor composição de PDF e apresentação em tela | Leitura adequada em A4, slides e reunião ao vivo | Quebras de página, tabelas sem corte e escopo idêntico ao dashboard |
| 2 | Modelos reutilizáveis por objetivo | Repetir uma configuração aprovada sem começar do zero | Versionar layout, métricas, gráficos e textos; geração ainda na Visão geral |
| 2 | Público, horário, dispositivo e posicionamento | Identificar segmentos e canais com melhor desempenho | Novas consultas e armazenamento de detalhamentos compatíveis com a plataforma |
| 2 | Metas, progresso e alertas acionáveis | Acompanhar resultado, orçamento e custo por resultado | Definição do indicador, período, limite, direção desejada e política de notificações |
| 2 | Portal com identidade visual e conteúdo autorizado | Entrega organizada e personalizada ao cliente | Permissões e distinção entre dashboard atual e relatório publicado |
| 3 | Relatórios recorrentes e entrega acompanhada | Reduzir trabalho mensal e avisar falhas | Agendamento, integração de envio, registro de execução e tratamento de erros |
| 3 | Linha do tempo de decisões | Contextualizar variações e registrar estratégias | Vincular marcos, campanhas e relatórios |
| 3 | Visão administrativa de vários clientes | Acompanhar orçamento, metas e falhas sem abrir cliente por cliente | Agregação compatível, permissões e indicadores comparáveis |
| 3 | Novas integrações, fórmulas e IA | Cobrir conteúdo orgânico, site, CRM e vendas | Dados confiáveis, regras de cálculo e autorização das integrações |

## Critérios para implementar corretamente

1. Nomear a métrica com precisão: CTR de todos os cliques e CTR de link não são equivalentes. Comparar plataformas requer mesma conta, período, fuso, escopo, evento e atribuição.
2. Consultar alcance no escopo exato sempre que possível. Quando houver estimativa entre contas ou entidades, identificar a estimativa e sua regra. Uma apresentação atraente não torna a deduplicação exata.
3. Não somar resultados de objetivos diferentes como se fossem uma única conversão. Oferecer separação por tipo.
4. Evitar duplicar eventos equivalentes ou sobrepostos. A tabela do Reportei apresenta ações com nomes próximos; o mapeamento deve ser validado antes de construir totais.
5. Funis devem relacionar etapas compatíveis, com taxas calculadas a partir de definições consistentes. Investimento monetário não deve ser apresentado como contagem de pessoas.
6. Indicadores desconhecidos não devem virar zero. Distinguir zero, ausência de dados, incompatibilidade e estimativa com explicações discretas.
7. Variações contra base zero ou muito pequena precisam de contexto. Percentuais enormes não comprovam melhoria de estratégia por si só.
8. Recursos de publicação e entrega devem preservar o documento congelado. A atualização do dashboard não deve modificar um relatório já gerado.
9. Comentários, imagens, gráficos, métricas e filtros aprovados precisam aparecer de forma consistente nos documentos vertical e horizontal.
10. Benchmarks setoriais exigem uma fonte e metodologia verificadas. Como primeira alternativa, usar comparação histórica do próprio cliente.

## Situação do iGrow observada no projeto

Já existem escopo por entidades, métricas selecionáveis, geração vertical/horizontal e gerenciamento de relatórios salvos. Essas partes devem ser aprimoradas, sem reconstruir o fluxo.

Templates, agendamentos e entregas aparecem atualmente como próxima etapa e indisponíveis na interface. Há tipos de tabelas para modelos e versões, mas isso não comprova um fluxo funcional de modelos.

O cliente Meta já declara consulta de criativos e thumbnail_url. Isso oferece um ponto de partida para miniaturas, mas é necessário confirmar a associação, persistência, permissões e uso no dashboard/PDF antes de prometer disponibilidade.

## Primeiro conjunto recomendado

Começar por blocos visuais por conta, miniaturas de anúncios, comentários do administrador e composição consistente entre dashboard e PDF. Em seguida, modelos reutilizáveis e detalhamentos de público/posicionamento. Metas e automação vêm depois dessa base.

Aceite do primeiro conjunto: filtros respeitados em todos os blocos; indicadores fixos preservados; identificação clara de conta e resultado; miniaturas com alternativa quando faltarem; comentários salvos; relatório congelado com a mesma configuração; nenhuma tabela cortada; publicação continua controlada pelo administrador.

## Complemento: AdDash e os 12 prints enviados

Análise adicional em 02/10/2026. Navegação autenticada em uma aba separada; a aba original foi preservada. Foram examinados Home, Clientes, Templates e Envios, prévia de template e histórico, comparativo de lojas (Google e Meta) e Integrações. Não houve conexão, desconexão, envio, reenvio, ativação de template ou alteração de cadastro. O onboarding foi analisado pelos prints enviados, sem reiniciar a configuração concluída da conta.

### O que o AdDash acrescenta

- Onboarding com progresso visível: Perfil, Conexões, WhatsApp, Cliente e Relatório. Os prints mostram opção de pular e uma explicação de que configurações adicionais podem ser feitas depois.
- Primeiro cliente com formulário reduzido: nome e conta Meta; metas e monitoramento são deixados para a edição posterior.
- Primeiro relatório com modelos agrupados por frequência e finalidade e uma prévia semelhante à mensagem no WhatsApp. Os exemplos da prévia não devem ser interpretados como métricas reais do cliente.
- Templates e Envios mostra calendário mensal, horário de referência, estados Aguardando envio, Enviando, Enviado, Falhou e Pulado, e explicação de cada estado.
- A prévia do template distingue ativo/inativo, lista clientes e oferece histórico com filtros de período e estado.
- A conta de teste tem um template inativo e um aviso explícito de cliente sem número de WhatsApp. A conexão do canal, por si só, não comprova que o destinatário está pronto para receber.
- O comparativo Meta organiza métricas atuais e anteriores por conta e informa a atualização dos dados. A aba Google apresentou erro de carregamento; não foi possível validar seu comparativo.
- A Home concentra gasto, orçamento, saldo e conexões. Orçamento planejado e saldo da plataforma aparecem como conceitos distintos e precisam ser explicitamente nomeados no iGrow.
- O menu apresenta Kanban, briefings e outras ferramentas; não foram estudadas profundamente. Itens de Instagram aparecem como Em breve e Calltrack como contratação adicional, não como funções validadas.

### Leitura dos prints

- 184403 e 184244: modelo pronto, prévia imediata, progresso e poucos campos ajudam o usuário a chegar ao primeiro resultado.
- 183847: login Meta integrado evita pedir ao usuário que copie credenciais ou tokens manualmente. O print não autoriza conceder novos acessos.
- 180153 e 174706: lista de contas com pesquisa, identificação e contagem de seleção é importante quando há várias contas ou nomes parecidos.
- 175308: separar contas já conectadas do catálogo de integrações facilita entender o estado atual.
- 175338: instruções antes da janela de autorização ajudam a prevenir conexão incompleta. No iGrow, orientar sobre a conta correta e o acesso necessário, sem instruir indiscriminadamente a autorizar todos os ativos atuais e futuros.
- 175435, 174622, 174601 e 174352: distinguir autorização da plataforma, ativos autorizados e contas vinculadas ao cliente. Um login concluído não significa que o cliente já tem dados disponíveis.
- 180430: a divulgação de integração com IA é um recurso opcional. Deixar essa descoberta para depois do primeiro resultado, evitando interromper o fluxo com múltiplos modais.

### Onboarding proposto para o iGrow

1. Seu espaço de trabalho: nome exibido nos relatórios e tipo de atuação. Logo e demais informações podem ser completados depois. Usar termo neutro em toda a interface.
2. Conectar uma plataforma: explicação breve, autorização oficial e diagnóstico de acesso. Na primeira versão, oferecer apenas integrações funcionais; catálogo futuro separado.
3. Seu primeiro cliente: nome e seleção de uma ou mais contas com pesquisa, plataforma e identificação suficiente para distinguir duplicadas.
4. Preparar a análise: abrir a Visão geral, carregar dados reais automaticamente e permitir escolher objetivo/modelo e período. Preservar os seis indicadores fixos e o escopo da aba Campanhas. Informar progresso, falhas acionáveis e conclusão da atualização.
5. Primeiro relatório: gerar na Visão geral, escolher vertical ou horizontal, baixar e salvar como rascunho quando gerado pelo administrador. Mostrar onde gerenciar/publicar e esclarecer que publicar libera o documento ao cliente.

WhatsApp, convite ao cliente, publicação e agendamento são próximos passos opcionais após o primeiro relatório. WhatsApp não bloqueia o uso do dashboard ou do PDF e nenhuma mensagem é enviada automaticamente só por concluir o onboarding.

### Comportamentos necessários

- Salvar progresso e permitir voltar, pular e retomar sem perder o cadastro ou repetir autorizações.
- Reconhecer usuários que já possuem espaço, integração ou cliente: mostrar somente pendências e não forçar o assistente completo.
- Oferecer checklist discreto no dashboard; não reabrir automaticamente uma sequência de modais a cada acesso.
- Exibir estados reais: autorizado, contas encontradas, contas vinculadas, dados em atualização, pronto ou falha com ação de recuperação.
- Não gerar clientes duplicados ao retomar uma etapa nem repetir relatório automaticamente após um erro de interface.
- Prévia com dados de exemplo deve ser identificada como exemplo. Prévia real deve mostrar período, contas e atualização.
- Separar quatro estados: integração conectada, destinatário configurado, automação ativa e envio confirmado. Não chamar um agendamento de enviado.
- Não exigir logo, endereço fiscal, WhatsApp ou todas as configurações de metas antes do primeiro resultado.
- Explicar permissões em linguagem simples e pedir apenas o acesso necessário ao recurso disponível.
- O assistente do administrador não se aplica à conta do cliente final; para ela, oferecer orientação curta para consultar dados e relatórios publicados.

### Ajuste das prioridades da proposta

Adicionar onboarding como primeira prioridade, junto com os blocos visuais e a consistência dashboard/PDF. Pode ser entregue inicialmente sobre os recursos já funcionais, com configuração padrão, sem depender de construir modelos avançados ou envio automático.

Sequência sugerida: onboarding até primeiro dashboard e PDF; blocos por conta, criativos e comentários; modelos reutilizáveis e detalhamentos; metas e automação; calendário e histórico de entregas; novas integrações e recursos administrativos amplos.

Aceite do onboarding: um usuário novo consegue configurar espaço, conectar Meta, vincular contas a um cliente, visualizar dados e gerar um PDF; pode interromper e retomar sem duplicação; erros indicam o que corrigir; geração ocorre exclusivamente na Visão geral; rascunho não fica visível ao cliente até publicação; nenhum envio é ativado implicitamente.

## Implementação iniciada

Entrega inicial: checklist administrativo com progresso por cliente calculado a partir das contas vinculadas, atualizações concluídas e versões de relatório; retomada e seleção guardadas no navegador; correção dos estados da operação; comentários do administrador preservados no snapshot e nos dois formatos de PDF.

Implementados também: modelos iniciais de análise (mensagens, leads, vendas e reconhecimento), reordenação dos indicadores opcionais preservada por cliente neste navegador e usada no PDF, e miniaturas de anúncios retornadas pela Meta na árvore de campanhas. Os modelos não alteram filtros nem comentários e não inventam indicadores ausentes. Miniaturas dependem da resposta atual da Meta e ainda não são incorporadas ao arquivo PDF congelado.

Ainda pendentes: wizard de cadastro mínimo; login OAuth oficial Meta; modelos compartilhados/versionados; composição completa de blocos; miniaturas no PDF; detalhamentos de público/posicionamento; metas/alertas; agenda e entrega; visão consolidada e integrações adicionais. Estes recursos não devem ser apresentados como disponíveis até implementação e validação.

Dependências externas: aplicativo Meta configurado para OAuth e permissões aprovadas; configuração de provedor de entrega e credenciais para WhatsApp; serviço de execução de agendamentos. O assistente inicial usa os fluxos reais existentes, sem simular essas dependências.

O botão Apresentar análise abre o dashboard em tela cheia, conservando os filtros e permitindo encerrar por botão ou Esc. Este modo usa a análise ao vivo; o PDF horizontal continua sendo o documento congelado.
