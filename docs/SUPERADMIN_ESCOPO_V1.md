# iGrow Reports — Escopo de produto do Super Admin e lançamento comercial

> Documento de requisitos para orientar decisões e implementação. Não é uma ordem para construir tudo de uma vez. O código atual, os arquivos do repositório e as integrações efetivamente configuradas devem ser verificados antes de qualquer mudança.

## 1. Objetivo

Criar uma área administrativa **exclusiva dos operadores autorizados do iGrow Reports**, separada dos administradores das organizações clientes. Ela deve permitir administrar o SaaS, sua comercialização, seus assinantes e seus controles operacionais sem depender de alterações rotineiras no código.

O produto já possui funcionalidades de análise e relatórios de anúncios; **preservá-las é prioridade**. Verificar o que realmente existe no código, sem supor que tudo citado nos documentos está pronto ou homologado.

## 2. Princípios obrigatórios

- Controle efetivo no **servidor e nas políticas de dados**, não apenas botões ocultos no frontend.
- Isolamento multi-tenant e RLS do Supabase; separar permissões de Super Admin das permissões da organização.
- Alterações seguras, auditáveis, idealmente reversíveis; registrar autor, data e alteração, sem logar segredos.
- Reutilizar arquitetura e componentes existentes. Não reescrever ou refatorar partes não relacionadas.
- Diferenciar configuração dinâmica de ajustes que dependem de infraestrutura, credenciais, DNS ou deploy.
- Não expor segredos, dados reais de clientes ou chaves privilegiadas em código cliente, logs ou commits.
- Não executar migrations de produção, transações financeiras reais, deploy ou alterações destrutivas sem autorização e sem conferir as restrições já documentadas no repositório.
- Interface administrativa em português, legível, responsiva, organizada e adequada a operador não técnico.
- Evitar funcionalidades supérfluas na V1. Sugerir alternativas melhores quando houver razão técnica/comercial.

## 3. Núcleo do Super Admin (prioridade para avaliar na V1)

### 3.1 Acesso e auditoria
- Identidade de operadores da plataforma e permissões próprias; autenticação privilegiada e MFA quando suportada.
- Proteção de rotas, endpoints e ações administrativas; menor privilégio; trilha de auditoria das operações críticas.
- Confirmação adicional para alterações perigosas; nenhuma função de impersonação silenciosa.

### 3.2 Visão geral administrativa
- Quantidade de organizações e assinaturas por estado, novos cadastros, erros importantes.
- Indicadores somente quando houver fontes confiáveis; não exibir números fictícios.
- Distinguir receitas confirmadas, assinaturas, créditos e custos de integrações.

### 3.3 Organizações e usuários
- Busca, detalhes, responsáveis, status, plano, limites, consumo e problemas operacionais.
- Gestão de bloqueios, concessões especiais e convites, conforme política de segurança.
- Não permitir acesso irrestrito aos dados privados das organizações.

### 3.4 Identidade e configurações globais
- Nome público, logos, favicon, contatos, links institucionais, mensagens e preferências seguras.
- Explicitar quais mudanças são dinâmicas e quais exigem deploy, configuração externa ou ajustes no código.
- Prévia/validação das alterações relevantes.

### 3.5 Catálogo comercial e direitos de uso
- Planos públicos, privados/ocultos e especiais; preço, moeda, periodicidade, descrição, ordem e status.
- Recursos incluídos e limites por plano: clientes, usuários, conexões, relatórios, automações, IA/créditos e notificações **conforme funcionalidades reais**.
- Distinguir **plano**, **preço**, **assinatura**, **entitlement/direito de uso**, **limite**, **papel do usuário** e **feature flag global**.
- Permitir benefícios temporários, convites e links privados com expiração, revogação e limites de uso.
- Preservar assinantes existentes ao alterar preços/condições: versionamento e regras de migração.
- Aplicar restrições de forma consistente em API, jobs e frontend.

### 3.6 Feature flags
- Ativação/desativação global por funcionalidade, disponibilidade por plano e liberações excepcionais por organização.
- Histórico de mudanças, políticas padrão seguras e possibilidade de desativação emergencial.

### 3.7 Assinaturas e pagamentos
- Verificar se já há gateway implementado; se não, **comparar opções adequadas ao Brasil antes de escolher**.
- Cadastro/checkout, ativação após confirmação confiável, trial, upgrade/downgrade, cancelamento, inadimplência e reativação.
- Webhooks autenticados e idempotentes; conciliação com provedor; sem armazenar dados sensíveis de cartão.
- Cupons, descontos limitados, condições especiais e regras de elegibilidade.
- Área do assinante para plano, limites, cobranças e alterações permitidas.
- Considerar requisitos legais/fiscais brasileiros e encaminhar questões jurídicas/contábeis quando necessário.

### 3.8 Site público de vendas e conteúdo
- Landing page rápida, responsiva e acessível, orientada a conversão: proposta de valor, benefícios, demonstrações reais, FAQs, preços e cadastro.
- Planos exibidos devem vir da mesma fonte administrativa do catálogo comercial, com visibilidade pública configurável.
- CMS **simples e proporcional** para textos, imagens, FAQ, SEO, banners e publicação de conteúdo.
- Não inventar depoimentos, métricas, selos ou funcionalidades.

## 4. Gestão operacional (priorizar conforme risco e maturidade)

- **Inteligência artificial e créditos:** saldo, concessões, débito e estorno auditáveis, custo por operação, limites e anomalias; avaliar modelo de assinatura + consumo variável.
- **Integrações:** status de Meta/Google/TikTok Ads e provedores realmente conectados; falhas, limites e controles seguros.
- **Relatórios e automações:** execução agendada, filas/erros/reprocessamento seguro, envio por WhatsApp e e-mail, limites e observabilidade.
- **Comunicações:** templates, avisos internos, notificações de cobrança, manutenção e novidades; respeitar políticas do WhatsApp.
- **Suporte:** dados operacionais mínimos para diagnóstico; avaliar integração com serviço externo antes de criar ferramenta própria.
- **Monitoramento:** erros de API, jobs, webhooks, pagamentos e integrações; links para ferramentas existentes em vez de recriar sua infraestrutura.
- **Privacidade/LGPD:** documentos e aceite, retenção, acesso/correção/exclusão conforme base legal e obrigações aplicáveis.
- **Onboarding:** cadastro, criação de organização, seleção de plano, teste, pagamento e provisionamento de acesso.

## 5. Arquitetura a propor (não presumir pronta)

- Modelo de permissões do Super Admin e isolamento das organizações.
- Esquema de planos/preços/assinaturas e direitos de uso; regras de precedência claras.
- Gerenciamento de feature flags e configurações globais com validação, auditoria e propagação.
- Admin UI separada logicamente do painel do assinante e protegida no backend.
- Integração segura ao gateway de pagamentos e sincronização de estados de assinatura.
- Site comercial acoplado ao catálogo sem criar duas fontes contraditórias.
- Migrações compatíveis, testes de regressão e plano de recuperação.

## 6. Priorização esperada

Divida recomendações em:

- **A — Bloqueia lançamento comercial:** acesso administrativo seguro, oferta/planos e limites reais, cadastro/contratação, pagamento se houver cobrança, provisionamento, proteção e testes críticos; um site comercial mínimo e honesto.
- **B — Importante depois do lançamento:** operação/administração mais confortável, CMS ampliado, campanhas promocionais avançadas, métricas mais profundas.
- **C — Futuro:** complexidade sem retorno imediato, automações sofisticadas, recursos experimentais e módulos próprios onde uma integração é mais simples.

A classificação deve ser revisada conforme o código atual e o modelo comercial escolhido.

## 7. Como conduzir o Claude Code com economia de contexto

- Este documento é **fonte de escopo**. Não solicitar implementação completa de uma vez.
- Primeiro, diagnóstico **limitado** aos componentes de autenticação, organização, configurações e possíveis assinaturas, sem auditoria do repositório inteiro.
- Propor arquitetura mínima, dependências, riscos e sequência de entregas em uma página curta. O proprietário aprova a sequência antes do código.
- Executar **um módulo pequeno por sessão**, verificando `git status`, arquivos relevantes e testes proporcionais.
- Registrar decisões e pendências relevantes no documento de status existente. Não reler documentos extensos a cada tarefa.
- Antes de alterar banco, produção, cobrança ou permissões críticas, avaliar impacto e solicitar autorização explícita.
- Cada entrega deve indicar: o que foi feito, arquivos alterados, testes realmente executados, limitações e próxima tarefa.

## 8. Resultado desejado

Uma V1 administrável e comercializável, segura e simples de operar, com estrutura capaz de evoluir. O Claude deve **avaliar criticamente** este escopo, propor melhores alternativas e explicar prioridades; não deve obedecer cegamente nem ampliar o projeto sem aprovação.
