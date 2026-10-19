# Groow Ads — diretriz estratégica para agentes

Regra obrigatória para Claude, Codex e demais assistentes de desenvolvimento: antes de propor, priorizar ou implementar funcionalidades de produto, ler docs/VISAO_ESTRATEGICA_GROOW_ADS.md. A Groow Ads é uma IA executora de marketing: conhece o negócio, recebe delegação de escopo e realiza ações reais em campanhas; dashboards, relatórios e WhatsApp são infraestrutura de apoio. O primeiro lançamento comercial divulgado deve demonstrar execução real por IA, não apenas análises ou recomendações. Preservar isolamento, permissões, limites, auditoria e autorizações de produção. Não declarar essas ações implementadas sem confirmação no código e com as APIs reais.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# WhatsApp: user-defined deletion restrictions

When implementing WhatsApp controls or APIs in iGrow, never offer or execute clearing/deleting conversations or deleting/hiding incoming messages. Only outgoing messages may be deleted, subject to permissions and WhatsApp eligibility. Mixed selections containing incoming messages must be rejected before any mutation. Apply this rule even when a reference screenshot includes prohibited actions. Keep the protection in the UI, API and database policies.
