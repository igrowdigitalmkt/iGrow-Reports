# iGrow Reports — Armazenamento híbrido e WhatsApp leve

Data: 2026-10-08. Escopo implantado de forma conservadora.

## Decisão de arquitetura

- Vercel: Next.js, APIs e cron de manutenção diária.
- Supabase Free: fonte autoritativa para autenticação, clientes, permissões,
  campanhas, relatórios e mensagens recentes. **Não mover tabelas Meta**:
  os cálculos, RLS e relatórios dependem de funções SQL e joins do Supabase.
- Hostinger KVM 2 (2 vCPU, 8 GB de RAM, 100 GB SSD): Evolution API,
  PostgreSQL/Redis da Evolution e armazenamento de **cópias criptografadas**.
- Não expor PostgreSQL da VPS publicamente, não replicar senhas de serviço
  da Vercel na VPS e não instalar uma segunda plataforma Supabase.

## WhatsApp — recurso secundário

- Uma nova sessão QR nunca solicita `syncFullHistory`.
- `MESSAGES_SET` é ignorado, mesmo que uma instância antiga envie o evento.
- `MESSAGES_UPSERT` com data anterior a 60 dias é ignorado.
- Inbox QR mostra somente conversas com mensagem dos últimos 60 dias,
  mantendo favoritas, não lidas e arquivadas. Números oficiais não são afetados.
- A interface carrega no máximo 80 mensagens recentes por conversa.
- A sincronização incremental da inbox ocorre a cada 10 s, threads a cada 8 s
  e reconciliação total a cada 10 min, com aba em primeiro plano.
- Mensagens QR **já lidas, não favoritas e com mais de 60 dias** são
  descartadas em lotes de até 250; um cron só pode remover até 1000 por dia.
  Os metadados de conversa e o estado de arquivamento permanecem.
  Mensagens oficiais são sempre excluídas desta rotina de limpeza.

## Recuperação

Baseline de WhatsApp exportado pelo serviço Supabase via HTTPS, paginado
de 250 em 250 linhas, compactado e criptografado (Fernet) no Windows.
A cópia foi conferida por SHA-256 e enviada para `/opt/backups/igrow`
na Hostinger; outra cópia e a chave de recuperação permanecem no Windows
em `%LOCALAPPDATA%\\iGrow\\Backups`.

**A chave não está na VPS**: copie-a para um cofre de senhas/backup fora
do computador. Este snapshot é específico do WhatsApp e **não é um backup
completo e transacional do Supabase**. O destino VPS também não substitui
um backup offsite independente.

## Limites e monitoramento

- Retenção automática somente se `WHATSAPP_RETENTION_ENABLED=true`
  na Vercel e `CRON_SECRET` estiver corretamente configurado.
- Vercel cron: `30 7 * * *` (07:30 UTC = 04:30 em Teresina).
- Controle SQL: role `service_role` obrigatória, limite de lote 250,
  leitura e favoritos preservados; `SKIP LOCKED` evita concorrência
  entre limpezas no mesmo registro.
- Verificar disponibilidade Supabase, eventuais timeouts no webhook,
  uso de disco e consumo de recursos antes de elevar limites.
- As principais tabelas Meta representam a maior parcela do banco.
  Evitar migração de dados ativos enquanto relatórios usam funções SQL.
  Uma cópia fria externa poderá ser adicionada sem mudar a origem dos
  dados, em etapa própria com validação de consistência.

## Restrições

Não desconectar/recriar QR Code para manutenção. Não mudar credenciais
ou serviços Meta. Não apagar arquivos ou outros dados da VPS. Mudanças
grandes requerem backup, testes de restauração e estratégia de rollback.
