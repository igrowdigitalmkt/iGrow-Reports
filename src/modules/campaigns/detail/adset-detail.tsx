import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ancestorsOf } from "../detail";
import { entityPath } from "../routes";
import { Breadcrumb, ChildrenSection, ContextCard, IdentityCard, PerformanceGrid, ResultsSection, StateBadge, StateCard, type DetailProps } from "./parts";

/** Detalhes do CONJUNTO DE ANÚNCIOS: pertence a uma campanha (com retorno a ela) e reúne os anúncios do conjunto. */
export function AdSetDetail(props: DetailProps) {
  const { entity, clientId, data, search } = props;
  const parents = ancestorsOf(entity, data.rows);
  const campaign = parents.find(item => item.level === "campaign");
  return <article className="cdetail" aria-label={`Detalhes do conjunto de anúncios ${entity.name}`}>
    <header className="cdetail-head">
      <Breadcrumb {...props} />
      <div className="cdetail-title"><span className="cdetail-kicker">Conjunto de anúncios</span><h1 title={entity.name}>{entity.name}</h1><StateBadge entity={entity} /></div>
      {campaign && <Link className="cdetail-back" href={`${entityPath(clientId, campaign)}${search}`}><ArrowLeft size={14} />Voltar à campanha: {campaign.name}</Link>}
    </header>
    <div className="cdetail-grid">
      <div className="cdetail-main">
        <PerformanceGrid {...props} />
        <ResultsSection {...props} />
        <ChildrenSection {...props} title="Anúncios do conjunto" emptyText="Nenhum anúncio encontrado para este conjunto nas contas e no período selecionados." />
      </div>
      <aside className="cdetail-aside" aria-label="Informações do conjunto">
        <IdentityCard entity={entity} parents={parents} />
        <StateCard entity={entity} data={data} />
        <ContextCard data={data} />
      </aside>
    </div>
  </article>;
}
