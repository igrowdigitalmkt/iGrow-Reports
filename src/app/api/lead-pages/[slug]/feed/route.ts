import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { loadLeadFeed, openLeadPage } from "@/modules/lead-pages/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow" };

// Atualização ao vivo da página privada: o código do link vai no cabeçalho (nunca na URL) e é conferido a cada pedido.
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const service = createSupabaseServiceClient();
  if (!service) return Response.json({ error: "unavailable" }, { status: 503, headers });
  const page = await openLeadPage(service, slug, request.headers.get("x-lead-code"));
  if (!page) return Response.json({ error: "not_found" }, { status: 404, headers });
  const feed = await loadLeadFeed(service, page);
  return feed ? Response.json(feed, { headers }) : Response.json({ error: "unavailable" }, { status: 503, headers });
}
