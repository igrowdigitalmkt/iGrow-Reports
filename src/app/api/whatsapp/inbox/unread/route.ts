import { requireAgencyContext } from "@/modules/agencies/context";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

// Conversations with unread messages, for the menu badge (0 without access or before the inbox migration).
export async function GET() {
  const context = await requireAgencyContext();
  const { count, error } = await context.supabase.from("whatsapp_conversations").select("id", { count: "exact", head: true })
    .eq("agency_id", context.agency.id).gt("unread_count", 0);
  return Response.json({ count: error ? 0 : count ?? 0 }, { headers });
}
