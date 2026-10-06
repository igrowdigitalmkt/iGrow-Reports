import type { TeamSnapshot } from "./admin";

// Fictitious team for the demo workspace. Never written to the database.
export const demoTeam: TeamSnapshot = {
  ready: true,
  members: [
    { userId: "demo-owner", email: "silvio@igrow.com.br", name: "Silvio", avatarUrl: null, role: "owner", joinedAt: "2026-08-01T12:00:00.000Z", lastSignInAt: "2026-10-06T11:20:00.000Z", modules: null },
    { userId: "demo-admin", email: "veronica@igrow.com.br", name: "Verônica Coelho", avatarUrl: null, role: "admin", joinedAt: "2026-08-10T12:00:00.000Z", lastSignInAt: "2026-10-05T19:02:00.000Z", modules: null },
    { userId: "demo-editor", email: "lucas@igrow.com.br", name: "Lucas Andrade", avatarUrl: null, role: "editor", joinedAt: "2026-09-02T12:00:00.000Z", lastSignInAt: "2026-10-06T09:45:00.000Z", modules: ["clientes", "relatorios", "agendamentos"] },
    { userId: "demo-viewer", email: "comercial@cliente.com.br", name: null, avatarUrl: null, role: "viewer", joinedAt: "2026-09-20T12:00:00.000Z", lastSignInAt: null, modules: ["visao_geral", "relatorios"] },
  ],
  invitations: [
    { id: "d9000000-0000-4000-8000-000000000001", email: "design@igrow.com.br", role: "editor", createdAt: "2026-10-04T12:00:00.000Z", expiresAt: "2026-10-11T12:00:00.000Z" },
  ],
};
