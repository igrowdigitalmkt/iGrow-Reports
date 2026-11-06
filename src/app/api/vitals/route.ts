import { z } from "zod";
import { isReportedVital, vitalsRoute } from "@/lib/web-vitals";

export const runtime = "nodejs";

const schema = z.object({
  name: z.string().refine(isReportedVital),
  value: z.number().finite().min(0).max(600_000),
  rating: z.enum(["good", "needs-improvement", "poor"]).optional(),
  nav: z.string().max(30).optional(),
  route: z.string().max(120),
});

// Linha de base de velocidade real: cada medida vira uma linha de registro (procure por "web-vital" nos logs da Vercel).
// Sem login e sem dados pessoais: só o nome da medida, o valor e a tela (ids trocados por :id). CLS vem em milésimos.
export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > 1000) return new Response(null, { status: 413 });
  let json: unknown;
  try { json = JSON.parse(text); } catch { return new Response(null, { status: 400 }); }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return new Response(null, { status: 400 });
  const { name, value, rating, nav, route } = parsed.data;
  console.log(JSON.stringify({ tag: "web-vital", name, value, rating, nav, route: vitalsRoute(route) }));
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
