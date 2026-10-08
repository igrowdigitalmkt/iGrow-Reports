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
  de conversas privadas **e grupos** que o WhatsApp disponibilizar na
  sincronização inicial, limitado a 7 dias, até 50 mensagens por conversa e
  no máximo 300 mensagens por lote de sincronização da Evolution.
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

## Recursos de consulta e organização

- O painel de dados do contato ou do grupo consulta apenas as informações e
  mídias já disponíveis ao número vinculado. A lista de mídias exibe metadados
  (até 30 recentes); o arquivo só é baixado quando aberto.
- O seletor de nova conversa pesquisa conversas recentes e destinatários do
  iGrow, além de permitir digitar um telefone. Não copia nem edita a agenda
  particular do celular.
- Ações de leitura em várias conversas são processadas gradualmente (no máximo
  duas chamadas simultâneas) e falhas não são marcadas como sucesso.
- Mensagens favoritas são **marcadores particulares de cada usuário no iGrow**,
  não favoritos sincronizados com o WhatsApp do telefone. São removidos
  automaticamente quando a respectiva mensagem sai do histórico.
- Criar comunidades, grupos e editar contatos do telefone não fazem parte do
  módulo de apoio.

## Reações às mensagens

- Reações de WhatsApp QR e números da API oficial são aplicadas como estado da
  **mensagem original**, sem nova linha de conversa, notificação de não lida ou
  alteração da prévia da conversa.
- Vários participantes podem reagir com o mesmo emoji; exibe contagem agregada.
  Uma pessoa pode substituir ou remover sua reação, inclusive quando a alteração
  chega fora de ordem.
- Apenas mensagens ainda disponíveis no histórico operacional recebem reações.
  Dados de reações são removidos automaticamente quando a mensagem original
  é excluída pelo limite de retenção ou desvinculação.
- Reações que foram importadas anteriormente sem referência à mensagem de
  destino não podem ser reassociadas com segurança; não se tenta adivinhar.
- A tela exibe as reações sincronizadas. Enviar uma reação pelo iGrow não está
  incluído nesta etapa de correção.
