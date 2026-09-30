# Métricas

O motor de métricas de tráfego ainda não foi implementado. Os números em `/demo` são fixtures fictícias para avaliar a apresentação. Eles não foram coletados da Meta, não validam fórmulas e não comprovam geração ou entrega de relatórios.

## Dashboard

O dashboard autenticado deve apresentar somente dados disponíveis para a agência verificada. Ausência de histórico é “Sem dados”; falha de consulta não deve ser convertida em zero ou em demonstração.

| Indicador previsto | Definição | Cuidados |
| --- | --- | --- |
| Clientes ativos | Clientes não arquivados da agência | Contagem na data de referência |
| Relatórios gerados | Versões concluídas no intervalo | Separar de mensagens enviadas |
| Próximos envios | Ocorrências ou entregas previstas | Informar horizonte e timezone |
| Taxa de entrega | Entregas confirmadas ÷ envios aceitos × 100 | Mesma coorte; sem base resulta em “Sem dados” |
| Leitura | Mensagens com confirmação recebida | Ausência de confirmação não prova ausência de leitura |
| Acessos | Links com evento qualificado de navegador | Excluir previews e robôs conforme regra versionada |

Um relatório enviado para três destinatários gera três entregas. A leitura da mensagem e o acesso ao link não têm uma ordem universal. A interface não deve representar essas contagens como um funil obrigatório de relatórios.

## Contrato para o motor futuro

As fórmulas abaixo são requisitos aprovados, ainda sem cálculo de produção. Numerador e denominador precisam usar o mesmo período, conta, moeda, fuso e escopo.

| Métrica | Fórmula ou origem |
| --- | --- |
| Investimento | Gasto retornado para o escopo |
| Impressões | Impressões retornadas para o escopo |
| Alcance | Valor retornado no nível consultado; não aditivo |
| CTR de link | Cliques de link ÷ impressões × 100 |
| CPC de link | Investimento ÷ cliques de link |
| CPM | Investimento ÷ impressões × 1.000 |
| CPL | Investimento ÷ leads mapeados |
| Custo por conversa | Investimento ÷ conversas mapeadas |
| CPA | Investimento ÷ resultado principal configurado |
| Receita atribuída | Valor do evento de compra configurado; não é faturamento confirmado |
| ROAS | Receita atribuída ÷ investimento |
| Variação percentual | (Atual − anterior) ÷ anterior × 100 |

Divisão por zero retorna indisponível. Anterior igual a zero produz “Sem base de comparação”. Zero, dado ausente, não aplicável e falha de coleta precisam ser estados distintos. Índices agregados são recalculados pelos totais; médias simples de CPC, CPL, CTR ou ROAS não são válidas.

O mapeamento de leads, conversas e compras depende de validação da versão da API e do resultado escolhido pelo cliente. Não somar aliases do mesmo evento, resultados incompatíveis ou alcance entre dias e campanhas. Na V1, bloquear consolidação de moedas ou fusos diferentes, sem conversão automática nem deduplicação inventada de alcance.

Valores monetários serão armazenados como `numeric` e calculados com aritmética decimal. A precisão deve ser preservada até a exibição. Cada definição e mapeamento precisa de versão, origem, unidade, disponibilidade e regra de agregação. Cada snapshot guardará conta, período, moeda, timezone, atribuição, API e versão do motor.

Os testes futuros precisam cobrir ausência de dados, zero, precisão, aliases, bases comparáveis, índices por totais e escopos incompatíveis, conforme as seções K e L do [planejamento](PLANEJAMENTO_V1.md).
