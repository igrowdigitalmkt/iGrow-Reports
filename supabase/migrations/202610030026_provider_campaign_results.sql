-- Provider-selected campaign outcomes override secondary action totals.
do $$
declare v_definition text;
begin
  v_definition:=pg_get_functiondef('private.result_values(jsonb,boolean)'::regprocedure);
  v_definition:=replace(v_definition,'begin', $body$begin
  if p_values->>'result:provider_known'='1' then
    select coalesce(sum(value::text::numeric),0) into v_total
      from jsonb_each(p_values) where key like 'result:provider:%' and value<>'null'::jsonb;
    return v_values||jsonb_build_object('primary_results',v_total,
      'cost_per_result',(p_values->>'spend')::numeric/nullif(v_total,0));
  end if;
$body$);
  execute v_definition;
end;
$$;
