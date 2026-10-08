# Como integrar a UI no projeto de WhatsApp já existente

Este pacote contém uma implementação de **interface própria** baseada na organização visual do WhatsApp Web em modo escuro, vista no navegador Chrome conectado em 8 de outubro de 2026. Não contém código-fonte original do WhatsApp nem dados de conversas reais.

## Instrução pronta para fornecer ao desenvolvedor ou agente de código

> Integre a pasta `src/` do pacote `whatsapp-ui-reference` ao módulo de WhatsApp existente do meu produto, SEM substituir nem remover a lógica de autenticação, sincronização, backend, banco ou permissões. Aplique a estrutura de navegação: rail lateral de 80px, caixa de conversas com largura responsiva e painel de chat. Preserve visual dark, fonte, espaçamentos, chips de filtros, headers, cards, mensagens, composer, ícones e menus contextuais. Não use os contatos fictícios na produção. A UI é independente do backend: adapte todos os handlers ao modelo de dados existente.
>
> **Reações**: o menu das mensagens deve oferecer emojis e chamar a função de reação do provedor com `messageId` original. Exibir a reação só após confirmação do backend e sincronizar eventos de retorno, inclusive reações removidas.
>
> **Selecionar**: permitir selecionar uma ou várias mensagens e então habilitar ações permitidas, em vez de confundir Selecionar com edição do conteúdo.
>
> **Apagar**: a plataforma auxiliar NÃO pode apagar mensagens recebidas nem conversas. Para mensagens enviadas, oferecer apagar localmente (se permitido pelo produto) ou apagar para todos somente se o conector suportar a operação e se a janela de exclusão válida permitir. Nunca informar sucesso de exclusão no WhatsApp antes de receber a confirmação da integração. Na UI de referência, essas ações estão apenas simuladas.
>
> **Histórico de sessão**: ao desconectar uma conta WhatsApp, eliminar apenas o cache vinculado àquela conexão, evitando misturar históricos de contas diferentes. Quando conectar outra conta, realizar ressincronização normal. Não adicionar botão manual de limpar histórico.
>
> **Layout**: adaptar a responsividade às dimensões reais, preservar legibilidade e não mexer em módulos fora do WhatsApp. Reutilizar componentes de design com classes específicas para evitar impacto global no CSS. Antes de publicar, validar desktop (1536×864), notebook (1366×768), tablet (1024×768) e celular (390×844), além de execução real de enviar, reagir, selecionar, encaminhar e apagar mensagens enviadas.

## Arquivos principais

- `src/styles.css` — tokens de design, layout de três painéis, navegação, estados, menus, mensagens e responsividade.
- `src/main.tsx` — componentes da interface, eventos e controles de demonstração.
- `src/mock.ts` — dados fictícios e tipos necessários para substituir pelos objetos do backend.

## Limites técnicos

Uma página web não revela o código de desenvolvimento original do serviço ao qual ela se conecta. O navegador recebe recursos publicados, geralmente minificados, que dependem dos servidores do fornecedor. Copiar esses recursos não oferece uma implementação licenciada, independente ou funcional da plataforma. Para desenvolvimento do seu produto, o caminho tecnicamente sustentável é reproduzir a camada visual em código próprio e conectar à sua integração legítima.