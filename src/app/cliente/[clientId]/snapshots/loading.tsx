export default function SnapshotLoading() {
  return <div className="sk-stack" role="status" aria-busy="true" aria-label="Carregando a análise por conta">
    <span className="sk" style={{ display: "block", width: 260, height: 26 }} />
    <span className="sk" style={{ display: "block", width: "100%", height: 64, borderRadius: 12 }} />
    <span className="sk" style={{ display: "block", width: "100%", height: 320, borderRadius: 12 }} />
  </div>;
}
