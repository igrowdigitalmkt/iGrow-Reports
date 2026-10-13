-- Remove o aviso antigo "Defina o resultado principal do cliente...": o conceito de resultado principal não existe mais.
-- Só altera essa linha da função; se o texto não for encontrado, a migração falha sem mudar nada.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('private.client_analytics_compute(uuid,date,date,uuid[])'::regprocedure);
  v_new := replace(v_def,
    $old$v_warnings:=array_append(v_warnings,'Defina o resultado principal do cliente para acompanhar conversões e custo por resultado.');$old$,
    'null;');
  if v_new = v_def then raise exception 'Aviso antigo não encontrado em private.client_analytics_compute'; end if;
  execute v_new;
end;
$$;
