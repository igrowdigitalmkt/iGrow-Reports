import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { qrProfilePicture } from "@/modules/whatsapp-qr/server";

export const runtime = "nodejs";

/**
 * Profile photo of a conversation on the QR Code session, fetched from WhatsApp and passed through
 * without being stored. Official numbers do not expose customer photos: 404, and the screen keeps
 * the initials.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const id = z.uuid().safeParse((await params).conversationId);
  if (!id.success) return new Response(null, { status: 400 });
  const context = await requireAgencyContext();
  const { data: conversation } = await context.supabase.from("whatsapp_conversations").select("channel,remote_id")
    .eq("agency_id", context.agency.id).eq("id", id.data).maybeSingle();
  if (!conversation || conversation.channel !== "qr") return new Response(null, { status: 404 });
  const picture = await qrProfilePicture(context.agency.id, conversation.remote_id);
  // A missing photo is remembered for a while too, so the list does not keep asking.
  if (!picture) return new Response(null, { status: 404, headers: { "Cache-Control": "private, max-age=3600" } });
  return new Response(new Uint8Array(picture.bytes), { headers: {
    "Content-Type": picture.mime.startsWith("image/") ? picture.mime : "image/jpeg",
    "Cache-Control": "private, max-age=21600",
    "X-Content-Type-Options": "nosniff",
  } });
}
