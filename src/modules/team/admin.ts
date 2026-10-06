import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgencyRole, Database } from "@/types/database";

export type TeamMember = { userId: string; email: string; name: string | null; avatarUrl: string | null; role: AgencyRole; joinedAt: string; lastSignInAt: string | null; modules: string[] | null };
export type TeamInvitation = { id: string; email: string; role: AgencyRole; createdAt: string; expiresAt: string };
export type TeamSnapshot = { ready: boolean; members: TeamMember[]; invitations: TeamInvitation[] };

// Before migration 202610070007 the list functions do not exist: the page explains the update.
export async function loadTeam(supabase: SupabaseClient<Database>, agencyId: string, canManage: boolean): Promise<TeamSnapshot> {
  const { data, error } = await supabase.rpc("list_agency_members", { p_agency_id: agencyId });
  if (error || !data) return { ready: false, members: [], invitations: [] };
  const invitations = canManage ? (await supabase.rpc("list_agency_invitations", { p_agency_id: agencyId })).data ?? [] : [];
  return {
    ready: true,
    members: data.map(row => ({ userId: row.user_id, email: row.email, name: row.full_name, avatarUrl: row.avatar_url, role: row.role, joinedAt: row.joined_at, lastSignInAt: row.last_sign_in_at, modules: row.modules })),
    invitations: invitations.map(row => ({ id: row.id, email: row.email, role: row.role, createdAt: row.created_at, expiresAt: row.expires_at })),
  };
}

/** Modules the signed-in member may open (null = all). */
export async function loadOwnModules(supabase: SupabaseClient<Database>, agencyId: string, userId: string) {
  const { data, error } = await supabase.from("agency_member_permissions").select("modules").eq("agency_id", agencyId).eq("user_id", userId).maybeSingle();
  return error || !data ? null : data.modules;
}
