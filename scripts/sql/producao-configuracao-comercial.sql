-- CONFIGURAÇÃO COMERCIAL DA V1 (NÃO EXECUTADA EM PRODUÇÃO). Executar UMA vez, com autorização, no SQL Editor do Supabase de produção.
-- Cria: teste gratuito (privado), Start, Pro (recomendado), Scale e Personalizado (privado, sem checkout) e publica. NÃO liga o teste gratuito.
-- NÃO altera organizações existentes (seguem "legadas", sem plano e com acesso integral) e NÃO liga cobrança real (live_enabled continua false).
-- Preços em centavos. Orçamento de IA em centavos de dólar (recomendação financeira: ver docs/LANCAMENTO_V1.md). Janela: ~7 s.
begin;

insert into private.plans(id,key,name,description,visibility,sellable,recommended,sort_order) values
  ('c0000000-0000-4000-8000-000000000001','teste-gratuito','Teste gratuito','Teste gratuito de 7 dias, sem cartão.','private',false,false,1),
  ('c0000000-0000-4000-8000-000000000002','start','Start','Para quem está começando a organizar os relatórios.','public',true,false,10),
  ('c0000000-0000-4000-8000-000000000003','pro','Pro','O mais escolhido: mais clientes, equipe e automações.','public',true,true,20),
  ('c0000000-0000-4000-8000-000000000004','scale','Scale','Para operações maiores, com mais clientes e contas.','public',true,false,30),
  ('c0000000-0000-4000-8000-000000000005','personalizado','Personalizado','Contratação mediante orçamento (sem checkout automático).','private',false,false,40);

insert into private.plan_versions(id,plan_id,version,price_monthly_cents,price_yearly_cents) values
  ('c1000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',1,null,null),
  ('c1000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000002',1,7990,79900),
  ('c1000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000003',1,14990,149900),
  ('c1000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000004',1,27990,279900),
  ('c1000000-0000-4000-8000-000000000005','c0000000-0000-4000-8000-000000000005',1,null,null);

-- Direitos: (plano, clientes, contas de anúncio, equipe, números oficiais de WhatsApp, automações, orçamento mensal de IA em centavos de US$)
-- Portal do cliente e IA em todos. Equipe conta o proprietário (1 = só o proprietário). Conexão por QR Code é uma por organização, fora do limite.
insert into private.plan_version_entitlements(plan_version_id,key,enabled,limit_value,unlimited)
select v.id, l.key, true, l.val, false
from (values
  ('c1000000-0000-4000-8000-000000000001', 3, 9, 1, 1, 3, 50),     -- teste gratuito (7 dias, IA com orçamento reduzido)
  ('c1000000-0000-4000-8000-000000000002', 10, 30, 1, 1, 5, 200),   -- Start
  ('c1000000-0000-4000-8000-000000000003', 25, 75, 3, 2, 20, 400),  -- Pro
  ('c1000000-0000-4000-8000-000000000004', 60, 180, 6, 3, 60, 800), -- Scale
  ('c1000000-0000-4000-8000-000000000005', 60, 180, 6, 3, 60, 800)  -- Personalizado: base igual ao Scale; ajustes por concessão do Super Admin
) as p(version_id, clients, ad_accounts, team, whatsapp, automations, ai_cents)
join private.plan_versions v on v.id = p.version_id::uuid
cross join lateral (values ('clients', p.clients), ('ad_accounts', p.ad_accounts), ('team_members', p.team), ('whatsapp_numbers', p.whatsapp),
  ('report_automations', p.automations), ('ai_budget_usd_cents', p.ai_cents)) as l(key, val);
insert into private.plan_version_entitlements(plan_version_id,key,enabled,limit_value,unlimited)
select v.id, f.key, true, null, false from private.plan_versions v cross join (values ('ai_assistant'), ('client_portal')) as f(key)
where v.id in ('c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000004','c1000000-0000-4000-8000-000000000005');

update private.plan_versions set status='published', published_at=now() where id::text like 'c1000000-0000-4000-8000-00000000000%';
update private.plans set current_version_id = ('c1000000-0000-4000-8000-00000000000' || right(id::text, 1))::uuid where id::text like 'c0000000-0000-4000-8000-00000000000%';
-- O teste gratuito NÃO é apontado aqui de propósito: ele só é ligado DEPOIS da contratação real validada, pelo Super Admin (Configurações comerciais >
-- Plano usado no teste = "Teste gratuito"). Enquanto não for ligado, organizações novas nascem com acesso restrito (podem contratar, não ganham teste).
-- live_enabled NÃO é alterado por este script.

-- CONFERÊNCIA (leitura)
select p.name, p.visibility, p.sellable, p.recommended, v.price_monthly_cents, v.price_yearly_cents,
  (select string_agg(e.key || coalesce('=' || e.limit_value::text, ''), ', ' order by e.key) from private.plan_version_entitlements e where e.plan_version_id = v.id) direitos
from private.plans p join private.plan_versions v on v.plan_id = p.id order by p.sort_order;
select (select count(*) from private.agency_plan_assignments) atribuicoes_devem_continuar_0,
  (select trial_plan_version_id is null from private.billing_settings) trial_deve_estar_desligado, (select live_enabled from private.billing_settings) live_enabled_deve_ser_false;
commit;
