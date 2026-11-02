# Desenho: canal WhatsApp em Leads (etapa 3)

Estado: **proposta para aprovação** (2/11/2026). Nada deste documento está implementado. Distingue sempre: o que já existe no código, o que é proposta e o que depende de decisão do responsável.

## 1. Objetivo

Um cliente que recebe conversas de WhatsApp dos anúncios (Click-to-WhatsApp) precisa vê-las em **Leads**, no mesmo funil (Novo → Contatado → Agendado → Fechado/Perdido), com a origem do anúncio e o custo, **sem** transformar o menu num espelho da caixa de mensagens. Regra central: **uma conversa só vira lead quando há um critério claro**.

## 2. O que já existe (confirmado no código)

- `leads.channel` aceita `form`, `whatsapp` e `instagram`; o filtro por canal da etapa 2 já usa isso.
- Caixa do WhatsApp da agência: `whatsapp_conversations` e `whatsapp_messages`, por número (`qr` = "Seu WhatsApp" via Evolution, e números oficiais da Cloud API). A conversa tem `client_id` opcional.
- Webhook oficial `/api/webhooks/meta/whatsapp` e webhook Evolution `/api/webhooks/evolution` já gravam mensagens recebidas na caixa.
- Alertas de lead novo por WhatsApp (envio pela conexão QR da agência).
- **Não existe:** vínculo número → cliente para leads, leitura do dado do anúncio (referral) nas mensagens, regra de qualificação, tela de configuração do canal.

## 3. Dois tipos de número

| | Número oficial (Cloud API / WABA) | Número por QR Code (Evolution) |
|---|---|---|
| Origem do anúncio | Chega no webhook (`referral`: id do anúncio, link, título, `ctwa_clid`) | Só quando o aparelho informa (`externalAdReply`); não é garantido |
| Estabilidade e regras da Meta | Oficial | Não oficial: risco de bloqueio do número |
| Uso típico | Cliente que migrou o número para a API | Cliente que usa o WhatsApp Business no celular |
| Situação hoje | Conexão por número existe | QR é único por agência |

Recomendação: **atribuição de anúncio só com número oficial**. Com QR, o lead entra por regra manual ou "todo contato novo", sempre marcado como "origem não confirmada".

## 4. Quando uma conversa vira lead

1. **Automática por anúncio** (padrão): primeira mensagem recebida de um contato novo que traz `referral` de anúncio.
2. **Manual**: botão "Virar lead" na conversa da caixa e "Adicionar lead" em Leads.
3. **Todo contato novo** (opcional, desligado por padrão, por cliente): útil para quem não roda Click-to-WhatsApp.

Exclusões e proteções: grupos nunca; números ignorados (equipe, fornecedores, o próprio número); janela de reentrada de **30 dias** (nova conversa do mesmo telefone dentro da janela atualiza o lead existente em vez de criar outro); deduplicação pelo telefone com a chave já usada (`DDD + últimos 8`), inclusive contra leads de formulário (mesma pessoa, canais diferentes).

## 5. Modelo de dados (aditivo, sem apagar nada)

- **Fonte do canal.** Hoje toda fonte é uma Página do Facebook (`lead_pages`). Proposta: acrescentar `kind` (`facebook` | `whatsapp`), `whatsapp_connection_id` e `channel_key`, tornando `fb_page_id` opcional para `whatsapp`, com restrições para manter a integridade. Alternativa mais isolada: tabela nova `lead_whatsapp_sources (agency_id, client_id, connection ou 'qr', qualify_mode, ignore_numbers, active)` e `leads.lead_page_id` passa a aceitar nulo. A primeira opção preserva todas as consultas atuais; a segunda isola melhor o risco. **Decisão técnica a confirmar na implementação.**
- **Lead.** Novas colunas anuláveis em `leads`: `conversation_id` (liga à caixa), `first_message` (até 300 caracteres) e `source_label`. Anúncio, conjunto e campanha reaproveitam as colunas que já existem.
- **Nomes do anúncio.** O webhook traz só o id do anúncio. Os nomes de anúncio, conjunto e campanha são lidos depois na Graph API com o acesso da conta empresarial (permissão de anúncios já concedida) e gravados no lead.
- **Privacidade.** Só o telefone, o nome do perfil e a primeira mensagem (curta) vão para o lead. O restante da conversa fica na caixa do WhatsApp, com a retenção dela (7 dias no QR). O lead persiste.

## 6. Telas

- **Leads › Configurações › Canais de leads**: o cartão WhatsApp deixa de ser "Em breve" e passa a ter: número usado (oficial ou QR), modo de qualificação, números ignorados, estado ("aguardando a primeira mensagem", "recebendo").
- **Leads › lista**: filtro por canal (já existe); no canal WhatsApp a linha mostra a mensagem inicial e a origem do anúncio, com "Abrir conversa".
- **Detalhe**: notas e funil iguais aos de formulário; "Abrir conversa" leva à caixa do WhatsApp (quem não tem a permissão da caixa não vê o conteúdo).
- **Alertas**: texto do aviso identifica o canal ("Novo lead pelo WhatsApp").
- **Desempenho**: custo por conversa/lead do canal quando houver anúncio.

## 7. Permissões

A caixa do WhatsApp tem módulo próprio de permissão (`whatsapp`). Leads é outro menu. Decisão proposta: quem vê Leads vê o telefone, o nome e a primeira mensagem (como no formulário); o histórico completo continua exigindo o módulo WhatsApp. Links compartilhados e portal do cliente mostram só o lead, nunca a caixa.

## 8. Etapas de implementação

1. **3a. Vínculo e configuração:** número ↔ cliente e tela do canal (sem criar leads). Migração aditiva.
2. **3b. Qualificação manual:** "Virar lead" na caixa e em Leads; o lead aparece no canal WhatsApp.
3. **3c. Automática por anúncio (número oficial):** ler `referral` no webhook, criar o lead, resolver os nomes na Graph API, deduplicar.
4. **3d. QR e "todo contato novo":** ler `externalAdReply` quando existir; modo opcional.
5. **3e. Alertas e desempenho por canal.**

Cada etapa é publicada e validada isoladamente. A homologação com mensagens reais depende de um número oficial com anúncio Click-to-WhatsApp ativo.

## 9. Decisões que dependem do responsável

1. Os clientes usarão **número oficial (API)** ou **WhatsApp Business no celular (QR)**? Define o que é atribuível.
2. Padrão de qualificação: **só anúncio** (recomendado) ou **todo contato novo**?
3. Um número por cliente é suficiente (recomendado), ou um cliente pode ter mais de um número?
4. Quem só tem acesso a Leads pode ver a **primeira mensagem** do contato?

## 10. Riscos

- Número por QR é não oficial; a Meta pode bloquear. Não usar para disparos em massa.
- `referral` só vem em conversas iniciadas por anúncio Click-to-WhatsApp e só na primeira mensagem; se a mensagem não for gravada nesse momento, o dado se perde.
- Duplicidade entre canais (mesma pessoa no formulário e no WhatsApp) exige a regra de deduplicação por telefone; falhar nela infla o número de leads.
- Conversas anteriores à instalação não entram automaticamente; só as novas.
