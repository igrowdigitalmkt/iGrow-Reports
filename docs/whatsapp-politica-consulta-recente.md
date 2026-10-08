# WhatsApp do iGrow — integração de apoio

O número vinculado por QR Code é uma consulta operacional, não um arquivo permanente.

- Desconectar: remove a sessão do servidor Evolution e elimina automaticamente
  as conversas e mensagens daquela sessão armazenadas no iGrow.
- Não existe botão independente para apagar o histórico.
- Desconexão remota definitiva: status de revogação 401/403 vindo do WhatsApp
  bloqueia novas mensagens e inicia uma limpeza gradual.
- Instância inexistente (404) também é tratada como sessão encerrada.
- Oscilações temporárias de internet não destroem o histórico.
- Nova vinculação: não aceita registros de outro número/sessão.
- Em uma **nova vinculação por QR/código**, o iGrow importa o histórico recente
  de conversas privadas que o WhatsApp disponibilizar na sincronização inicial,
  limitado a 7 dias, até 50 mensagens por conversa e no máximo 300 por bloco
  recebido da Evolution. Mensagens de grupos anteriores à vinculação não entram.
- A janela de importação fica aberta por 30 minutos após a nova vinculação;
  cada sessão tem assinatura exclusiva, impedindo reutilização de histórico
  de uma vinculação anterior. A importação não marca conversas como não lidas.
- A Evolution não mantém cópia persistente das mensagens. Ativar a função em
  uma sessão já conectada não recupera retroativamente a sincronização inicial:
  nesse caso, o usuário precisa desvincular e vincular novamente. O WhatsApp
  pode disponibilizar um histórico parcial; não há garantia de sete dias completos.
- Janela operacional do QR: 7 dias; até 50 mensagens por conversa na tela.
  Retenção diária elimina mensagens antigas e conversas inativas em lotes
  limitados; números de API oficial não são afetados.
- Fotos, vídeos e áudio: carga apenas mediante clique, com visualização
  temporária de até dois minutos. Arquivos salvos pelo usuário não são
  excluídos automaticamente do seu computador.
- Nunca apagar nem alterar os dados da conta WhatsApp no celular.
