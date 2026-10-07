import { requireAgencyContext } from "@/modules/agencies/context";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

// Conversations with unread messages, for the menu badge (archived ones do not count, as in WhatsApp).
export async function GET() {
  const context = await requireAgencyContext();
  const query = () => context.supabase.from("whatsapp_conversations").select("id", { count: "exact", head: true })
    .eq("agency_id", context.agency.id).gt("unread_count", 0);
  let { count, error } = await query().eq("archived", false);
  // Before migration 202610070014 there is no archived column.
  if (error) ({ count, error } = await query());
  return Response.json({ count: error ? 0 : count ?? 0 }, { headers });
}
