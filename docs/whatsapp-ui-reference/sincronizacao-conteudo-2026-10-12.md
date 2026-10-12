# Sincronização de nomes e mensagens — 12/10/2026

## Problemas confirmados

- O parser descartava o corpo de `templateMessage`, apresentando apenas “Mensagem modelo”.
- O conector descartava nomes verificados e de perfil no histórico e nos eventos de contatos. A aplicação aceitava apenas nomes de agenda em CONTACTS_UPSERT.
- A integração não retinha mensagens brutas. A tentativa de recuperação pelo celular não retornou as mensagens; essa ponte experimental foi retirada da imagem publicada.
- Uma repetição nativa com conteúdo completo não preenchia um registro antigo sem corpo, pois o registro por ID era tratado como duplicado.

## Correções publicadas

- Preservar textos comerciais hidratados, títulos, rodapés, mensagens interativas e cartões com botões. Mensagens marcadas como restritas ao dispositivo principal mantêm o aviso de privacidade, sem expor códigos.
- Preservar os campos nativos de nomes salvos, comerciais e de perfil nos eventos assinados. CONTACTS_UPSERT e CONTACTS_UPDATE estão habilitados com a mesma URL, assinatura e eventos anteriores.
- Nomes salvos mantêm prioridade; nomes comerciais/de perfil preenchem títulos ausentes. Atualizar apenas conversas QR existentes da agência e sessão comprovadas.
- Uma repetição nativa pode preencher apenas o corpo ausente do mesmo ID, conversa, agência e direção, com `revoked_at is null`. Não sobrescreve conteúdo existente, não altera contadores de leitura e atualiza a prévia apenas se a mensagem ainda for a mais recente.
- Rótulos comerciais são exibidos; URLs recebidas no protocolo são validadas antes de gerar links. A recuperação visual preservou os rótulos do Banco PAN, mas não forneceu destinos/ações para esses botões específicos; eles permanecem como texto.
- Imagem do conector: `igrow/evolution-api:2.3.7-native-inbox-5`, construída apenas sobre a imagem estável de listas, sem funcionalidades comerciais experimentais.

## Recuperação e validação

- Recuperação visual a partir do WhatsApp Web aberto: **25 conteúdos antes ausentes e 15 nomes**. Dados privados permaneceram fora do repositório.
- Conciliação pelo ID exato da mensagem, agência e canal QR; recusa de IDs ambíguos. Não houve junção, exclusão de conversas, mensagens apagadas ou mensagens enviadas.
- Conservado o recorte recente de sete dias já utilizado pela plataforma. Não houve importação de arquivo completo de conversas.
- Removidos horários e espaçamentos extras introduzidos pela representação DOM, somente quando o corpo correspondia à exportação visual conhecida.
- Consulta de verificação: **zero mensagens comerciais recentes sem corpo** nessa agência/canal QR. Comparação visual do nome Banco PAN, conteúdo e rótulos com a captura fornecida.
- **875 testes aprovados em 137 arquivos**, lint e TypeScript aprovados; build local e publicação Vercel aprovados.
