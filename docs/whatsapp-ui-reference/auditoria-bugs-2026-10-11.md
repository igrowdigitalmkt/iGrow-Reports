# Auditoria do WhatsApp na iGrow — 11/10/2026

## Escopo e resultado

Auditoria do módulo WhatsApp integrado à plataforma: interface, temas, estados de controles, responsividade, formulários, navegação por teclado, restrições de exclusão, tarefas automáticas e dependências. A suíte automatizada cobre também outros módulos do projeto; a inspeção visual desta rodada se concentrou no WhatsApp. Não equivale a uma auditoria visual de todas as páginas da iGrow nem a uma certificação de ausência de bugs.

As correções mantêm o tema da plataforma como autoridade, a barra lateral da iGrow no desktop e o desenho original dos emojis. Os recursos descartados anteriormente pelo usuário continuam fora do escopo. Nenhuma conversa ou mensagem real foi apagada nesta auditoria. Não foi necessário enviar novas mensagens.

## Problemas corrigidos

| Nº | Prioridade | Problema e efeito | Correção e evidência |
|---|---|---|---|
| 1 | Alta | “Mudar lista” aberto mantinha fundo escuro com texto escuro no tema claro. | Estados expandidos seguem a paleta da plataforma. Reproduzido na conta conectada e verificado na demonstração e após publicação. |
| 2 | Média | Editores, menus, seleção de cores, diálogos, estados selecionados e hover ainda usavam cores fixas da referência escura. | Superfícies, textos, bordas, foco e estados interativos usam os tokens da iGrow. Inspeção dos menus/editor/diálogos nos dois temas. |
| 3 | Média | Velocidade/duração de áudio e certos controles de mensagens podiam combinar fundo escuro com texto do tema claro. | Paleta aplicada aos controles de áudio, formas de onda e respostas. Mudança revisada no código; a gravação real de dispositivos não foi acionada. |
| 4 | Média | Etiquetas da lista de conversas sempre usavam a variante escura da paleta nativa. | Uso da variante clara já existente no catálogo, preservando a identidade de cada etiqueta. |
| 5 | Média | Menu de opções de uma lista ultrapassava a coluna e ficava cortado. | Posicionamento dentro da coluna e largura limitada. Medição anterior: menu até 745,6px, coluna até 639,2px. |
| 6 | Média | Seleção de integrantes usava um diálogo manual sem proteção completa de foco/Escape. | Diálogo Radix com título acessível, foco contido, Escape e restauração de foco. Verificado Tab do último controle voltando ao primeiro e Escape fechando. |
| 7 | Média | “Adicionar emoji ao nome” acrescentava sempre 💬, sem escolher um emoji, e o nome usava a fonte do sistema. | Seletor real e EmojiInput com os PNGs originais. Verificado nome `Teste` com imagem de 😀 e preservação do conteúdo Unicode para salvar. |
| 8 | Alta | Campo de mensagem desaparecia abaixo da tela no celular, sobretudo com a faixa de demonstração em várias linhas. | Altura flexível até o viewport, incluindo o contêiner intermediário de animação. Verificado nos cinco tamanhos abaixo. |
| 9 | Média | Três colunas espremiam a conversa/painel em telas intermediárias. | Navegação em um painel do WhatsApp por vez até 1100px; a barra lateral da plataforma mantém seu comportamento responsivo. Campo e painéis verificados em tablet. |
| 10 | Média | Seletor de tema por conversa salvava uma preferência que já não tinha efeito porque a plataforma determina o tema. | Controle e assinatura removidos da interface; claro/escuro continuam definidos no controle global. |
| 11 | Média | Teclado telefônico aceitava número internacional de dez dígitos que a normalização da API rejeitava; busca numérica não limitava adequadamente o tamanho. | Mesma normalização do servidor nas duas entradas. Número inválido não oferece iniciar conversa; o número autorizado com DDD é reconhecido. Nenhum envio efetuado. |
| 12 | Alta | Permissions-Policy bloqueava câmera e microfone também na própria aplicação. | Permitidos somente para `self`; geolocalização continua bloqueada. Permissão do navegador segue necessária. Não foi gravado áudio nem acionada câmera física. |
| 13 | Alta | Rotinas antigas de retenção/reset podiam apagar histórico pelo serviço do banco, apesar da regra do usuário. | Endpoint de retenção permanentemente sem limpeza, independente de variável antiga. Duas RPCs substituídas por operações sem exclusão, sem SECURITY DEFINER. Aplicado e verificado no banco: ambos os retornos são zero. |
| 14 | Média | Avatares fictícios da demonstração tentavam consultar a API autenticada. | Editor/seletor em demonstração usam os avatares fictícios sem essas chamadas. |
| 15 | Alta | Dependência transitiva `source-map-js@1.2.1` apresentava aviso de segurança. | Lockfile atualizado para 1.2.2 em produção e ferramentas de desenvolvimento. Nenhuma atualização ampla do framework. |

Adicionalmente, retirado o atalho de chamada de vídeo conforme a decisão anterior de usar somente áudio. O botão de áudio indica indisponibilidade porque o serviço de chamadas ainda não está configurado; não apresenta uma operação fictícia como disponível.

## Matriz visual e funcional

Verificação pelo navegador Chrome, usando dados fictícios para formulários e seleção de listas. A conta conectada foi usada para reproduzir o problema original e confirmar a publicação, sem alterar integrantes, bloquear contatos ou excluir dados.

| Área | Verificação realizada | Resultado |
|---|---|---|
| Tema global | Alternar claro/escuro com conversa e painel abertos | Paleta acompanha a iGrow |
| Informações de grupo | Cabeçalho, mídia vazia, ações, “Mudar lista” aberto | Estados legíveis |
| Informações de contato | Mídias, etiquetas, ações e cabeçalho na conta conectada | Conferência de publicação |
| Listas | Filtro, gerenciador, menu, editor, cor e integrantes | Menu contido; formulário e foco revisados |
| Emojis | Campo do nome, categorias, seletor do compositor, busca e representação PNG | Arte original preservada |
| Mensagens enviadas | Menu, responder, cancelar resposta, reações rápidas | Fluxos visuais verificados |
| Mensagens recebidas | Menu sem opção de apagar | Restrição mantida |
| Exclusão | Testes de mensagens recebidas, seleção mista, permissões e comandos de limpar/excluir conversa | Rejeição antes das mutações |
| Busca na conversa | Texto “ótimos”, resultado único, filtro de data e fechar painel | Resultado correto nas mensagens carregadas |
| Anexos | Menu e formulários de contato/enquete | Estados e validação verificados |
| Contato vazio | Tentar enviar na demonstração | Validação exibida; nenhuma transmissão |
| Enquete longa | Doze opções em viewport 320×568 | Diálogo rolável, entre y=16 e y=552 |
| Telefone | Número internacional curto e número brasileiro formatado | Normalização coerente com a API |
| Teclado | Tab, Escape em menus/diálogos e retorno do foco | Verificação manual dos fluxos citados |
| Dispositivos | Política HTTP e código de captura | Bloqueio da origem corrigido; dispositivos reais não acionados |

### Tamanhos efetivamente medidos

Nos dois temas, largura do documento igual à largura do viewport e campo de mensagem dentro da tela. Tema claro também medido com informações/listas abertas.

| Viewport | Limite inferior do campo de mensagem | Resultado |
|---|---:|---|
| 1440×900 | 888,8px | Dentro da tela |
| 1024×768 | 756,8px | Dentro da tela |
| 768×1024 | 1012,8px | Dentro da tela |
| 390×844 | 832,8px | Dentro da tela |
| 320×568 | 556,8px | Dentro da tela |

Evidências locais em `artifacts/audit-light-group.png`, `artifacts/audit-mobile-light.png` e capturas complementares. A captura `audit-mobile-before.png` registra a falha anterior. Arquivos em `artifacts/` são locais e ignorados pelo Git.

## Validação técnica

- 134 arquivos de testes, **862 testes aprovados**.
- TypeScript, ESLint e build de produção aprovados.
- Dois testes novos garantem que uma variável antiga de retenção nunca reative a limpeza e que a autenticação do cron continua obrigatória.
- Consultas reais do banco confirmam ausência de DELETE para `authenticated` em mensagens e conversas e presença da política restritiva que permite ocultação somente de mensagens enviadas elegíveis por owner/admin/editor.
- Migração `20261011202352_whatsapp_preserve_history.sql` aplicada com sucesso. As RPCs de retenção e limpeza retornaram zero após a substituição.
- `pnpm audit --prod`: **zero vulnerabilidades conhecidas retornadas** após atualização. Isso não constitui garantia de segurança completa.
- Ambiente local executa Node 26; o projeto declara Node 24. A publicação deve validar o build no ambiente configurado da hospedagem.

## Pendências, limites e observações

1. **Ligação de áudio:** depende de serviço de chamadas, ainda sem conta/configuração do usuário. Continua indisponível e claramente indicada. Vídeo retirado.
2. **Aviso apenas nas ferramentas de desenvolvimento:** `braces@3.0.3`, dependência transitiva de ferramentas, ainda é a última versão publicada consultada. O advisory informa problema de recursão com padrões profundamente aninhados. `pnpm audit` completo ainda retorna um aviso alto; produção retorna zero. Não foi introduzido um patch próprio em dependência de terceiros.
3. **Supabase Auth:** advisor informa proteção de senhas vazadas desativada. Registrado para revisão de configuração, sem alterar autenticação ou contas durante esta rodada.
4. **Advisors do banco:** 40 avisos de funções SECURITY DEFINER acessíveis a usuários autenticados e 10 informativos de RLS sem políticas. Não são prova, isoladamente, de acesso indevido: funções públicas precisam validar autorização, e tabelas somente de serviço podem intencionalmente não ter políticas de cliente. A auditoria revisou especificamente a regra de exclusão do WhatsApp, não todos os corpos dessas funções da plataforma.
5. **Console local:** avisos de hidratação identificaram atributos injetados por extensões (`vsc-initialized`, `cz-shortcut-listen`) e erros `chrome-extension://…`. Não foram tratados como bug comprovado do código da iGrow nem silenciados artificialmente.
6. **Integração nativa:** exclusão, bloqueio, associação a etiquetas e envio real não foram acionados como teste destrutivo. A suíte verifica contratos/permissões; não equivale a repetir todas as mutações reais no WhatsApp.
7. **Identidades PN/LID:** a reconciliação técnica anterior consolida cópias da mesma identidade/mensagem; não é uma função oferecida ao usuário para excluir histórico. Não alterada nesta rodada. Deve ser revisada separadamente caso a exigência passe a incluir preservação física de registros duplicados de aliases.
8. **Referências 15–29:** esta auditoria não declara concluída a reprodução individual de todas as referências restantes. Notas, denúncia, GIF e sincronização de tema com o WhatsApp nativo permanecem descartados conforme decisões anteriores.

Fontes dos avisos de dependências: [source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). Advisors: [funções privilegiadas](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [RLS sem políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [proteção de senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
