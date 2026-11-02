# Desenho: canal WhatsApp em Leads (etapa 3)

Estado: **proposta para aprovação** (2/11/2026; atualizada após a decisão de usar número por QR Code). Nada deste documento está implementado. Distingue sempre: o que já existe no código, o que é proposta e o que depende de decisão do responsável.

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

## 3.1 Decisão (2/11/2026): números dos clientes por QR Code

O responsável informou que os clientes usam o WhatsApp no celular (QR Code). Consequências no desenho:

- **A conexão por QR atual é uma só por agência** ("Seu WhatsApp", instância `igrow-<agência>`) e toda a caixa, o envio de relatórios e os alertas dependem dela (cerca de 30 pontos do código usam o nome dessa instância). **Não** vamos transformar a caixa em multi-número: o risco para o que já funciona é alto.
- **Sessão de captação por cliente (escolhida):** uma instância Evolution própria para cada número de cliente (`igrow-lead-<id>`), usada **somente para detectar contatos novos**. Webhook próprio (`/api/webhooks/evolution/leads`) que aceita só mensagens recebidas, cria o lead e **não grava a conversa na caixa**. O cliente continua atendendo no próprio celular; a plataforma guarda só telefone, nome do perfil e a primeira mensagem (curta).
- **Atribuição de anúncio é incerta no QR.** Padrão passa a ser **todo contato novo vira lead** (com a origem marcada como "não confirmada" e, quando o aparelho informar o anúncio, preenchida). A opção "só anúncio" fica para número oficial.
- **"Abrir conversa"** abre o contato no WhatsApp (link do telefone), já que a conversa mora no celular do cliente.
- Pontos de atenção: número por QR é não oficial (risco de bloqueio, nunca para disparos em massa); cada sessão consome recursos da VPS do Evolution; se o celular do cliente ficar offline por muito tempo, a sessão cai e a tela mostra "reconectar".

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

1. **3a. Sessão de captação por cliente:** tabela de sessões (cliente, instância, estado, modo, números ignorados), tela de conexão por QR/código dentro de Leads › Configurações › Canais, webhook próprio com validação por token. Não cria leads ainda. Migração aditiva.
2. **3b. Captação:** mensagem recebida de contato novo → lead no canal WhatsApp (regras de grupo, ignorados, janela de 30 dias e deduplicação por telefone). "Adicionar lead" manual.
3. **3c. Telas do canal:** linha com mensagem inicial, selo "origem não confirmada", "Abrir conversa" e estado da sessão.
4. **3d. Anúncio, quando o aparelho informar** (`externalAdReply`), com nomes resolvidos pela Graph API; número oficial com `referral` fica como evolução.
5. **3e. Alertas e desempenho por canal.**

Cada etapa é publicada e validada isoladamente. A homologação real depende de um celular de cliente conectado.

## 9. Decisões

1. **Decidido:** números dos clientes por **QR Code**.
2. **Adotado como padrão (revogável):** todo contato novo vira lead, com origem "não confirmada" quando não houver anúncio; grupos e números ignorados nunca viram lead.
3. **Adotado:** um número por cliente nesta primeira versão.
4. **Adotado:** quem vê Leads vê telefone, nome e a primeira mensagem (como no formulário).

## 10. Riscos

- Número por QR é não oficial; a Meta pode bloquear. Não usar para disparos em massa.
- `referral` só vem em conversas iniciadas por anúncio Click-to-WhatsApp e só na primeira mensagem; se a mensagem não for gravada nesse momento, o dado se perde.
- Duplicidade entre canais (mesma pessoa no formulário e no WhatsApp) exige a regra de deduplicação por telefone; falhar nela infla o número de leads.
- Conversas anteriores à instalação não entram automaticamente; só as novas.
