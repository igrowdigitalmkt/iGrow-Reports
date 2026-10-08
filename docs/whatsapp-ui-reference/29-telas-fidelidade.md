# WhatsApp Web — matriz de fidelidade visual (29 referências recebidas em 08/10/2026)

O padrão de comparação é a captura do WhatsApp Web **fornecida pelo usuário**,
em modo escuro a 1649×928. A exigência é reproduzir coordenadas, margens, fontes,
cores, forma, feedback visual, foco, hover, seleção e redimensionamento, e não
apenas utilizar componentes parecidos. Cada ação exibida deve funcionar com
dados reais e respeitar as permissões do iGrow.

## Referências (estado da tela e resultado atual)

| Nº | Tela / comportamento observado | Código e estado |
|---|---|---|
| 01 | Sem chat aberto: rail, lista, painel inicial e atalhos | Rail e lista calibrados; painel inicial específico pendente |
| 02 | Chat aberto, mensagem, reação, balões e campo de texto | Paleta e geometria; citações integradas |
| 03 | Menu principal ⋮, opções e seções | Somente opções reais expostas; demais pendentes |
| 04 | Selecionar conversas (0 selecionadas) | Cabeçalho/checkboxes funcionais |
| 05 | Selecionar 3 conversas e menu de lote | Marcar como lida e arquivar, sem eliminar chats |
| 06 | Criar nova lista: nome/cor, incluir pessoas | Pendente: sem API de rótulos QR/Web garantida |
| 07 | Modal de participantes de lista | Pendente por dependência de listas |
| 08 | Criar lista com sugestões | Pendente por dependência de listas |
| 09 | Gerenciar listas; editar, cor, apagar | Pendente |
| 10 | Gerenciar listas; reordenar | Pendente |
| 11 | Filtro por listas no cabeçalho | Pendente |
| 12 | Menu do chat na lista; arquivar, fixar, favoritos | Arquivar/favoritos reais; outras opções dependem de API |
| 13 | Indicadores de múltiplas listas no contato/chat | Pendente |
| 14 | Nova conversa e busca | Novos contatos no iGrow e conversas existentes; telefone real |
| 15 | Novo contato, formulário e sincronização com celular | Pendente: sem garantia de sincronização |
| 16 | Discador com teclado 3×4 | Implementado, número leva a rascunho real |
| 17 | Responder: bloco citado acima do compositor | Calibrado e identificação corrigida |
| 18 | Menu anexos com muitas opções | Arquivos e mídias efetivos; opções sem API omitidas |
| 19 | Emoji/GIF/figurinhas no compositor | Emojis funcionais; GIF e figurinhas a avaliar |
| 20 | Dados do contato; perfil, atalhos e mídias | Painel reduz largura do chat; atalhos reais |
| 21 | Dados do contato; grupos em comum, privacidade, ações | Mídias e grupos limitados a dados disponíveis |
| 22 | Menu de rótulos do contato; seleção múltipla | Pendente por dependência de listas |
| 23 | Menu do cabeçalho da conversa | Somente ações reais disponíveis |
| 24 | Busca dentro de conversa e resultados no painel | Implementado; chat contrai sem sobreposição |
| 25 | Contexto de mensagem e barra de reações rápidas | Funcional; refinamento visual iterativo |
| 26 | Seletor completo de reações | Funcional com seleção de emoji |
| 27 | Selecionar mensagens com destaque e barra inferior | Funcional; exclusão restrita a enviadas |
| 28 | Encaminhamento: seleção de destinatários no modal | Um destinatário real por vez; multisseleção a avaliar |
| 29 | Modal apagar mensagens enviadas | Implementado com proteção de origem e janela QR |

### Critérios de segurança inegociáveis

- Nunca apagar conversas inteiras.
- Nunca apagar mensagens recebidas.
- A opção de apagar uma mensagem enviada somente no iGrow não pode alegar
  sincronização com o celular; não exibir "apagar no WhatsApp" sem confirmação real.
- Apagar para todos: somente enviados elegíveis em uma sessão QR ativa, dentro
  do prazo da plataforma; Cloud API não suporta função equivalente.
- Evitar ações de chamada, catálogo, cobrança, novo contato no telefone e listas
  se não houver backend verificado que execute a operação solicitada.
- A visualização do QR é apoio à gestão de relatórios; manter a retenção de até
  sete dias, isolamento por agência e número, e limpeza ao desconectar.

### Validação

- E2E isolado: `tests/e2e/whatsapp-fidelity.spec.ts` usa a demonstração explícita.
- Compilação, lint, testes unitários, segurança RLS e build por GitHub Actions.
- A equivalência de pixels **ainda não está certificada** em todas as telas:
  depende de screenshots atuais do novo frontend na mesma resolução e comparação.
- Teste real de sincronização deve ser realizado em conversa autorizada, sem
  executar envios/remoções em contatos reais sem instrução específica.

Registro inicial: branch `feat/whatsapp-referencia-29-telas`, PR #5.
