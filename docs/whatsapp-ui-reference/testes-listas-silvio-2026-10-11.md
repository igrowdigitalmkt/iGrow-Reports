# Testes de listas — Silvio — 11/10/2026

Testes reais na integração conectada da iGrow, restritos ao contato Silvio. O controle do navegador não respondeu em duas tentativas; portanto, esta rodada verificou o protocolo real pela API da integração, sem declarar conferência visual no WhatsApp Web.

## Resultados práticos

- Lista `Teste listas iGrow 20261011` criada no WhatsApp, ID nativo 8.
- Renomeada para `Teste listas iGrow 20261011 OK` e cor alterada: confirmado na leitura nativa.
- Associação enviada pelo número de Silvio: registrada no alias de telefone, mas ausente na identidade LID que o WhatsApp usa para o contato.
- Associação enviada pela identidade LID comprovada: apareceu junto das quatro etiquetas originais de Silvio. Essa diferença reproduziu o bug da integração.
- Associação de teste removida dos dois aliases. Os vínculos originais 4, 5, 6 e 7 foram preservados. A lista de teste permanece vazia; nenhuma lista original foi apagada.

## Correções

1. Resolver o LID do contato usando apenas vínculos comprovados da mesma agência e sessão QR. Inclusões passam a usar essa identidade; remoções limpam os aliases comprovados para evitar associações antigas que voltam a aparecer.
2. Bloquear gravações duplicadas antes da atualização do estado React.
3. Descartar respostas antigas de sincronização, que podiam sobrescrever alterações recentes.
4. Separar falha de atualização da tela de uma alteração já salva. Uma criação confirmada não deve ser apresentada como uma criação fracassada.
5. Retornar o ID e aviso de resultado parcial quando a etiqueta foi criada, mas alguma inclusão falhou, evitando novas etiquetas duplicadas em tentativas seguintes.
6. Desabilitar troca de conta enquanto uma alteração está em andamento.

Validação: 863 testes aprovados, incluindo regressão para identidade LID, limpeza dos aliases e criação parcial; lint, TypeScript e build aprovados. Não foram apagadas mensagens nem conversas, nem enviados novos textos ao contato.

Ainda é necessária uma rodada visual de menus, filtros e interação na plataforma quando o controle do navegador voltar a responder. Estes testes não permitem afirmar que todos os bugs de listas foram eliminados.
