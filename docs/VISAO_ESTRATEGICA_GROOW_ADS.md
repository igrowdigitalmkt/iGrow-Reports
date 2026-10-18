# Groow Ads — visão estratégica e diretriz permanente de produto

**Decisão do proprietário: 18/10/2026.** Este documento é a referência principal para estratégia, priorização, UX, posicionamento, IA, arquitetura e novas funcionalidades da Groow Ads. É uma **diretriz de produto**, não uma afirmação de que todas as capacidades descritas já existem.

## 1. A tese que define a Groow Ads

**A Groow Ads não existe para oferecer ferramentas que o usuário precisa operar. Existe para executar, com inteligência artificial, o trabalho de marketing que hoje dependeria do usuário.**

A facilidade de criar dashboards, relatórios, integrações e aplicativos com IA/vibe coding tornou o acesso a funcionalidades comuns insuficiente como diferencial sustentável. Um painel que apresenta números, um WhatsApp integrado ou uma automação configurável são recursos de apoio — não a essência comercial.

A Groow Ads deve operar como uma **inteligência executora de marketing e publicidade**: conhece o negócio, interpreta dados confiáveis, decide o que fazer dentro de objetivos e limites definidos e **realiza ações reais nas plataformas conectadas**. Analisa, planeja, cria, otimiza, acompanha e corrige continuamente.

**Proposta de valor:** o cliente informa uma vez o contexto e os objetivos, autoriza escopos de atuação e deixa a Groow Ads assumir o máximo possível da execução. O software é a infraestrutura da inteligência, não o trabalho a ser aprendido pelo cliente.

**Regra de ouro:** a Groow Ads deve fazer pelo usuário, e não simplesmente mostrar ao usuário como fazer.

## 2. O que é produto principal e o que é suporte

**Produto principal:** execução delegada e contínua da operação publicitária, começando por Meta Ads e avançando de acordo com as permissões e capacidades reais das demais integrações.

**Infraestrutura de apoio:** dashboards, relatórios, métricas, WhatsApp, notificações, chat de IA, área do cliente, automações, integrações e Super Admin. São importantes, mas seu valor está em permitir que a inteligência execute e demonstre resultados. Não devem consumir o roadmap apenas para acrescentar mais botões.

O sucesso não se mede por quantas funcionalidades existem, mas por **tarefas efetivamente realizadas, tempo de trabalho devolvido, decisões executadas com rastreabilidade e melhoria dos resultados frente aos objetivos do negócio**.

A experiência desejada não é “entre no sistema todos os dias e aprenda a usá-lo”. É “conte o que sua empresa precisa; a Groow Ads trabalha e informa o que fez, por quê e quais resultados observou”.

## 3. Jornada ideal: cadastrar uma vez, acompanhar o trabalho acontecendo

1. **Conhecer o negócio, sem burocracia.** Obter progressivamente ofertas/produtos, diferencial, região, públicos, metas, orçamento disponível, indicadores relevantes, ativos criativos e restrições. Reutilizar dados conectados e perguntar somente o que fizer falta. O briefing é uma memória viva, não um questionário que precisa ser repetido.
2. **Conectar os canais e delegar escopos.** O usuário conecta as contas e define previamente as ações que a Groow Ads pode realizar, faixas de orçamento, limites e exceções. Permissões são explícitas, revogáveis e restritas à organização/conta correta; não pedir aprovação para cada ação rotineira quando ela já está autorizada dentro desses limites.
3. **Observar e compreender.** Reunir dados confiáveis de campanhas, contexto do negócio, histórico, metas e, quando disponível, informações legítimas sobre vendas/conversões reais. Separar fatos, hipóteses e incertezas.
4. **Decidir e executar.** A IA identifica prioridades e produz um plano de ação. Um executor seguro faz as alterações de fato nas APIs das plataformas: orçamento, ativação/pausa, criação de campanhas, público, estratégia ou outras operações tecnicamente suportadas, de acordo com o escopo delegado.
5. **Verificar e aprender.** Confirmar o estado efetivamente aplicado na API, registrar o antes/depois, acompanhar a performance, detectar efeitos inesperados e ajustar o plano. Nunca tratar “solicitação enviada” como “ação executada com sucesso”.
6. **Prestar contas sem exigir operação manual.** Informar proativamente o que fez, o motivo, o gasto e o impacto observado; chamar o usuário somente para decisões excepcionais, falta de dados, conflitos de metas ou permissões insuficientes.

**O usuário gerencia objetivos e exceções; a Groow Ads gerencia a execução.**

## 4. Exemplos da autonomia pretendida

- **Criar campanhas:** a partir de objetivo, oferta, região, público e material disponível, estruturar e configurar campanhas/conjuntos/anúncios reais; preparar criativos/textos quando a capacidade existir; publicar somente quando houver permissão e pré-condições.
- **Otimizar investimentos:** redistribuir ou ajustar orçamento de campanhas/conjuntos conforme metas, performance, volume e limites já delegados; respeitar teto total, janelas de aprendizagem, limites de plataforma e incerteza estatística.
- **Otimizar estratégia:** identificar saturação, custo fora de meta, segmentos com oportunidade e problemas de entrega; executar mudanças elegíveis de público, posicionamento, status ou estratégia, registrando o efeito.
- **Proteger a operação:** detectar anomalias de custo, queda de conversão, falha de rastreamento ou interrupção de anúncio e agir dentro dos limites (por exemplo, pausar a parte afetada), sem depender de alguém abrir o dashboard.
- **Executar experimentos:** propor e operacionalizar testes controlados de anúncios, públicos e criativos; acompanhar critérios de sucesso e encerrar testes sem evidência, evitando mudanças simultâneas que impeçam entender o resultado.
- **Fechar o ciclo até vendas reais:** quando houver dados confiáveis e autorizados, aproveitar resultados de CRM/vendas e conversões qualificadas para orientar a otimização e, quando tecnicamente elegível, devolver eventos válidos às plataformas de anúncios.

**Atenção técnica:** nem toda operação é mutável em todo provedor, conta ou estado. Por exemplo, mudar o objetivo de uma campanha existente pode exigir **criar uma campanha substituta**, não editar o objetivo diretamente. Verificar a API e as permissões reais antes de prometer ou executar.

## 5. Requisito comercial: a primeira oferta precisa fazer, não apenas analisar

O proprietário determinou que **uma parte substancial da execução por IA deve existir ANTES do primeiro lançamento comercial divulgado**. Não basta IA que comenta relatórios, gera insights ou recomenda ações para um humano realizar.

Critério mínimo a buscar para a primeira oferta pública:

- Uma jornada real completa para pelo menos **um canal de anúncios**: briefing/contexto → diagnóstico → plano → ação permitida na conta conectada → verificação da alteração → acompanhamento → histórico compreensível.
- Incluir **ações reais de escrita** nas plataformas, não apenas simulação: por exemplo, ajuste controlado de orçamento, pausa/reativação elegível e criação de campanha (ao menos uma via completa com publicação autorizada). A seleção final depende da viabilidade, das permissões de API e da homologação.
- O proprietário deve conseguir configurar **delegação contínua** para ações rotineiras dentro de limites, sem confirmar uma a uma. Ações fora do envelope, irreversíveis, de risco elevado ou não cobertas pela autorização são bloqueadas ou encaminhadas para aprovação.
- Em ambiente real, provar ao menos uma execução bem-sucedida e o monitoramento posterior, sem afirmar ganho de performance que não foi demonstrado.
- Diferenciar sempre: **planejado / implementado / testado em ambiente controlado / homologado com API real / disponível comercialmente**.

Não declarar essas capacidades prontas sem conferir o código, as permissões de escrita (por exemplo Meta `ads_management` e requisitos de revisão) e o resultado efetivo. A disponibilidade da API, do aplicativo e de cada escopo pode impedir ou adiar operações específicas; nesse caso explicar o bloqueio e propor a menor alternativa que entregue execução de verdade.

## 6. Arquitetura de uma IA que age com segurança

- **Planejador + ferramentas + executor:** a IA interpreta o contexto e seleciona operações estruturadas. O executor faz a chamada real à API; o modelo não recebe chaves privilegiadas nem opera diretamente sobre dados de outras organizações.
- **Fatos determinísticos:** métricas, custos, comparações, conversões e limites vêm das fontes confirmadas e de cálculos auditáveis; a IA interpreta, decide e redige, mas não inventa resultados numéricos.
- **Autonomia por política:** autorização antecipada por organização, usuário, conta, tipo de ação, orçamento, alcance, horários e condições. Escopos revogáveis; respeitar direitos do plano, permissões reais das APIs e política comercial.
- **Limites efetivos antes de executar:** teto de gasto e variação por ação/período, validação de orçamento total, evitar alterações conflitantes e impedir loops de otimização. Maior autonomia não significa ausência de controles.
- **Execução resiliente:** fila, idempotência, deduplicação, tratamento de falha, consulta de estado real após a alteração, trilha de auditoria e, quando possível, reversão ou compensação.
- **Aprendizado e memória:** armazenar objetivos, contexto, ações, resultados e decisões para não recomeçar a cada sessão. Mudanças anteriores devem influenciar decisões futuras, sem prometer causalidade sem evidência.
- **Isolamento e privacidade:** nunca atuar em outra organização, usar dados ou conversar com terceiros sem base/permissão adequada; manter RLS e LGPD. Respeitar as restrições específicas de WhatsApp registradas em `AGENTS.md`.
- **Transparência proporcional:** a autorização é parte natural do onboarding, não o argumento central da venda. O usuário vê o que a Groow Ads fez, os critérios, o que falhou e como interromper a autonomia; não recebe alertas irrelevantes a cada ação autorizada.

## 7. O filtro obrigatório para qualquer nova ideia

Antes de implementar ou sugerir uma funcionalidade, responder:

1. **Que trabalho concreto do usuário esta capacidade elimina?**
2. **Ela executa uma ação ou apenas exibe informação/sugere trabalho?** Se só exibe, qual ação habilita diretamente?
3. **O que a Groow Ads consegue iniciar ou concluir sozinha depois do briefing e da delegação?**
4. **De quais dados verificáveis, permissões, limites e integrações depende?**
5. **Como comprovar execução, qualidade, custo e impacto sem inventar resultados?**
6. **Existe um caminho muito mais simples para entregar a mesma autonomia com a arquitetura atual?**

Uma novidade que adiciona telas e configuração, mas não reduz trabalho real, tende a ter prioridade menor que uma capacidade de execução.

## 8. Ideias para explorar proativamente, não promessas de V1

Estas hipóteses devem ser avaliadas e propostas ativamente pelos agentes de desenvolvimento, inclusive quando o usuário não as tiver imaginado. Não são funcionalidades aprovadas automaticamente para implementação.

- **Gestor de campanhas por objetivo de negócio:** “quero aumentar agendamentos com até R$ X” → sistema constrói e opera plano contínuo, não apenas uma campanha isolada.
- **Fila autônoma de experimentos:** a IA mantém e executa um backlog de hipóteses de crescimento, uma a uma, com condições de parada, orçamento e aprendizado histórico.
- **Orçamento vivo:** o sistema ajusta a distribuição de investimento dentro de limites fixados, priorizando resultados confiáveis e evitando oscilações por ruído.
- **Sinal de venda qualificada:** combinar os eventos de conversão realmente confirmados com a performance dos anúncios; reduzir otimização por leads de baixo valor quando existirem dados para isso.
- **Memória estratégica por negócio:** entender sazonalidade, margem, ofertas, objeções, públicos já testados e decisões anteriores; deixar de testar repetidamente hipóteses descartadas.
- **Modo proteção:** agir para conter desperdício comprovável, falhas de veiculação ou gastos anormais, com regras conservadoras que não interrompam indiscriminadamente campanhas úteis.
- **Execução orientada por lacunas:** quando faltarem criativos, tracking, contexto ou permissão, a IA prepara tudo o que consegue e pede apenas a informação/ação humana mínima que destrava o restante.
- **Relatório de trabalho realizado:** em vez de um PDF centrado em métricas, apresentar ações executadas, motivos, verificações, custo e efeito observado — inclusive quando a decisão correta foi não alterar nada.

## 9. Como medir se estamos entregando a promessa

**Métricas principais:** horas de operação poupadas por organização; percentual de tarefas propostas que viraram ações confirmadas; tempo até a primeira ação útil; taxa de ações bem-sucedidas; incidentes/reversões; resultados de negócio com comparações honestas.

**Métricas auxiliares:** número de dashboards acessados, relatórios gerados e mensagens enviadas. Não confundir uso intenso da interface com sucesso do produto.

**Posicionamento comercial:** vender “trabalho de marketing executado por uma IA dentro dos objetivos e limites da empresa”, não “uma plataforma com dezenas de ferramentas e um chatbot”.

## 10. Prioridade deste documento e condições atuais

Esta decisão de 18/10/2026 **atualiza e prevalece estrategicamente** sobre os planos históricos que tratavam a Groow Ads/iGrow Reports como produto centrado em relatórios e reservavam ações de IA exclusivamente para uma V2 indefinida. Preservar esses documentos como histórico técnico, sem reescrever o passado.

**Não interpretar esta visão como autorização para alterar campanhas reais, ampliar gastos, enviar mensagens, aplicar migrations ou publicar versões sem o escopo operacional e as autorizações correspondentes.** Ela orienta arquitetura, roadmap e sugestões; a delegação de cada cliente é configurada explicitamente no produto.

Estado conhecido na decisão: há dashboards, relatórios, análise de IA, assinaturas e integrações em produção, mas **não foi comprovado aqui que exista um agente com permissão de escrita executando otimizações reais em Meta/Google**. O primeiro trabalho de desenvolvimento deve identificar o menor caminho para entregar esse ciclo de ação e homologá-lo, em vez de aprimorar telas por inércia.

Em caso de conflito entre esta diretriz e textos estratégicos mais antigos, prevalece este documento para **visão e prioridade do produto**; regras de segurança, obrigações financeiras, permissões, restrições de dados e políticas de operação continuam obrigatórias.
