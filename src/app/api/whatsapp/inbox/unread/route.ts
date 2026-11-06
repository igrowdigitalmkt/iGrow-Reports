import { requireAgencyContext } from "@/modules/agencies/context";
import { unreadConversationCount } from "@/modules/whatsapp/unread-count";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

// Conversations with unread messages, for the menu badge (archived ones do not count, as in WhatsApp).
export async function GET() {
  const context = await requireAgencyContext();
  return Response.json({ count: await unreadConversationCount(context.supabase, context.agency.id) }, { headers });
}
