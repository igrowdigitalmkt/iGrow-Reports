-- Desempenho: a validação do fuso horário consultava a lista de fusos do Postgres (~0,4 s) em toda atualização da organização
-- (renomear, mudar logo...). Passa a validar só ao criar ou quando o fuso muda; a regra de validade continua a mesma.
-- Substitui apenas o corpo da função do gatilho existente; não altera tabelas nem dados.

create or replace function private.validate_agency()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.timezone is distinct from old.timezone then
    if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
      raise exception 'Fuso horário inválido.' using errcode = '22023';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
