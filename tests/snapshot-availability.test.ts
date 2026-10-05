import { expect,it,vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CollectionSchemaUnavailableError,requireCollectionRpc } from "@/modules/integrations/collection-schema-error";
import { SnapshotUnavailable } from "@/modules/client-portal/snapshot-unavailable";

it("classifies only a missing PostgREST function as schema unavailable",() => {
  expect(() => requireCollectionRpc({ code: "PGRST202" })).toThrow(CollectionSchemaUnavailableError);
  for (const code of ["42501","42883","PGRST301","PGRST205","57014","08006"]) {
    expect(() => requireCollectionRpc({ code })).not.toThrow();
  }
  expect(() => requireCollectionRpc(null)).not.toThrow();
});
it("shows a return path without metrics, collection requests or endless loading",() => {
  const html = renderToStaticMarkup(createElement(SnapshotUnavailable,{ clientId: "client" }));
  expect(html).toContain('href="/cliente/client"');
  expect(html).toContain("temporariamente indisponível");
  expect(html).not.toContain("Aguardando a análise completa");
  expect(html).not.toContain("Solicitar"); expect(html).not.toContain("Exportar");
  expect(html).not.toContain("snapshot-card"); expect(html).not.toContain("PGRST202");
});

const mocks = vi.hoisted(() => ({ access: vi.fn(),load: vi.fn() }));
vi.mock("@/modules/client-portal/context",() => ({ requireClientDashboardAccess: mocks.access }));
vi.mock("@/modules/client-portal/snapshot-dashboard-loader",() => ({ loadSnapshotDashboard: mocks.load }));
vi.mock("@/modules/client-portal/portal-shell",() => ({ ClientPortalShell: ({ children }: { children: unknown }) => children }));
vi.mock("@/modules/client-portal/snapshot-dashboard",() => ({ SnapshotDashboard: () => "confirmed-dashboard" }));
import SnapshotDashboardPage from "@/app/cliente/[clientId]/snapshots/page";
const props = { params: Promise.resolve({ clientId: "client" }),searchParams: Promise.resolve({}) };
function allowed() {
  mocks.access.mockResolvedValue({ supabase: "session",user: { email: "operator@example.test" },access: { client: { name: "Client" } },accesses: [],agencyMode: true,canCollect: true });
}
it("handles missing schema after authentication and preserves the client shell",async () => {
  allowed(); mocks.load.mockRejectedValue(new CollectionSchemaUnavailableError());
  const html = renderToStaticMarkup(await SnapshotDashboardPage(props));
  expect(html).toContain("temporariamente indisponível");
  expect(mocks.load).toHaveBeenCalledWith("session","client",{});
});
it("does not hide unexpected access or database failures in a setup message",async () => {
  allowed(); mocks.load.mockRejectedValue(new Error("database outage"));
  await expect(SnapshotDashboardPage(props)).rejects.toThrow("database outage");
});
it("does not bypass an authentication failure",async () => {
  mocks.load.mockClear(); mocks.access.mockRejectedValue(new Error("access denied"));
  await expect(SnapshotDashboardPage(props)).rejects.toThrow("access denied");
  expect(mocks.load).not.toHaveBeenCalled();
});
it("restores the regular dashboard when schema is available",async () => {
  allowed(); mocks.load.mockResolvedValue({ dateFrom: "2026-10-01",dateTo: "2026-10-03",selectedAccountIds: [] });
  expect(renderToStaticMarkup(await SnapshotDashboardPage(props))).toBe("confirmed-dashboard");
});
