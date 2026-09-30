import type { AgencyRole } from "@/types/database";

export const roleLabels: Record<AgencyRole, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  editor: "Editor",
  viewer: "Leitor",
};

export function canManageAgency(role: AgencyRole) {
  return role === "owner" || role === "admin";
}

