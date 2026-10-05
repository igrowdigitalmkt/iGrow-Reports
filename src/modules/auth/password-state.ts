import "server-only";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

// Accounts created by an invite may sign in through an emailed link before ever
// choosing a password. Track completion in app_metadata (writable only with the
// service key) so those accounts are sent to password setup.
export function needsPasswordSetup(user: Pick<User, "invited_at" | "app_metadata"> | null | undefined) {
  return Boolean(user?.invited_at) && user?.app_metadata?.password_set !== true;
}

export async function markPasswordSet(user: Pick<User, "id" | "app_metadata">) {
  const service = createSupabaseServiceClient();
  if (!service) return;
  try {
    await service.auth.admin.updateUserById(user.id, { app_metadata: { ...user.app_metadata, password_set: true } });
  } catch {
    // Missing marker only means a later link sign-in offers password setup again.
  }
}
