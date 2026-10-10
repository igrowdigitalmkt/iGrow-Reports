# Etiquetas nativas e emojis — 10/10/2026

O canal QR usa as etiquetas do número conectado, com IDs, nomes, cores e vínculos nativos. Consultas atualizam a interface a cada 15 segundos; criação, edição, exclusão e associação enviam operações de app-state ao WhatsApp. Os filtros internos Não lidas, Favoritos e Grupos não aparecem como etiquetas editáveis. O canal Cloud mantém seu comportamento separado.

A paleta segue o módulo público `WAWebLabelPillColors` do WhatsApp Web consultado nesta data: 22 índices nativos, com 20 cores disponíveis para edição e dois índices reservados. Os chips usam as cores de texto e fundo do tema escuro original, em vez da antiga paleta Android. Novo cliente usa o índice 1 e Lead o 18, como na captura.

Foram removidas, com autorização do usuário, as duas listas locais existentes no escopo da conta iGrow Digital.

O serviço Evolution 2.3.7 precisava converter `AppStateSyncKeyData` com `fromObject`, em vez de `create`: a serialização protobuf havia gravado `keyData` em base64. A conversão restaura os bytes sem substituir chaves ou refazer o pareamento. A imagem `igrow/evolution-api:2.3.7-labels-1` inclui a correção e o bridge autenticado. O snapshot inicial reconstrói apenas a projeção de etiquetas e exige versões de app-state válidas; falhas não são apresentadas como lista vazia ou sucesso.

O número conectado retornou Novo cliente, Lead, Novo pedido e Pagamento pendente. Foram testadas criação, edição com acentos, associação, remoção e exclusão de uma etiqueta temporária. A etiqueta e seu vínculo com a conversa foram recuperados diretamente do WhatsApp após reiniciar o serviço, confirmando persistência externa; ambos foram removidos após o teste.

Os seletores, mensagens, reações e o campo de digitação usam os PNGs originais do WhatsApp Web. Foram incluídos 260 arquivos locais, com procedência registrada no diretório público; sequências adicionais consultam o mesmo endpoint oficial, com fallback Unicode quando indisponível fora do editor. O conteúdo enviado continua Unicode.

O editor de mensagens e de primeira mensagem usa imagens como unidades indivisíveis. Mantém inserção pelo seletor na posição do cursor, seleção, clipboard de texto simples, Shift+Enter, envio com Enter, limite de caracteres sem cortar um emoji, composição IME e histórico de desfazer/refazer. A validação Playwright cobre quatro tamanhos de tela e confirma que a demonstração não envia requisições de alteração ao WhatsApp.

Validação: 804 testes em 118 arquivos, análise ESLint dos arquivos alterados, build Next e verificações visuais de reações e listas em seis combinações de tamanho/zoom. Os testes de rota cobrem isolamento por agência, permissão de escrita, cores nativas e falha de sincronização.
