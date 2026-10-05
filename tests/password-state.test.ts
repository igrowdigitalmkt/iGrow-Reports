import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ update: vi.fn(), service: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: mocks.service }));
import { markPasswordSet, needsPasswordSetup } from "@/modules/auth/password-state";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.service.mockReturnValue({ auth: { admin: { updateUserById: mocks.update } } });
});

it("asks invited accounts without the password marker to set a password", () => {
  expect(needsPasswordSetup({ invited_at: "2026-10-05T15:52:00Z", app_metadata: { provider: "email" } })).toBe(true);
  expect(needsPasswordSetup({ invited_at: "2026-10-05T15:52:00Z", app_metadata: { provider: "email", password_set: true } })).toBe(false);
  expect(needsPasswordSetup({ invited_at: undefined, app_metadata: {} })).toBe(false);
  expect(needsPasswordSetup(null)).toBe(false);
});

it("keeps existing app metadata when marking the password as set", async () => {
  await markPasswordSet({ id: "user", app_metadata: { provider: "email", providers: ["email"] } });
  expect(mocks.update).toHaveBeenCalledWith("user", { app_metadata: { provider: "email", providers: ["email"], password_set: true } });
});

it("never blocks password setup when the marker cannot be written", async () => {
  mocks.update.mockRejectedValue(new Error("unavailable"));
  await expect(markPasswordSet({ id: "user", app_metadata: {} })).resolves.toBeUndefined();
});
