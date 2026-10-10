# Etiquetas nativas e emojis — 10/10/2026

O canal QR usa as etiquetas do número conectado, com IDs, nomes, cores e vínculos nativos. Consultas atualizam a interface a cada 15 segundos; criação, edição, exclusão e associação enviam operações de app-state ao WhatsApp. Os filtros internos Não lidas, Favoritos e Grupos não aparecem como etiquetas editáveis. O canal Cloud mantém seu comportamento separado.

Foram removidas, com autorização do usuário, as duas listas locais existentes no escopo da conta iGrow Digital.

O serviço Evolution 2.3.7 precisava converter `AppStateSyncKeyData` com `fromObject`, em vez de `create`: a serialização protobuf havia gravado `keyData` em base64. A conversão restaura os bytes sem substituir chaves ou refazer o pareamento. A imagem `igrow/evolution-api:2.3.7-labels-1` inclui a correção e o bridge autenticado. O snapshot inicial reconstrói apenas a projeção de etiquetas e exige versões de app-state válidas; falhas não são apresentadas como lista vazia ou sucesso.

O número conectado retornou Novo cliente, Lead, Novo pedido e Pagamento pendente. Foram testadas criação, edição com acentos, associação, remoção e exclusão de uma etiqueta temporária. A etiqueta e seu vínculo com a conversa foram recuperados diretamente do WhatsApp após reiniciar o serviço, confirmando persistência externa; ambos foram removidos após o teste.

Os seletores, mensagens e reações usam os PNGs originais do WhatsApp Web. Foram incluídos 260 arquivos locais, com procedência registrada no diretório público; sequências adicionais consultam o mesmo endpoint oficial, com fallback Unicode quando indisponível. O conteúdo enviado continua Unicode. O campo de digitação ainda usa a renderização de texto do sistema.

Validação: 804 testes em 118 arquivos, análise ESLint dos arquivos alterados, build Next e verificações visuais de reações e listas em seis combinações de tamanho/zoom. Os testes de rota cobrem isolamento por agência, permissão de escrita, cores nativas e falha de sincronização.
