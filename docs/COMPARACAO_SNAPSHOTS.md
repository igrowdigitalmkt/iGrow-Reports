# Comparação de snapshots — 5 de outubro de 2026

A análise de snapshots permite selecionar o período anterior de mesma duração. O modo é opcional e não modifica a fonte do dashboard principal.

Com a comparação ativa, os indicadores só aparecem após a confirmação e conciliação dos quatro níveis de todas as contas nos dois períodos. Falta de dados em qualquer período bloqueia a análise inteira; ausência não equivale a zero. Cada período conserva sua data de coleta e sua indicação de atualização pendente.

Os controles de coleta e atualização são separados por período. O servidor deriva as datas anteriores e autoriza as contas antes de registrar solicitações. Não existe uma transação de coleta conjunta entre períodos nem uma garantia de geração comum entre os snapshots confirmados.

As diferenças usam aritmética decimal e preservam os valores originais. Percentuais calculados são exportados com seis casas decimais; a descrição visual usa duas. Uma base anterior igual a zero não produz percentual. Mudanças de moeda, fuso, atribuição conhecida, unidade, chave nativa ou regra de agregação impedem a comparação do indicador. Atribuição desconhecida nos dois períodos continua desconhecida.

CSV e JSON incluem ambos os períodos e as entidades que só existiam no anterior. O PDF apresenta as entidades atuais com seus valores anteriores e registra a quantidade de entidades exclusivas do período anterior, disponíveis nos outros formatos. As exportações exigem confirmação dos dois escopos e conservam a identificação dos snapshots.

Esta implementação não cria migrações, credenciais, agendamentos ou coletas reais. A homologação com sessão autenticada e dados reais continua necessária.
