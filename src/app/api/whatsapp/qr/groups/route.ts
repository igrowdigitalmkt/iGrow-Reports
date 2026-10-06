import { requireAgencyContext } from "@/modules/agencies/context";
import { listQrGroups } from "@/modules/whatsapp-qr/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Groups of the connected number, offered as targets in the schedule editor.
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  const context = await requireAgencyContext();
  if (context.role === "viewer") return Response.json({ groups: [] }, { headers });
  try {
    return Response.json({ groups: await listQrGroups(context.agency.id) }, { headers });
  } catch {
    return Response.json({ error: "Não foi possível listar os grupos agora." }, { status: 502, headers });
  }
}
