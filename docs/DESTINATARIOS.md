# Destinatários e autorização de recebimento

Em Clientes, abra **Destinatários**. Proprietário, administrador e editor podem cadastrar nome/telefone, editar e ativar/desativar contatos. Leitor somente consulta. O telefone aceita formato internacional com `+` e 8–15 algarismos, sem espaços; a validação é sintática e não confirma existência, titularidade ou disponibilidade no WhatsApp.

Cadastro começa **sem autorização**, independentemente de estar ativo. Registrar autorização exige confirmação explícita na interface, origem/referência e data não futura. A data pode ser informada no horário do navegador ou marcada como recebida agora. O banco armazena instantes em `timestamptz` e valida novamente as entradas.

Descadastro é uma ação explícita e registra motivo, data e autor. Reativar um contato não restaura sua autorização. Trocar o telefone invalida a autorização anterior. Voltar a um telefone anteriormente descadastrado não permite reutilizar evidência anterior ao descadastro. Uma nova autorização precisa ser posterior.

Clientes arquivados permitem consulta e descadastro, mas não novos destinatários, edição ou autorização. O histórico mantém origem, telefone referente ao evento, momento da ocorrência, momento de registro e usuário autor. Nomes e telefones não são copiados para os logs gerais de auditoria.

## Banco

Aplique `202609300004_recipients.sql` após as migrations anteriores. As tabelas `client_recipients` e `recipient_consent_events` têm RLS, FKs compostas e leitura limitada à agência. Usuários não escrevem diretamente nessas tabelas. RPCs autorizadas serializam operações por cliente e gravam estado, histórico e auditoria na mesma transação. Não há exclusão pela interface nem permissão de exclusão para usuários. Telefone duplicado no mesmo cliente é rejeitado.

Os tipos TypeScript seguem temporariamente mantidos à mão; regenere-os quando houver Supabase disponível. `pnpm test:db` aplica as quatro migrations e executa as duas suítes SQL no PGlite. Login e APIs Supabase reais continuam pendentes de homologação.

## Demonstração e limites

Em `/demo/clientes`, os registros ficam apenas em memória e desaparecem ao fechar o painel ou recarregar. Nenhuma mensagem, email, consulta Meta ou chamada WhatsApp é efetuada.

Este incremento não implementa entregas, filas ou webhook. O cancelamento de entregas pendentes e o reexame da autorização imediatamente antes do envio deverão integrar a etapa de WhatsApp/jobs. O histórico é um registro operacional; não comprova por si só a existência da evidência informada pelo gestor.
