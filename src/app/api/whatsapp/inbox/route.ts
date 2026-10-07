import { requireAgencyContext } from "@/modules/agencies/context";
import { loadInbox } from "@/modules/whatsapp/inbox-read";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

// Conversation list of every number; polled by the WhatsApp screen (route handlers run in parallel).
export async function GET() {
  const context = await requireAgencyContext();
  return Response.json(await loadInbox(context.supabase, context.agency.id), { headers });
}
