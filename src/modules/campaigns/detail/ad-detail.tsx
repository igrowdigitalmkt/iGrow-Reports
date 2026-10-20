import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ancestorsOf } from "../detail";
import { entityPath } from "../routes";
import { Breadcrumb, ContextCard, CreativeCard, IdentityCard, OperationsCard, PerformanceGrid, ResultsSection, StateBadge, StateCard, type DetailProps } from "./parts";

/** Detalhes do ANÚNCIO: criativo (quando a Meta o devolve), conjunto e campanha de origem, veiculação e desempenho. */
export function AdDetail(props: DetailProps) {
  const { entity, clientId, data, search } = props;
  const parents = ancestorsOf(entity, data.rows);
  const adset = parents.find(item => item.level === "adset");
  return <article className="cdetail" aria-label={`Detalhes do anúncio ${entity.name}`}>
    <header className="cdetail-head">
      <Breadcrumb {...props} />
      <div className="cdetail-title"><span className="cdetail-kicker">Anúncio</span><h1 title={entity.name}>{entity.name}</h1><StateBadge entity={entity} /></div>
      {adset && <Link className="cdetail-back" href={`${entityPath(clientId, adset)}${search}`}><ArrowLeft size={14} />Voltar ao conjunto: {adset.name}</Link>}
    </header>
    <div className="cdetail-grid">
      <div className="cdetail-main">
        <PerformanceGrid {...props} />
        <ResultsSection {...props} />
      </div>
      <aside className="cdetail-aside" aria-label="Informações do anúncio">
        <OperationsCard clientId={clientId} entity={entity} />
        <CreativeCard entity={entity} />
        <IdentityCard entity={entity} parents={parents} />
        <StateCard entity={entity} data={data} />
        <ContextCard data={data} />
      </aside>
    </div>
  </article>;
}
