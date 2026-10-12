# Visão e plano de IA — iGrow Reports (V2)

Registrado em 12 de outubro de 2026. Responsável: Silvio Melo, iGrow Digital.
Status: **planejamento aprovado para a V2. Nada disto está implementado.** A V1 (ver `PLANEJAMENTO_V1.md`) não inclui IA generativa e deve ser concluída antes.

## 1. Tese do produto

Software com muitas funcionalidades deixou de ser diferencial: qualquer pessoa consegue montar um. O que continua difícil de copiar:

- números confiáveis (confirmação de dados, ausência diferente de zero, conciliação decimal);
- conhecimento de quem opera tráfego de verdade;
- presença no WhatsApp, onde o público já está;
- histórico acumulado de cada cliente.

Identidade proposta: a iGrow Reports deixa de ser "plataforma de relatórios" e passa a ser **quem cuida dos números e da conversa com o cliente por você**. O relatório vira subproduto. A métrica de sucesso é **horas devolvidas por semana**, não tempo de uso.

Princípios: a plataforma vai até a pessoa (WhatsApp antes de painel); silêncio é funcionalidade (só interrompe quando importa); fazer em vez de apenas sugerir; memória por cliente; todo número tem origem; confiança em degraus (observa → sugere → age com aprovação → age sozinha dentro de limites).

Linguagem: neutra, sem "agência" na interface (ver memória do projeto sobre público).

## 2. Regras de arquitetura (valem para todas as fases)

1. **A IA nunca calcula números.** Os números vêm do código determinístico e dos snapshots confirmados. A IA interpreta e escreve.
2. **Verificador de números** antes de qualquer envio automático: todo valor citado no texto deve bater com a fonte confirmada; se não houver dado, a IA diz que não sabe.
3. **A IA herda as permissões do usuário** (RLS). O cliente só vê o que é dele.
4. **WhatsApp:** a IA nunca limpa/apaga conversas nem apaga/oculta mensagens recebidas (ver `AGENTS.md`). Apenas mensagens enviadas, sujeitas às permissões existentes.
5. Registro de cada resposta: dados usados, modelo, tokens e custo.
6. Cota e alerta de consumo por organização; botão para desativar a IA por organização e por cliente.
7. LGPD: enviar à IA dados agregados, evitando nome e telefone de leads; atualizar termos de uso.

## 3. Fases

| # | Entrega | Trabalho eliminado | Depende de |
|---|---|---|---|
| 0 | Concluir a V1 com dados reais | base | — |
| 1 | Comentário automático nos relatórios + alertas de anomalia (regras + texto) | escrever a análise | V1 |
| 2 | Resumo diário de triagem no WhatsApp do gestor | abrir conta por conta | 1 |
| 3 | Perguntas e respostas no WhatsApp (cliente e gestor) | responder "como está minha campanha?" | 1 |
| 4 | Memória por cliente (metas, eventos, decisões, testes) | reexplicar contexto | 3 |
| 5 | Ações preparadas com aprovação em um toque e auditoria | executar o óbvio | permissão de escrita Meta (`ads_management`, exige revisão do app) |
| 6 | Ciclo fechado: pergunta mensal ao cliente sobre vendas → custo por venda real | provar resultado | Fase 3 (canal de resposta) |

### Revisão de 12/10/2026: o WhatsApp da plataforma é só canal de saída

Uma análise externa (conversa compartilhada do ChatGPT, lida em 12/10) propôs uma "Proteção de Oportunidades" (detectar leads sem resposta). Ela foi **descartada por ora**: o responsável esclareceu que o WhatsApp conectado na plataforma serve apenas para enviar resumos e relatórios de tráfego. As conversas de venda dos clientes não passam por ele, e a plataforma só tem os dados dos anúncios. Um detector construído sobre isso foi escrito e removido no mesmo dia.

Decisões que permanecem:
- Parar o polimento de funcionalidades genéricas, inclusive a fidelidade visual do WhatsApp Web; fechar a V1 no mínimo necessário.
- A IA é o diferencial: o foco é tirar trabalho do gestor, medido em horas devolvidas.
- Fechar o ciclo até a venda **sem ler conversas privadas**: uma vez por mês a plataforma pergunta ao cliente quantas vendas vieram dos anúncios e registra a resposta (custo por venda real).
- Honestidade na medição: não presumir venda por conversa positiva, nem atribuir ao anúncio toda venda posterior.

Plano de execução detalhado e aprovado pelo responsável: ver `docs/IMPLEMENTACAO.md` (entrada de 12/10/2026).

## 4. Plataformas

- **Nova e única obrigatória:** conta na API da Anthropic (Claude). Cobrança por uso; chave nas variáveis de ambiente da Vercel, nunca exposta.
- Já existentes e reutilizados: Supabase (memória, registros, cotas), Vercel e worker/fila (relatórios agendados podem usar a API Batch, 50% mais barata), Evolution (canal WhatsApp).
- Opcionais: pgvector (busca semântica, mais adiante); ferramenta de observabilidade (no início, tabela de registros no Supabase).

## 5. Conta única ou chave por cliente

**Decisão recomendada: conta única da plataforma, custo embutido no plano.**

- Chave própria exige que o usuário crie conta de API, gere chave e cadastre cartão: contradiz o princípio de não dar trabalho, aumenta suporte e obriga a guardar chaves de terceiros.
- A assinatura do ChatGPT Plus não pode ser conectada a outra plataforma; só uma chave de API, com cobrança separada.
- Alternativa futura para quem já usa ChatGPT/Claude: **conector (MCP)** para o assistente da pessoa consultar os dados dela na iGrow com as mesmas permissões. Chave própria pode virar opção de plano empresarial, se houver demanda.

## 6. Custo estimado (preços cached em 6/10/2026; volumes são estimativa, não medição)

Preços por 1M de tokens (entrada/saída): Haiku 5.5 $0,10/$0,50 (acima de 100K tokens de prompt: $0,50/$2,50); Sonnet 5.5 $2/$10; Opus 5.5 $4/$20. Leitura de cache ≈ 10% do preço de entrada; Batch = 50%.

| Uso | Modelo | Volume/mês | Custo por cliente |
|---|---|---|---|
| Comentários de relatórios semanais | Sonnet 5.5 | 4 | ~US$ 0,18 |
| Triagem diária | Haiku 5.5 | 30 | ~US$ 0,02 |
| Perguntas no WhatsApp (com cache) | Sonnet 5.5 | ~20 | ~US$ 0,25–0,50 |
| Análise mensal aprofundada | Opus 5.5 | 1 | ~US$ 0,28 |
| Classificação de conversas (fase 6) | Haiku 5.5 | ~1.000 | ~US$ 0,30 |
| **Total** | | | **~US$ 1 a 1,50** |

Gestor com 20 clientes: ~US$ 20–30/mês. Sem cache e com uso intenso, pode chegar a US$ 3–5 por cliente, por isso a cota por organização é obrigatória desde o início. Recomendação: incluir a IA no plano com franquia de uso, sem cobrar à parte. Confirmar preços vigentes antes de implementar.

## 7. Como validar

1. Cronometrar na iGrow Digital, por duas semanas, o tempo gasto em relatórios, conferências e respostas a clientes.
2. Conversar com ~10 gestores (autônomos e equipes internas): "o que você fez na última semana que odiaria fazer de novo?".
3. Após cada fase, medir horas devolvidas por semana. Meta inicial: a fase 1 devolver pelo menos 3 h/semana a um usuário.

## 8. Próximo passo concreto

Detalhar tecnicamente a fase 1 (entradas do snapshot, verificador de números, formato do comentário, tabela de registros e cotas) **depois** de a V1 estar concluída e homologada com dados reais.

## 9. Plano de execução aprovado (12/10/2026)

Aprovado pelo responsável. Cada etapa só começa depois de a anterior estar testada; da etapa 3 em diante, homologar com dados reais antes de seguir. As etapas 1 e 2 podem andar juntas.

| # | Etapa | Propósito | Precisa do responsável |
|---|---|---|---|
| 1 | Teste offline: script local lê os números confirmados de um cliente real e a IA escreve 2–3 frases na tela, sem enviar nada | Saber se a qualidade do texto serve antes de construir telas e banco; custo de centavos | Etapa 2 (chave) |
| 2 | Conta e chave da API da Anthropic, com limite mensal baixo (ex.: US$ 20); chave na Vercel e no ambiente local | Única plataforma nova; o limite evita surpresa de gasto; o assistente nunca vê o valor | Criar conta, cartão e chave |
| 3 | Camada de IA: módulo único para toda chamada, tabela de uso (quem, dados enviados, modelo, tokens, custo), cota por organização, botão de desligar | Controle de custo e rastro do que foi dito ao cliente; base de todas as etapas seguintes | Aplicar a migração |
| 4 | Comentário automático no relatório, como rascunho que o gestor aprova ou edita; verificador de números em cada valor | Primeiro ganho real: deixar de escrever a análise de cada relatório; liga ao "comentário do gestor" que falta na V1 | Homologar |
| 5 | Resumo semanal ao cliente pelo WhatsApp com texto da IA, usando agendamento e envio existentes; começa com aprovação do gestor | O cliente percebe valor; o gestor não escreve; automático só depois, cliente por cliente | Aprovar a transição |
| 6 | Triagem diária ao gestor: regras fixas detectam, a IA explica; sem aviso se estiver tudo normal | Acabar com abrir conta por conta; maior devolução de horas | Definir limites de alerta |
| 7 | Perguntas e respostas no WhatsApp para cliente e gestor, com permissões por conta; nunca apagar mensagens recebidas | Tirar do gestor as perguntas repetitivas; vem depois por exigir tratar mensagens recebidas | Homologar |
| 8 | Pergunta mensal ao cliente: "quantas vendas vieram dos anúncios?" | Custo por venda real sem ler conversas privadas | Aprovar o texto |

Ordem entre as etapas 5 e 6 é escolha do responsável. Detalhamento técnico de cada etapa só ao chegar nela.

## 10. Passo a passo da etapa 2 (conta e chave da API) — links verificados em 12/10/2026

Feito pelo responsável. Nunca colar a chave em chat, commit, documento ou captura de tela.

1. Entrar ou criar a conta no Claude Console: https://platform.claude.com
2. Adicionar forma de pagamento/créditos e definir o limite mensal: https://platform.claude.com/settings/billing (seção "Spend limits" → "Set limit"/"Adjust limit"; sugestão inicial: US$ 20). Organizações novas podem começar numa faixa de avaliação com limites menores; o limite próprio nunca passa do teto da faixa.
3. Recomendado: criar um workspace só para este projeto, por exemplo "iGrow Reports": https://platform.claude.com/settings/workspaces (o workspace padrão não aceita limites próprios; os demais aceitam limite de gasto e de requisições).
4. Criar a chave: https://platform.claude.com/settings/keys → "Create key". Nome sugerido: `igrow-reports-producao`; escolher a expiração (sugestão: 1 ano, com lembrete de troca); "Linked account": você (ou conta de serviço, se disponível); escopo: o workspace do passo 3. A chave (`sk-ant-...`) aparece **uma única vez**; se perder, crie outra.
5. Guardar na Vercel: projeto → Settings → Environment Variables (https://vercel.com/docs/environment-variables). Nome `ANTHROPIC_API_KEY`, tipo Secret, ambiente Production (Preview opcional). Variáveis só valem para novos deploys: faça um novo deploy depois. Link provável do projeto, deduzido da URL de deploy e não verificado: https://vercel.com/i-grow-digital/i-grow-reports/settings/environment-variables
6. Local: acrescentar `ANTHROPIC_API_KEY=...` em `.env.local` na raiz (o git já ignora `.env*`).
7. Avisar "chave configurada" sem o valor. O assistente confere só a presença da variável, sem imprimi-la.
Vazou ou suspeita de vazamento: revogar em https://platform.claude.com/settings/keys e criar outra.

## 11. Revisão de 12/10/2026 (segunda análise externa): dados de nível 2 antes do comentário

Segunda conversa compartilhada do ChatGPT (análise do PDF de teste) apontou que a qualidade do comentário depende dos dados entregues à IA. Confirmado por teste real (etapa 1): sem comparação dos resultados com o período anterior e sem dados por campanha/anúncio, o texto fica correto porém genérico. Decisões do responsável:

1. **Camada de dados "nível 2" sobe na ordem**, antes de refinar o comentário. Serve ao PDF e à IA. Conteúdo: resultados por tipo contra o período anterior; desempenho por campanha e por anúncio; investimento por tipo de resultado; frequência (impressões ÷ alcance) atual e anterior. **Tudo calculado pelo código; a IA só recebe fatos.** Módulo: `src/modules/reports/report-facts.ts`.
2. **Rótulos de prova** em cada afirmação do texto: comprovado pelos dados, hipótese a investigar, informação insuficiente. A plataforma nunca diz "bom" ou "ruim" sem referência (período anterior, meta ou histórico).
3. **Formato do comentário em 5 destaques:** principal resultado positivo, maior problema, campanha que pede atenção, melhor oportunidade e ação mais importante para o próximo período.
4. **Perfil do cliente no cadastro, opcional e curto** (sugestão do responsável): nenhum campo obrigatório, porque nem todo cliente quer fornecer dados. Campos propostos: segmento, o que vende, onde atua, público-alvo, faixa de ticket médio (opcional), como atende os contatos (WhatsApp, telefone, loja) e o objetivo com os anúncios em texto livre (sem escolher "tipo de resultado": ver a regra de não existir resultado principal). As observações internas atuais continuam. Enquanto o perfil estiver incompleto, a tela do cliente e o bloco de análise mostram um aviso, como "Complete o perfil do cliente para receber comentários mais precisos", com indicador de progresso e sem bloquear nada. Só texto de negócio vai à IA, nunca nome, telefone ou dado pessoal de contatos. Implementação sugerida: tabela `client_profiles` 1:1 com `clients`, com as mesmas regras de acesso (RLS) dos clientes; a migração é aplicada pelo responsável.
5. Metas opcionais por tipo de resultado (ex.: custo por conversa aceitável) só entram depois, sem eleger um tipo como principal.

Ordem atual: (1) camada de dados nível 2 + PDF novo; (2) camada de IA com registro de uso e cota; (3) comentário em 5 destaques com rótulos de prova; (4) perfil do cliente no cadastro; (5) pergunta mensal de vendas; demais etapas como no plano.

Resquício a limpar: `AnalyticsDashboardData` ainda tem `primaryMetricKey` e `primaryActionType` (herança do conceito removido); remover junto com a coluna/função antiga do banco quando o responsável aprovar a migração.
