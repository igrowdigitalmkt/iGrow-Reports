import { requireAgencyContext } from "@/modules/agencies/context";
import { loadInbox, loadInboxChanges } from "@/modules/whatsapp/inbox-read";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

// Conversation list of every number; polled by the WhatsApp screen (route handlers run in parallel).
export async function GET(request: Request) {
  const context = await requireAgencyContext();
  const since = new URL(request.url).searchParams.get("since");
  const validSince = since && /^\d{4}-\d{2}-\d{2}T/.test(since) && Number.isFinite(Date.parse(since))
    && Date.parse(since) <= Date.now() + 60_000;
  const result = validSince
    ? await loadInboxChanges(context.supabase, context.agency.id, since)
    : await loadInbox(context.supabase, context.agency.id);
  return Response.json(result, { headers });
}
