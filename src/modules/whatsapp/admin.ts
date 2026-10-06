import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientItem } from "@/modules/clients/schema";
import type { AdminReportVersion } from "@/modules/reports/types";
import type { Database } from "@/types/database";
import type { DeliveryItem } from "./deliveries-view";
import type { SendableRecipient } from "./send-report-dialog";
import type { WhatsAppSummary } from "./whatsapp-manager";

// Reads for the workspace pages, under the user's own RLS. Before the WhatsApp migration is
// applied the tables do not exist: the pages then behave as "not connected".
export async function loadWhatsAppSummary(supabase: SupabaseClient<Database>, agencyId: string): Promise<WhatsAppSummary> {
  const { data, error } = await supabase.from("whatsapp_connections").select("*").eq("agency_id", agencyId).maybeSingle();
  if (error || !data) return null;
  return { displayPhone: data.display_phone, verifiedName: data.verified_name, qualityRating: data.quality_rating,
    templateName: data.template_name, templateLanguage: data.template_language, lastCheckedAt: data.last_checked_at };
}

export async function loadSendableRecipients(supabase: SupabaseClient<Database>, agencyId: string): Promise<SendableRecipient[]> {
  const { data, error } = await supabase.from("client_recipients").select("id,client_id,name,phone,active,consent_status,unsubscribed_at")
    .eq("agency_id", agencyId).order("name");
  if (error || !data) return [];
  return data.map(row => {
    const reason = !row.active ? "inativo" : row.unsubscribed_at ? "descadastrado" : row.consent_status !== "granted" ? "sem autorização de recebimento" : null;
    return { id: row.id, clientId: row.client_id, name: row.name, phone: row.phone, authorized: reason === null, reason };
  });
}

export async function loadDeliveries(supabase: SupabaseClient<Database>, agencyId: string, clients: ClientItem[], versions: AdminReportVersion[]): Promise<DeliveryItem[]> {
  const { data, error } = await supabase.from("report_deliveries").select("id,client_id,recipient_id,report_version_id,status,error_code,error_message,status_at,created_at")
    .eq("agency_id", agencyId).order("created_at", { ascending: false }).limit(200);
  if (error || !data?.length) return [];
  const { data: recipients } = await supabase.from("client_recipients").select("id,name,phone").eq("agency_id", agencyId)
    .in("id", [...new Set(data.map(row => row.recipient_id))]);
  const brDate = (value: string) => value.split("-").reverse().join("/");
  return data.map(row => {
    const recipient = recipients?.find(item => item.id === row.recipient_id);
    const version = versions.find(item => item.id === row.report_version_id);
    return {
      id: row.id, createdAt: row.created_at, statusAt: row.status_at, status: row.status, errorMessage: row.error_message, errorCode: row.error_code,
      clientName: clients.find(client => client.id === row.client_id)?.name ?? "Cliente",
      recipientName: recipient?.name ?? "Destinatário", recipientPhone: recipient?.phone ?? "",
      reportTitle: version?.title ?? "Relatório", period: version ? `${brDate(version.dateFrom)} a ${brDate(version.dateTo)}` : null,
    };
  });
}
