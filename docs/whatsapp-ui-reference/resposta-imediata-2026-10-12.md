# Resposta imediata das ações

Reações recebidas ficam à esquerda; enviadas continuam à direita. Reações são atualizadas localmente antes da chamada e serializadas por mensagem, sem bloquear reações em outras mensagens. A confirmação remove a camada provisória; falhas retornam ao estado consultado. Reações de outros participantes são preservadas.

Arquivar, fixar e mudar leitura atualizam a conversa imediatamente e usam uma fila por conversa. Consultas automáticas preservam alterações pendentes. A confirmação compara o estado nativo; respostas antigas não sobrescrevem a intenção mais recente. Falhas restauram os metadados e exibem aviso.

Silenciamento fecha o diálogo e atualiza o indicador ao salvar, com confirmação em segundo plano e reversão em falha. Leitura em lote atualiza a lista antes das requisições; falhas restauram somente as conversas recusadas. Fixação de mensagens aparece antes da resposta, com reversão em falha.

Favoritos de mensagens e associação às listas já usavam atualização imediata. Copiar, responder, selecionar e abrir menus são locais. Envio usa mensagens pendentes na caixa de saída. Encaminhamento fecha o seletor e inclui cópias pendentes na caixa de saída antes de preparar mídias e enviá-las. Transferência de arquivos e exclusão de mensagens enviadas continuam dependendo da confirmação efetiva do servidor; não se declara entrega ou exclusão concluída antes dela. Seleções com mensagens recebidas permanecem rejeitadas antes de qualquer mutação.
