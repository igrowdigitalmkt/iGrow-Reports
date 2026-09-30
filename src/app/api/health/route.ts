export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ status: "ok", service: "igrow-reports", version: "0.1.0", checks: { application: "ok" } }, { headers: { "Cache-Control": "no-store" } });
}
