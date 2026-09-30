/**
 * Temporary hand-maintained schema contract matching supabase/migrations.
 * Not generated: replace after applying migrations with
 * `supabase gen types typescript --local > src/types/database.ts`.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type AgencyRole = "owner" | "admin" | "editor" | "viewer";

type AgencyRow = {
  id: string;
  name: string;
  timezone: string;
  logo_path: string | null;
  membership_version: number;
  created_at: string;
  updated_at: string;
};
type MembershipRow = { agency_id: string; user_id: string; role: AgencyRole; created_at: string };
type InvitationRow = {
  id: string; agency_id: string; email: string; role: AgencyRole; token_hash: string;
  invited_by: string | null; expires_at: string; accepted_at: string | null;
  accepted_by: string | null; revoked_at: string | null; created_at: string;
};
type ClientRow = {
  id: string; agency_id: string; name: string; logo_path: string | null; notes: string | null;
  archived_at: string | null; created_by: string | null; created_at: string; updated_at: string;
};
type AuditRow = {
  id: string; agency_id: string; actor_id: string | null; action: string;
  entity_id: string | null; metadata: Json; created_at: string;
};
type RecipientRow = import("@/modules/clients/recipient-schema").Recipient & { agency_id: string; client_id: string; created_at: string; updated_at: string };
type ConsentEventRow = import("@/modules/clients/recipient-schema").ConsentEvent & { agency_id: string; client_id: string };
type Table<Row, Insert, Update, Relationships extends Array<{
  foreignKeyName: string; columns: string[]; isOneToOne: boolean;
  referencedRelation: string; referencedColumns: string[];
}> = []> = { Row: Row; Insert: Insert; Update: Update; Relationships: Relationships };

export type Database = {
  public: {
    Tables: {
      client_recipients: Table<RecipientRow, never, never>;
      recipient_consent_events: Table<ConsentEventRow, never, never>;
      agencies: Table<AgencyRow, Pick<AgencyRow, "name"> & Partial<AgencyRow>, Partial<AgencyRow>>;
      agency_users: Table<MembershipRow, Omit<MembershipRow, "created_at"> & Partial<MembershipRow>, Partial<MembershipRow>, [{
        foreignKeyName: "agency_users_agency_id_fkey";
        columns: ["agency_id"]; isOneToOne: false; referencedRelation: "agencies"; referencedColumns: ["id"];
      }]>;
      agency_invitations: Table<InvitationRow, Pick<InvitationRow, "agency_id" | "email" | "role" | "token_hash" | "expires_at"> & Partial<InvitationRow>, Partial<InvitationRow>>;
      clients: Table<ClientRow, Pick<ClientRow, "agency_id" | "name"> & Partial<ClientRow>, Partial<ClientRow>>;
      audit_logs: Table<AuditRow, Pick<AuditRow, "agency_id" | "action"> & Partial<AuditRow>, Partial<AuditRow>>;
    };
    Views: { [_ in never]: never };
    Functions: {
      save_client_recipient: { Args: { p_agency_id: string; p_client_id: string; p_id: string | null; p_name: string; p_phone: string; p_active: boolean }; Returns: string };
      set_recipient_consent: { Args: { p_agency_id: string; p_client_id: string; p_recipient_id: string; p_phone: string; p_granted: boolean; p_source: string; p_occurred_at: string | null }; Returns: string };
      accept_agency_invitation: { Args: { p_token: string }; Returns: string };
      issue_agency_invitation: {
        Args: { p_agency_id: string; p_email: string; p_role: AgencyRole; p_expires_in_hours?: number };
        Returns: { invitation_id: string; token: string; expires_at: string }[];
      };
      revoke_agency_invitation: { Args: { p_invitation_id: string }; Returns: undefined };
      set_agency_member_role: { Args: { p_agency_id: string; p_user_id: string; p_role: AgencyRole }; Returns: undefined };
      remove_agency_member: { Args: { p_agency_id: string; p_user_id: string }; Returns: undefined };
    };
    Enums: { agency_role: AgencyRole };
    CompositeTypes: { [_ in never]: never };
  };
};
