export type DashboardPeriod = "7d" | "30d";
export type ReportStatus = "Entregue" | "Aguardando aprovação" | "Processando";
export interface ReportRow { id: string; client: string; initials: string; color: string; type: string; date: string; status: ReportStatus; recipients: number; }
export interface DashboardSnapshot {
  activeClients: number;
  reportsGenerated: number | null;
  accepted: number | null;
  delivered: number | null;
  read: number | null;
  accessed: number | null;
  upcoming: number | null;
  labels: string[];
  generatedSeries: number[];
  deliveredSeries: number[];
  reports: ReportRow[];
}

export function deliveryRate(accepted: number | null, delivered: number | null): string {
  if (accepted === null || delivered === null || accepted <= 0 || delivered < 0 || delivered > accepted) return "Sem dados";
  return `${(delivered / accepted * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function emptySnapshot(activeClients = 0): DashboardSnapshot {
  return { activeClients, reportsGenerated: null, accepted: null, delivered: null, read: null, accessed: null, upcoming: null, labels: [], generatedSeries: [], deliveredSeries: [], reports: [] };
}

