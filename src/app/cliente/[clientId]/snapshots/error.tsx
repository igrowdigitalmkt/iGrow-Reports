"use client";
export default function SnapshotError({ reset }: { reset: () => void }) {
  return <div className="client-alert" role="alert"><p>Não foi possível consultar a análise confirmada. Confira o período selecionado ou tente novamente.</p>
    <button type="button" onClick={reset}>Tentar novamente</button></div>;
}
