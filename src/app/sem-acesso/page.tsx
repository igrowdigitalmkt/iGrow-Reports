import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUserMemberships, requireUserSession } from "@/modules/agencies/context";
import { getClientPortalAccesses } from "@/modules/client-portal/context";
import { acceptPendingClientInvitations } from "@/modules/client-portal/invitations";
import { acceptPendingAgencyInvitations } from "@/modules/agencies/invitations";

export const metadata: Metadata = { title: "Acesso pendente", robots: { index: false, follow: false } };

// Routes a signed-in person without a workspace: pending invitations first, then the client
// area, otherwise the creation of their own workspace (which also explains invitations).
export default async function NoAccessPage() {
  const { supabase, user } = await requireUserSession();
  await acceptPendingAgencyInvitations(supabase);
  const memberships = await getUserMemberships(supabase, user.id);
  if (memberships.length > 0) redirect("/dashboard");
  // Client portal users have no agency membership; send them to their area.
  await acceptPendingClientInvitations(supabase);
  if ((await getClientPortalAccesses(supabase).catch(() => [])).length > 0) redirect("/cliente");
  redirect("/criar-espaco");
}
