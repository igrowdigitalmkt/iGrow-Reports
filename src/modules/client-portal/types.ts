export type ClientPortalPendingInvitation = {
  id: string;
  clientId: string;
  email: string;
  createdAt: string;
  expiresAt: string;
};

export type ClientPortalAdminAccess = {
  clientId: string;
  userId: string;
  email: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};
