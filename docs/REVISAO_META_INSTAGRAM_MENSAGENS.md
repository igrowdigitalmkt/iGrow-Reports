# Pedido de revisão da Meta: mensagens do Instagram (instagram_manage_messages)

Objetivo: receber as mensagens diretas (Direct) das contas profissionais do Instagram dos clientes e transformá-las em leads no menu Leads. **Não** envia nada, **não** responde e **não** guarda a conversa: só o contato, a primeira mensagem e o andamento do lead.

Estado em 2/11/2026: pedido ainda **não** enviado. O código do canal Instagram Direct **não** foi construído; só depois da aprovação (ou da liberação de teste) faz sentido homologar.

## 1. Antes de pedir (conferir no app Groow Ads, ID 1403140724038533)

- App em modo **Ativo** (já está) e **verificação da empresa** concluída no Gerenciador de Negócios.
- Páginas públicas no ar: política de privacidade (`/privacidade`, já cita leads e canais) e exclusão de dados (`/exclusao-de-dados`). Informar os dois links em **Configurações do app › Básico**.
- Caso de uso do Instagram adicionado ao app (Casos de uso › Instagram › "Gerenciar mensagens e conteúdo no Instagram").
- Conta de teste: uma conta profissional do Instagram ligada a uma Página do Facebook, com você como administrador do app.

## 2. Onde pedir

developers.facebook.com › app Groow Ads › **Revisão do app › Permissões e recursos** › `instagram_manage_messages` (e `instagram_basic`, `pages_show_list`, `pages_manage_metadata` se aparecerem como pendentes) › **Solicitar acesso avançado**.

## 3. Texto sugerido (a Meta lê em inglês)

**How will your app use this permission?**

> Groow Ads is a marketing operations platform used by agencies and in-house marketing teams. Each business connects its own Facebook Page and linked Instagram professional account. When a new person sends a Direct message to that Instagram account, our app receives the message through the Instagram webhook and creates a lead in the business's "Leads" area, with the person's Instagram name, the first message text, the time received and the ad it came from (when available). The business team then follows up and records the status (new, contacted, scheduled, won, lost). We do not send messages or automated replies, we do not store the rest of the conversation, and we do not use the data for advertising or share it with third parties. A business can disconnect the account or delete a lead source at any time, which deletes all its leads. See: https://groowads.com/privacidade and https://groowads.com/exclusao-de-dados.

**Screencast** (2 a 3 minutos, sem cortes): 1) login na plataforma; 2) Integrações › conectar a conta empresarial (tela de autorização da Meta com as permissões); 3) Leads › Configurações › escolher a conta do Instagram do cliente; 4) de outro celular, enviar uma mensagem Direct para essa conta; 5) mostrar o lead aparecendo em Leads com nome e primeira mensagem; 6) abrir o lead, mudar o status e escrever uma nota; 7) excluir a fonte (com a confirmação digitada) e mostrar que os leads saem.

**Instruções para o revisor:** informar e-mail e senha de uma conta de teste da plataforma (criar uma conta de demonstração, nunca a sua), a conta de teste do Instagram e o passo a passo acima.

## 4. Depois da resposta

- **Aprovado:** me avise. Eu construo o canal (webhook do Instagram, regra de captação, tela de conexão) e você homologa com uma mensagem real.
- **Pedem ajustes:** me mande a mensagem da Meta; costuma ser o vídeo, a política de privacidade ou a descrição do uso.
- **Enquanto aguarda:** os leads de formulário e de WhatsApp (QR) continuam funcionando normalmente.
