import { Breadcrumb, ChildrenSection, ContextCard, IdentityCard, OperationsCard, PerformanceGrid, ResultsSection, StateBadge, StateCard, type DetailProps } from "./parts";

/** Detalhes da CAMPANHA: identificação, veiculação, desempenho, resultados por tipo e os conjuntos de anúncios que a compõem. */
export function CampaignDetail(props: DetailProps) {
  const { entity } = props;
  return <article className="cdetail" aria-label={`Detalhes da campanha ${entity.name}`}>
    <header className="cdetail-head">
      <Breadcrumb {...props} />
      <div className="cdetail-title"><span className="cdetail-kicker">Campanha</span><h1 title={entity.name}>{entity.name}</h1><StateBadge entity={entity} /></div>
    </header>
    <div className="cdetail-grid">
      <div className="cdetail-main">
        <PerformanceGrid {...props} />
        <ResultsSection {...props} />
        <ChildrenSection {...props} title="Conjuntos de anúncios" emptyText="Nenhum conjunto de anúncios encontrado para esta campanha nas contas e no período selecionados." />
      </div>
      <aside className="cdetail-aside" aria-label="Informações da campanha">
        <OperationsCard clientId={props.clientId} entity={entity} />
        <IdentityCard entity={entity} parents={[]} />
        <StateCard entity={entity} data={props.data} />
        <ContextCard data={props.data} />
      </aside>
    </div>
  </article>;
}
