# Duplicação, criação, programação e edição avançada na Meta: o que falta

Planejamento técnico (21/10/2026). **Nada aqui está ligado à interface nem ao executor**; os contratos tipados e validações reutilizáveis já existem em `src/modules/campaigns/manual/duplication-contract.ts` (com testes), e o que não está implementado aparece nesta lista. Fontes oficiais consultadas em 20/10/2026 estão em `docs/CAMPANHAS_V1_CAPACIDADES_PLATAFORMAS.md`.

## 1. Duplicação (`POST /{id}/copies`)

| Item | Campanha | Conjunto | Anúncio |
|---|---|---|---|
| Endpoint oficial | `/{campaign_id}/copies` | `/{adset_id}/copies` | `/{ad_id}/copies` |
| Estado da cópia | `status_option=PAUSED` (padrão; a Groow só aceita PAUSED) | idem | idem |
| Cópia profunda | `deep_copy`: 3 filhos em chamada síncrona, 51 em assíncrona | idem (anúncios) | não se aplica |
| Pai de destino | não há | `campaign_id` (opcional) | `adset_id` (opcional) |
| Nome | `rename_options` (`ONLY_TOP_LEVEL_RENAME` padrão) | idem | idem; `creative_parameters` pode sobrescrever o criativo |
| Retorno | id da cópia | `copied_adset_id` e `ad_object_ids` | `copied_ad_id` |

**Já pronto:** schema estrito (`duplicateRequestSchema`: só PAUSED, destino coerente com o nível, sem campos livres) e planejamento (`planDuplication`: bloqueia cópia profunda acima do limite síncrono, nunca degrada em silêncio).

**Falta para entregar cada duplicação:**
1. Ação própria no executor (`duplicate_campaign`, `duplicate_adset`, `duplicate_ad`), **manual**, com preflight GET da origem, POST em `/copies` com corpo fixo (`status_option=PAUSED`, `deep_copy`, `rename_options`) e **verificação** lendo a cópia (existe, está PAUSED, conta e pai corretos).
2. Migração aditiva (tipos novos em `action_type`, id da cópia em coluna própria, mesma restrição "só origem manual") e atualização da sonda de prontidão.
3. Tela de **revisão das diferenças** antes de confirmar: campos que a cópia preserva e os que a Meta recalcula (objetivo legado → `OUTCOME_*` pode falhar; criativo idêntico; identidade e destino herdados). Nunca apresentar a cópia como equivalente sem essa revisão.
4. Tratamento de falha parcial da cópia profunda (itens copiados × não copiados) e de resultado desconhecido (nada de reenviar: o `copied_*_id` desconhecido pode já existir).
5. Critério de aceite: cópia criada pausada e conferida na Meta; ledger com origem e id da cópia; nenhuma cópia ativa; teste de lote.

## 2. Criação

**Campanha (primeiro caminho):** contrato `createCampaignSchema`: `name` validado, `objective` entre os `OUTCOME_*`, `special_ad_categories` obrigatório (declaração; não editável depois), `buying_type=AUCTION`, `status=PAUSED`, orçamento diário opcional. Falta: ação `create_campaign` no executor (POST na conta `/{act_id}/campaigns`), verificação por leitura, migração e tela por etapas com revisão.

**Conjunto:** exige campanha pai, orçamento (ou orçamento da campanha), `optimization_goal`, `billing_event`, programação, `targeting` válido (localização obrigatória) e dependências do objetivo. Faltam o contrato tipado da segmentação e a leitura das combinações permitidas por objetivo. Nunca iniciar ativo.

**Anúncio:** exige conjunto pai, criativo (`creative` novo ou existente), página/identidade (permissões adicionais: `pages_manage_ads` e acesso à página), destino e rastreamento. O criativo é imutável: alterar texto, título, CTA, mídia ou destino de um anúncio existente = criar **novo** criativo e associá-lo, mostrando antes/depois. Nada de troca silenciosa.

## 3. Programação e orçamento vitalício
- Campanha aceita `start_time`/`stop_time` e conjunto `start_time`/`end_time` por POST (documentação oficial). **Não confirmado:** regras de alteração depois que a entrega começou, interação com orçamento vitalício (exige data final) e fuso da conta. Falta: pesquisa dirigida, ações `set_*_schedule`, validação de datas no fuso da conta e, por mexer em gasto, aprovação específica sempre que a IA propuser.
- Orçamento vitalício: hoje reconhecido e bloqueado na edição ("altera apenas orçamento diário"). Falta: contrato `set_*_lifetime_budget` com limite e validação de término.

## 4. Edição avançada
- **Conjunto:** segmentação (Advantage+ muda o que é editável; omitir um campo não pode apagar configuração), posicionamentos, públicos (inclusão e exclusão) e estratégia de lance. Leitura resumida já existe (somente leitura); falta o contrato de escrita por campo e o diff antes/depois.
- **Anúncio:** criativo, texto, título, descrição, CTA, destino e rastreamento: fluxo "novo criativo" descrito acima.
- **Motivo de reprovação:** leitura resumida já existe (campos `ad_review_feedback`/`issues_info`); falta uma lista de motivos tipada por categoria.

## 5. Regras que valem para tudo
Origem manual × IA preservada (o banco já recusa a IA nas ações manuais novas); schema estrito e lista permitida; preflight ao vivo; idempotência; ledger; verificação por leitura; resultado desconhecido sem reenvio; capacidade só liberada pela sonda do banco; qualquer proposta da IA que possa afetar gasto exige aprovação humana específica.
