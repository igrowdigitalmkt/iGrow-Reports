# iGrow Reports

Fundação da plataforma de relatórios de tráfego da iGrow: Next.js, TypeScript, Tailwind e Supabase/PostgreSQL, preparada para evolução na Vercel. Meta Marketing API, WhatsApp Cloud API oficial e QStash serão implementados em próximos incrementos.

O painel está em português, com fundo grafite e acentos azul, cyan e violeta. A rota `/demo` contém **dados inteiramente fictícios**, identificados na interface. A área `/dashboard` depende de autenticação e associação à agência; configuração ausente não vira demonstração automaticamente.

## Executar localmente

Para a primeira instalação na Vercel e no Supabase, siga [PUBLICACAO.md](docs/PUBLICACAO.md). O projeto inclui validação de configuração antes do deploy e workflow de verificações para GitHub; ainda não foi publicado.

Requisitos: Node.js 24 e pnpm 11.19, conforme `package.json`. O lockfile pnpm é a fonte das versões resolvidas. Não misture npm, yarn e pnpm neste repositório.

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
pnpm dev
```

Acesse [http://localhost:3000/demo](http://localhost:3000/demo) para revisar o dashboard demonstrativo sem credenciais. Para autenticação, preencha as variáveis do Supabase em `.env.local`, reinicie o servidor e siga o [procedimento do banco e bootstrap](docs/BANCO.md). Não há cadastro público irrestrito.

Neste Windows, se `pnpm` não estiver no PATH, use `./scripts/pnpm.ps1 dev` (ou substitua `dev` por outro comando). O auxiliar detecta o runtime disponibilizado pelo Codex, sem instalar ferramentas globais. Para verificar o bloqueio da demonstração em produção após o build, execute `pnpm test:production`.

| Rota | Finalidade |
| --- | --- |
| `/demo` | Demonstração pública, com fixtures e sem envios reais |
| `/entrar` | Login Supabase e estado de configuração pendente |
| `/dashboard` | Área protegida no contexto de uma agência |
| `/selecionar-agencia` | Escolha entre as associações verificadas do usuário |
| `/sem-acesso` | Usuário autenticado sem associação a uma agência |
| `/convite?token=…` | Aceite explícito de convite da agência para o email autenticado |
| `/auth/definir-senha` | Definição de senha após convite ou recuperação Auth |

`ENABLE_DEMO=true` habilita a demonstração. Sem essa variável, ela fica disponível em desenvolvimento e desabilitada em produção. A autenticação e as políticas de `/dashboard` continuam sendo exigidas independentemente dessa opção.

## Verificar

Use os scripts de `package.json` para TypeScript, lint, testes e build. O registro de execução e as pendências ficam em [IMPLEMENTACAO.md](docs/IMPLEMENTACAO.md). A suíte SQL pode ser executada localmente em PostgreSQL WASM/PGlite; a homologação com Supabase real está descrita em [BANCO.md](docs/BANCO.md).

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:db
pnpm build
```

Testes de navegador usam Playwright:

```powershell
pnpm exec playwright install chromium
pnpm test:e2e
```

`test:db` aplica as cinco migrations e executa pgTAP em um banco descartável PGlite, com estruturas mínimas de Auth/Storage para os testes. Ele verifica SQL, permissões e RLS; login remoto, API de Storage e concorrência precisam de homologação no Supabase.

## Escopo entregue e limites

A fundação inclui estrutura modular, componentes visuais, dashboard, autenticação inicial e artefatos SQL de isolamento por agência. Criar o código e a migration não provisiona um banco nem comprova uma política RLS: as validações que exigem infraestrutura estão identificadas no progresso.

Meta, WhatsApp e QStash permanecem sem conexão. Ainda não há coleta de anúncios, cálculo de métricas de produção, geração de relatórios/PDF ou entrega automática. Vercel é o destino aprovado, mas nenhum deploy foi realizado nesta etapa.

## Documentação

- [Planejamento integral da V1](docs/PLANEJAMENTO_V1.md)
- [Etapas, verificações e pendências](docs/IMPLEMENTACAO.md)
- [Arquitetura e fronteiras de segurança](docs/ARQUITETURA.md)
- [Banco, bootstrap e testes SQL](docs/BANCO.md)
- [Definições de métricas](docs/METRICAS.md)
- [Configuração das integrações](docs/INTEGRACOES.md)
- [Diagnóstico, homologação e deploy](docs/OPERACAO.md)
- [Fundação da Área do Cliente](docs/AREA_CLIENTE.md)

Clientes possuem cadastro, edição, arquivamento, reativação e auditoria. O botão **Destinatários** permite gerenciar contatos, autorização de recebimento, descadastro e histórico. A **Área do Cliente** já possui vínculo autenticado separado da equipe da agência, RLS, revogação de acesso e rotas `/cliente` e `/cliente/[clientId]`. A interface não apresenta números fictícios; os blocos de desempenho serão preenchidos sobre métricas e relatórios reais. Experimente em `/demo/clientes` (alterações temporárias) ou configure Supabase e aplique as cinco migrations para persistir em `/dashboard/clientes`. Consulte [DESTINATARIOS.md](docs/DESTINATARIOS.md) e [AREA_CLIENTE.md](docs/AREA_CLIENTE.md). Próximo passo: homologar no Supabase antes da integração Meta.
