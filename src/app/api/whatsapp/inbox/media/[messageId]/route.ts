import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { downloadOfficialMedia } from "@/modules/whatsapp/server";
import { downloadQrMedia } from "@/modules/whatsapp-qr/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MEDIA_KINDS = new Set(["image", "video", "audio", "document", "sticker"]);

/**
 * Photo, video, audio or document of an inbox message, fetched from WhatsApp when opened and
 * passed through without being stored. The member's own access rules decide what can be opened.
 */
export async function GET(request: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const id = z.uuid().safeParse((await params).messageId);
  if (!id.success) return new Response("Arquivo inválido.", { status: 400 });
  const context = await requireAgencyContext();
  const { data: message } = await context.supabase.from("whatsapp_messages").select("*").eq("agency_id", context.agency.id).eq("id", id.data).maybeSingle();
  if (!message || !MEDIA_KINDS.has(message.kind)) return new Response("Arquivo não encontrado.", { status: 404 });
  const { data: conversation } = await context.supabase.from("whatsapp_conversations").select("*").eq("agency_id", context.agency.id).eq("id", message.conversation_id).maybeSingle();
  if (!conversation) return new Response("Arquivo não encontrado.", { status: 404 });
  const service = createSupabaseServiceClient();
  if (!service) return new Response("Indisponível.", { status: 503 });

  try {
    let bytes: ArrayBuffer | Buffer;
    let mime: string;
    if (conversation.channel === "official") {
      if (!message.media_id || !conversation.whatsapp_connection_id) return new Response("Este arquivo chegou antes de a plataforma guardar a referência dele.", { status: 404 });
      ({ bytes, mime } = await downloadOfficialMedia(service, { agencyId: context.agency.id, connectionId: conversation.whatsapp_connection_id, mediaId: message.media_id }));
    } else {
      const ref = message.media_ref && typeof message.media_ref === "object" && !Array.isArray(message.media_ref) ? message.media_ref as { type: string; data: Record<string, unknown> } : null;
      const file = await downloadQrMedia(context.agency.id, { externalId: message.external_id, remoteId: conversation.remote_id, isGroup: conversation.is_group, fromMe: message.direction === "out", ref });
      bytes = Buffer.from(file.base64, "base64");
      mime = file.mime;
    }
    const download = new URL(request.url).searchParams.has("baixar");
    const name = (message.media_name ?? `whatsapp-${message.kind}`).replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 120) || "arquivo";
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": mime.split(";")[0] || "application/octet-stream",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      // Private: stays in this browser for a few minutes, never in shared caches.
      "Cache-Control": "private, no-store, max-age=0",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return new Response("O WhatsApp não entregou este arquivo agora. Ele pode ter expirado.", { status: 502 });
  }
}
