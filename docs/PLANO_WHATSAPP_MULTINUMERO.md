# Plano — vários números de WhatsApp e caixa de entrada

Decisões do responsável (7/10/2026):

- Cada espaço de trabalho tem **uma** conexão por QR Code e **vários** números oficiais (API, com ou sem coexistência).
- Cada agendamento escolhe **um** número de envio:
  - **QR Code**: texto livre (como hoje).
  - **Número oficial (API ou API + coexistência)**: mensagem modelo aprovada com o **PDF do período** no cabeçalho e variáveis no texto.
- Não automatizar a caixa de entrada do Meta Business Suite (Termos da Meta proíbem acesso automatizado). Atendimento manual pela caixa da Meta continua permitido.

## Etapas

1. **Vários números + escolha do número no agendamento** (esta etapa).
2. Caixa de entrada só de leitura: mensagens recebidas dos três tipos de número, aviso de "cliente respondeu".
3. Responder pela iGrow, respeitando as regras de cada tipo (QR livre; oficial com janela de 24 h, cobrança após a franquia, mensagem modelo fora da janela).
4. Extras: mídias, histórico (coexistência até 6 meses; QR só recente, sob demanda), atribuição de conversas.

## Etapa 1 — escopo

### Banco (migração `202610070010_whatsapp_numbers.sql`)

- `whatsapp_connections`: ganha `id` (nova chave primária), `label` (nome amigável) e `coexistence`; deixa de ser uma linha por espaço. `phone_number_id` continua único.
- Credencial por número: tipo de segredo `whatsapp:access_token:<phone_number_id>`; o número antigo continua lendo `whatsapp:access_token` até ser reconectado.
- `report_automations`: `sender` (`qr` | `official`, padrão `qr`) e `whatsapp_connection_id`.
- `report_deliveries`: `report_version_id` passa a aceitar vazio (envio de agendamento não tem PDF salvo); ganha `automation_run_id` e `whatsapp_connection_id`.

### Servidor

- Funções do WhatsApp oficial recebem o número (`connectionId`) em vez de assumir um só.
- Conectar (manual ou cadastro integrado) **adiciona** um número; mesmo `phone_number_id` atualiza o existente.
- Geração do PDF do período **no servidor** (mesmo layout do PDF baixado) para os agendamentos oficiais.
- Executor de agendamentos: `sender = official` → sobe o PDF, envia a mensagem modelo do número para cada destinatário autorizado (grupos não são aceitos pela API), registra em `report_deliveries` e no histórico do agendamento.

### Telas

- Integrações → WhatsApp API oficial: lista de números (nome, telefone, qualidade, mensagem modelo, validade), "Adicionar número", trocar mensagem modelo e remover por número.
- Envio manual de PDF: escolha do número quando houver mais de um.
- Agendamento: "Enviar por" (QR Code ou um número oficial). Oficial mostra a mensagem modelo usada, avisa que grupos não recebem e esconde o editor de texto livre.

### Compatibilidade

- Antes da migração, tudo continua como hoje (um número oficial, agendamentos pelo QR Code).
- Testes: banco (pgTAP), regras puras (escolha de remetente, montagem de variáveis), lint, build.

## Caixa de entrada — referência visual (pedido de 7/10/2026)

Layout, diagramação e funcionamento o mais próximos possível do **WhatsApp Desktop** (prints do responsável):

- Coluna estreita de ícones à esquerda (aqui: escolha do número — QR Code, API, API + coexistência — com contador de não lidas).
- Lista "Conversas": botão de nova conversa, busca "Pesquisar ou começar uma nova conversa", filtros em pílulas (Tudo, Não lidas, Favoritas), linhas com foto, nome, prévia (ícone de foto/documento, "Você:"), horário e bolha verde de não lidas.
- Conversa: cabeçalho com foto e nome; fundo com padrão discreto; balões recebidos (cinza) e enviados (verde) com horário e confirmações (✓, ✓✓, ✓✓ azul); separadores de dia ("Hoje", "Segunda-feira", data); documento PDF com ícone, nome e "Ver / Salvar como…"; áudio com play e onda; resposta citada.
- Campo "Digite uma mensagem" com "+" (Documento, Fotos e vídeos, Câmera, Áudio, Contato…) e emojis.
- Tema escuro e claro seguindo o tema da plataforma.

Limites: não usar logotipo, papel de parede nem figurinhas da Meta/WhatsApp (marcas e arquivos deles) — o visual é recriado. Nos números oficiais, opções que a API não oferece (Pix, Evento, figurinhas da loja) não aparecem; enquete só no QR Code.
