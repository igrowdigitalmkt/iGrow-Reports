# Arquitetura de dados multi-plataforma

## Objetivo

Atender 100 clientes com várias contas e plataformas sem bloquear a interface, misturar escopos ou apresentar coleta parcial como dado definitivo.

## Regra central

A aplicação web lê snapshots confirmados. Workers coletam dados em segundo plano, registram o payload original, normalizam os fatos e só promovem uma versão para leitura depois das validações obrigatórias.

A ausência de um dado, um dado zero, um erro de coleta e uma métrica indisponível são estados diferentes. Nenhum estado desconhecido pode ser convertido em `ACTIVE`, zero ou sucesso.

## Contrato de uma coleta

Toda execução é identificada por uma chave idempotente composta por:

`tenant/client + connection + provider + external_account + date_from + date_to + level + api_version + contract_version`

Uma execução possui:

- `queued`: criada e aguardando worker;
- `collecting`: worker executando;
- `partial`: alguns recortes ainda não confirmados;
- `confirmed`: todos os recortes e validações obrigatórias concluídos;
- `failed`: não foi possível concluir após as tentativas permitidas;
- `superseded`: substituída por snapshot confirmado mais recente.

Falhas temporárias (429, timeout e 5xx) geram nova tentativa com backoff. Falhas permanentes (permissão, conta inválida, token revogado e parâmetro inválido) encerram a tentativa e geram alerta acionável.

## Camadas de persistência

1. **Raw payload**: resposta original do provedor, com retenção e redaction definidos.
2. **Normalized facts**: entidades e métricas com IDs externos, nível, período, fuso, moeda, atribuição, origem e versão do contrato.
3. **Read model**: projeção otimizada para o dashboard, apontando para o último snapshot confirmado.

O banco relacional é a fonte de verdade. Cache pode reduzir latência, mas nunca confirma ou altera um dado.

## Metadados obrigatórios de métrica

Toda métrica normalizada deve manter:

- provedor e chave nativa;
- conta, cliente e conexão;
- entidade e nível (conta, campanha, conjunto ou anúncio);
- `date_from`, `date_to` e timezone;
- moeda e unidade;
- janela de atribuição;
- valor e estado (`available`, `zero`, `unavailable`, `error`);
- `collected_at` e `provider_updated_at`, quando disponíveis;
- regra de agregação e versão do mapeamento.

Métricas sem comparabilidade comprovada permanecem separadas por plataforma. Não há conversão automática de moeda, fuso ou definição de resultado.

## Validações antes da promoção

Um snapshot só pode ser confirmado quando:

- cliente, conexão e conta pertencem ao mesmo escopo autorizado;
- a paginação foi esgotada ou registrada como falha;
- todos os recortes esperados foram processados;
- os níveis não foram misturados;
- os totais de conta e entidades respeitam a tolerância definida;
- moedas, fusos e janelas de atribuição são compatíveis;
- status de entrega desconhecidos não foram tratados como ativos;
- a origem e a data da coleta estão presentes.

Se a validação falhar, o sistema mantém o último snapshot confirmado, marca a nova execução como parcial ou falha e aciona a coleta novamente.

## Read model e experiência

A tela deve responder com o último snapshot confirmado, sua idade e sua origem. Durante uma atualização, exibe `Atualização em andamento` e continua disponível. Se não houver snapshot confirmado, exibe `Dados ainda não disponíveis` e o estado da coleta, nunca zeros inventados.

## Isolamento e capacidade

A fila limita concorrência por provedor e por conta, mas permite concorrência entre clientes. Um token expirado ou limite de uma conta não pode impedir a coleta das outras 99.

As prioridades recomendadas são:

1. período recente e conta aberta na tela;
2. últimos dois dias, sujeitos a ajustes de atribuição;
3. janela de 7 a 30 dias;
4. histórico e backfill.

## Observabilidade mínima

Registrar métricas operacionais para:

- idade do snapshot por conta;
- duração e tentativas por job;
- 429, 5xx, timeout e erros de autenticação;
- recortes ausentes;
- divergência entre níveis;
- contas sem atualização dentro do SLA;
- falhas de normalização;
- quantidade de snapshots parciais e confirmados.

Esses indicadores são responsabilidade do sistema e da equipe de desenvolvimento. O gestor de tráfego não deve ter que descobrir inconsistências manualmente.

## Ordem de implementação

1. schema de jobs, raw payloads, fatos normalizados e snapshots;
2. worker idempotente e fila durável;
3. projeções do dashboard e frescor;
4. migração gradual do coletor Meta atual;
5. adaptadores Google/YouTube, TikTok e LinkedIn;
6. reconciliação, auditoria e teste de carga com 100 clientes.
