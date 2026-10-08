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

## Ações nas mensagens do chat

- Passar o mouse sobre a mensagem revela **reagir** e **mais opções**. A lista
  contextual concentra: responder (com citação na conversa real), copiar o
  texto, favoritar/desfavoritar no iGrow, selecionar mensagens e dados da
  mensagem. A estrela isolada sobre o balão foi removida.
- Reações rápidas: 👍 ❤️ 😂 😮 😢 🙏. O botão + abre o seletor completo de
  emojis. Selecionar o emoji já usado pela própria conta o remove. A reação é
  enviada ao WhatsApp (QR Code ou Cloud API, quando a janela de envio estiver
  válida) e salva imediatamente no iGrow por ID da mensagem original.
- O selo de reação permanece no fluxo de layout **abaixo** da mensagem, sem
  sobreposição à hora ou confirmação de leitura, inclusive em telas pequenas.
  O menu flutua dentro da área visível, sem ser cortado pelo scroll.
- Ao responder, o campo de envio mostra a mensagem citada. Nesta etapa a
  citação pela plataforma funciona para respostas de **texto**. Para enviar
  arquivos ou áudio, cancele primeiro a citação.
- Seleção múltipla de mensagens permite copiar textos em conjunto e marcar
  favoritos. Dados da mensagem indicam horário, formato e o estado conhecido
  de entrega/leitura; não inventam informações ausentes do WhatsApp.
- Funções destrutivas ou de moderação (apagar para todos, denunciar, fixar em
  todos os dispositivos, encaminhar mídia) não são oferecidas sem suporte seguro
  de ponta a ponta.

## Padrão de interface — referência WhatsApp Web

- Todo o módulo de conversas (lista, mensagens, barra de composição,
  mídias, menus, informações, reações e navegação entre contas) utiliza os
  mesmos padrões visuais do WhatsApp Web como referência. Apenas a
  navegação externa de iGrow conserva a identidade do produto.
- A paleta de cores é a original do iGrow Reports (a mesma utilizada
  antes do commit 6178e98), herdada dos tokens de tema do produto:
  fundos neutros, balões de saída verdes discretos e texto com contraste.
  O WhatsApp Web serve de referência para disposição, controles,
  espaçamentos e interação, não para substituir as cores do iGrow.
- Os horários, vistos e reações nunca podem se sobrepor. As reações
  múltiplas são agrupadas numa única cápsula após o balão com contagem
  total. Emojis rápidos e menu contextual aparecem sem deslocar mensagens.
- A seta do menu deve ficar no próprio balão e o botão de emoji ao lado.
  Menus se reposicionam para caber na área visível, inclusive em telas
  pequenas, sem ficar presos ao recorte de rolagem da conversa.
- Alterações futuras devem reutilizar os mesmos tokens CSS `--wai-*`,
  espaçamentos, estados hover/focus, superfícies e componentes; não
  introduzir estilos genéricos do dashboard no módulo do WhatsApp.
