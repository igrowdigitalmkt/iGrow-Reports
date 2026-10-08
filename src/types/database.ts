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
type ClientUserRow = {
  agency_id: string; client_id: string; user_id: string; active: boolean;
  created_by: string | null; created_at: string; updated_at: string;
};
type IntegrationCollectionJobRow = {
  id: string; client_id: string; connection_id: string; provider: string; external_account_id: string;
  date_from: string; date_to: string; entity_level: "account" | "campaign" | "adset" | "ad";
  api_version: string; contract_version: number; idempotency_key: string;
  status: "queued" | "collecting" | "partial" | "confirmed" | "failed" | "superseded";
  priority: number; attempt_count: number; retry_epoch_attempt: number; next_attempt_at: string; last_error_code: string | null;
  last_error_message: string | null; started_at: string | null; completed_at: string | null;
  created_at: string; updated_at: string;
};
type IntegrationRawPayloadRow = { id: string; job_id: string; provider: string; endpoint: string; request_fingerprint: string | null; response_payload: Json; http_status: number | null; provider_updated_at: string | null; collected_at: string; created_at: string };
type IntegrationSnapshotRow = { id: string; job_id: string; attempt_count: number | null; client_id: string; provider: string; external_account_id: string; date_from: string; date_to: string; entity_level: "account" | "campaign" | "adset" | "ad"; status: "partial" | "confirmed" | "failed" | "superseded"; currency: string | null; timezone_name: string | null; attribution_window: string | null; payload: Json; reconciliation: Json; collected_at: string; created_at: string };
type IntegrationProviderHealthRow = { id: string; integration_id: string; provider: string; status: "unknown" | "healthy" | "degraded" | "blocked"; last_success_at: string | null; last_failure_at: string | null; last_error_code: string | null; consecutive_failures: number; avg_latency_ms: number | null; updated_at: string };
type IntegrationRow = {
  id: string; agency_id: string; provider: "meta" | "google" | "tiktok" | "linkedin" | "youtube" | "whatsapp" | "qstash";
  connection_status: "disconnected" | "connected" | "error";
  health_status: "unknown" | "healthy" | "degraded" | "error";
  last_checked_at: string | null; last_success_at: string | null; last_error_at: string | null;
  last_error_code: string | null; created_by: string | null; created_at: string; updated_at: string;
};
type IntegrationSecretRow = {
  agency_id: string; integration_id: string; secret_kind: string; key_id: string;
  nonce_b64: string; ciphertext_b64: string; auth_tag_b64: string;
  created_at: string; updated_at: string;
};
type MetaConnectionRow = {
  id: string; agency_id: string; integration_id: string; client_id: string | null;
  label: string | null; external_user_id: string | null;
  scopes: string[]; metadata: Json; connected_at: string | null;
  last_accounts_sync_at: string | null; created_at: string; updated_at: string;
};
type MetaAdAccountRow = {
  id: string; agency_id: string; meta_connection_id: string; external_id: string; name: string;
  currency: string; timezone_name: string; account_status: string | null; business_name: string | null; business_id: string | null;
  archived_at: string | null; last_synced_at: string | null; created_at: string; updated_at: string;
};
type ClientAdAccountRow = {
  agency_id: string; client_id: string; ad_account_id: string; active: boolean;
  created_by: string | null; created_at: string; updated_at: string;
};
type MetaDailyInsightRow = {
  agency_id: string; ad_account_id: string; insight_date: string;
  level: "account" | "campaign" | "adset" | "ad"; external_entity_id: string;
  parent_external_id: string | null; entity_name: string | null; objective: string | null;
  captured_status: string | null; spend: number; impressions: number; reach: number | null;
  link_clicks: number | null; api_version: string; attribution_setting: string | null;
  collected_at: string; metadata: Json;
};
type MetaDailyActionRow = {
  agency_id: string; ad_account_id: string; insight_date: string;
  level: "account" | "campaign" | "adset" | "ad"; external_entity_id: string;
  action_type: string; action_value: number; value_amount: number | null; collected_at: string;
};
type MetaCollectionRunRow = {
  agency_id: string; client_id: string; ad_account_id: string;
  date_from: string; date_to: string; status: "complete" | "failed";
  insight_count: number; action_count: number; collected_at: string;
  levels: string[]; error_code: string | null;
};
type MetaPeriodInsightRow = {
  agency_id: string; client_id: string; ad_account_id: string; date_from: string; date_to: string;
  reach: number | null; frequency: number | null; unique_clicks: number | null;
  metadata: Json; api_version: string; collected_at: string;
};
type MetricDefinitionRow = {
  key: string; label: string; description: string;
  unit: "currency" | "integer" | "percent" | "ratio";
  source: string; formula: string | null; aggregation: string;
  desirable_direction: "up" | "down" | "neutral"; display_precision: number;
  definition_version: number; active: boolean; created_at: string;
};
type ClientMetricMappingRow = {
  agency_id: string; client_id: string; primary_metric_key: string; primary_action_type: string;
  revenue_action_type: string | null; mapping_version: number; updated_by: string | null;
  created_at: string; updated_at: string;
};
type AuditRow = {
  id: string; agency_id: string; actor_id: string | null; action: string;
  entity_id: string | null; metadata: Json; created_at: string;
};
type ReportTemplateRow = {
  id: string; agency_id: string; name: string; description: string | null;
  kind: "leads" | "conversations" | "sales" | "custom"; archived_at: string | null;
  created_by: string | null; created_at: string; updated_at: string;
};
type ReportTemplateVersionRow = {
  id: string; agency_id: string; template_id: string; version_number: number;
  config: Json; created_by: string | null; created_at: string;
};
type ReportRow = {
  id: string; agency_id: string; client_id: string; title: string;
  template_id: string | null; created_by: string | null; created_at: string;
  archived_at: string | null;
};
type ReportVersionRow = {
  id: string; agency_id: string; report_id: string; client_id: string;
  version_number: number; template_version_id: string | null; date_from: string;
  date_to: string; currency: string | null; timezone_name: string | null;
  state: "ready" | "published" | "superseded"; configuration_snapshot: Json;
  data_collected_at: string | null; generated_at: string; published_at: string | null;
  created_by: string | null; created_at: string;
};
type ReportDataSnapshotRow = {
  id: string; agency_id: string; report_version_id: string; summary_json: Json;
  quality_status: "complete" | "warning" | "blocked"; source_api_version: string | null;
  collected_at: string | null; created_at: string;
};
type ReportMetricRow = {
  agency_id: string; report_version_id: string; metric_key: string; label: string;
  unit: "currency" | "integer" | "percent" | "ratio"; numeric_value: number | null;
  display_precision: number; definition_version: number; created_at: string;
};

type RecipientRow = import("@/modules/clients/recipient-schema").Recipient & {
  agency_id: string; client_id: string; created_at: string; updated_at: string
};
type ConsentEventRow = import("@/modules/clients/recipient-schema").ConsentEvent & {
  agency_id: string; client_id: string
};
type Table<Row, Insert, Update, Relationships extends Array<{
  foreignKeyName: string; columns: string[]; isOneToOne: boolean;
  referencedRelation: string; referencedColumns: string[];
}> = []> = { Row: Row; Insert: Insert; Update: Update; Relationships: Relationships };

export type ClientMetricSummaryRow = {
  client_id: string;
  date_from: string;
  date_to: string;
  data_status: string;
  compatibility_issue: string | null;
  currency: string | null;
  timezone_name: string | null;
  ad_account_count: number;
  spend: number | null;
  impressions: number | null;
  link_clicks: number | null;
  primary_metric_key: string | null;
  primary_results: number | null;
  attributed_revenue: number | null;
  ctr_link: number | null;
  cpc_link: number | null;
  cpm: number | null;
  cost_per_result: number | null;
  roas: number | null;
  latest_data_date: string | null;
};

export type WhatsAppConnectionRow = {
  agency_id: string; integration_id: string; waba_id: string; phone_number_id: string;
  display_phone: string | null; verified_name: string | null; quality_rating: string | null;
  template_name: string | null; template_language: string | null; template_status: string | null;
  last_checked_at: string | null; created_at: string; updated_at: string;
  // Added by migration 202610070009; absent before it is applied.
  token_expires_at?: string | null;
  // Added by migration 202610070010 (several numbers per workspace); absent before it.
  id?: string; label?: string | null; coexistence?: boolean;
};
export type ReportDeliveryStatus = "pending" | "sending" | "accepted" | "sent" | "delivered" | "read" | "failed" | "uncertain" | "cancelled";
export type ReportDeliveryRow = {
  id: string; agency_id: string; client_id: string; recipient_id: string; report_version_id: string | null; channel: "whatsapp";
  // Added by migration 202610070010 (scheduled sends through an official number).
  automation_run_id?: string | null; whatsapp_connection_id?: string | null;
  template_name: string; template_language: string; status: ReportDeliveryStatus; wamid: string | null;
  error_code: string | null; error_message: string | null; status_at: string; created_by: string | null; created_at: string; updated_at: string;
};

export type ReportPeriodKey = "yesterday" | "last_7d" | "last_14d" | "last_30d" | "this_month" | "last_month";
export type ReportFrequency = "daily" | "weekly" | "monthly";
export type ReportAutomationRow = {
  id: string; agency_id: string; client_id: string; name: string; message_template: string; period_key: ReportPeriodKey;
  frequency: ReportFrequency; weekdays: number[]; month_day: number; send_time: string; timezone: string; channel: "whatsapp";
  active: boolean; next_run_at: string | null; last_run_at: string | null; created_by: string | null; created_at: string; updated_at: string;
  // Added by migration 202610070010: QR Code session (free text) or one official number (template + PDF).
  sender?: "qr" | "official"; whatsapp_connection_id?: string | null;
};
export type ReportAutomationTargetRow = {
  id: string; agency_id: string; automation_id: string; client_id: string; recipient_id: string | null; group_id: string | null; group_name: string | null; created_at: string;
};
export type ReportAutomationRunStatus = "running" | "sent" | "partial" | "failed" | "skipped";
export type ReportAutomationRunRow = {
  id: string; agency_id: string; automation_id: string; scheduled_for: string; status: ReportAutomationRunStatus; date_from: string | null; date_to: string | null;
  message_text: string | null; sent_count: number; failed_count: number; error_message: string | null; created_at: string; finished_at: string | null;
  trigger: "schedule" | "manual";
};
export type AutomationMessageStatus = "sent" | "delivered" | "read" | "failed";
export type WhatsAppConversationRow = {
  id: string; agency_id: string; channel: "qr" | "official"; whatsapp_connection_id: string | null; channel_key: string; remote_id: string;
  is_group: boolean; title: string | null; client_id: string | null; favorite: boolean; unread_count: number;
  last_message_at: string | null; last_message_preview: string | null; last_message_direction: "in" | "out" | null; last_message_kind: string | null;
  last_message_status: "pending" | "sent" | "delivered" | "read" | "failed" | null; last_inbound_at: string | null; created_at: string; updated_at: string;
  // Added by migration 202610070014.
  archived?: boolean;
};
export type WhatsAppMessageRow = {
  id: string; agency_id: string; conversation_id: string; external_id: string; direction: "in" | "out"; kind: string;
  body: string | null; media_name: string | null; media_mime: string | null; author: string | null;
  status: "pending" | "sent" | "delivered" | "read" | "failed" | null; sent_at: string; created_at: string;
  // Added by migration 202610070012.
  media_id?: string | null;
  // Added by migration 202610070013.
  media_ref?: Json | null;
};
export type AutomationMessageRow = {
  id: string; agency_id: string; run_id: string; automation_id: string; client_id: string; recipient_id: string | null; group_id: string | null;
  destination_label: string; message_id: string | null; status: AutomationMessageStatus; error_message: string | null; sent_at: string; delivered_at: string | null; read_at: string | null;
};
export type MessageTemplateSegment = "geral" | "mensagens" | "vendas" | "leads" | "seguidores" | "trafego" | "reconhecimento";
export type MessageTemplateRow = {
  id: string; agency_id: string; name: string; segment: MessageTemplateSegment; channel: "whatsapp" | "whatsapp_pdf" | "email"; subject: string | null; body: string; created_by: string | null; created_at: string; updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      integration_collection_jobs: Table<IntegrationCollectionJobRow, Partial<IntegrationCollectionJobRow>, Partial<IntegrationCollectionJobRow>>;
      integration_raw_payloads: Table<IntegrationRawPayloadRow, Partial<IntegrationRawPayloadRow>, Partial<IntegrationRawPayloadRow>>;
      integration_snapshots: Table<IntegrationSnapshotRow, Partial<IntegrationSnapshotRow>, Partial<IntegrationSnapshotRow>>;
      integration_provider_health: Table<IntegrationProviderHealthRow, Partial<IntegrationProviderHealthRow>, Partial<IntegrationProviderHealthRow>>;
      meta_dashboard_scopes: Table<{ agency_id: string; client_id: string; scope_key: string; date_from: string; date_to: string; payload: Json; collected_at: string }, { agency_id: string; client_id: string; scope_key: string; date_from: string; date_to: string; payload: Json; collected_at?: string }, { payload?: Json; collected_at?: string }>;
      client_recipients: Table<RecipientRow, never, never>;
      recipient_consent_events: Table<ConsentEventRow, never, never>;
      agencies: Table<AgencyRow, Pick<AgencyRow, "name"> & Partial<AgencyRow>, Partial<AgencyRow>>;
      agency_users: Table<MembershipRow, Omit<MembershipRow, "created_at"> & Partial<MembershipRow>, Partial<MembershipRow>, [{
        foreignKeyName: "agency_users_agency_id_fkey";
        columns: ["agency_id"]; isOneToOne: false; referencedRelation: "agencies"; referencedColumns: ["id"];
      }]>;
      agency_invitations: Table<InvitationRow, Pick<InvitationRow, "agency_id" | "email" | "role" | "token_hash" | "expires_at"> & Partial<InvitationRow>, Partial<InvitationRow>>;
      clients: Table<ClientRow, Pick<ClientRow, "agency_id" | "name"> & Partial<ClientRow>, Partial<ClientRow>>;
      client_users: Table<ClientUserRow, never, never, [{
        foreignKeyName: "client_users_agency_id_client_id_fkey";
        columns: ["agency_id", "client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["agency_id", "id"];
      }]>;
      integrations: Table<IntegrationRow, Pick<IntegrationRow, "agency_id" | "provider"> & Partial<IntegrationRow>, Partial<IntegrationRow>>;
      meta_connections: Table<MetaConnectionRow, Pick<MetaConnectionRow, "agency_id" | "integration_id"> & Partial<MetaConnectionRow>, Partial<MetaConnectionRow>>;
      meta_ad_accounts: Table<MetaAdAccountRow, Pick<MetaAdAccountRow, "agency_id" | "meta_connection_id" | "external_id" | "name" | "currency" | "timezone_name"> & Partial<MetaAdAccountRow>, Partial<MetaAdAccountRow>>;
      client_ad_accounts: Table<ClientAdAccountRow, Pick<ClientAdAccountRow, "agency_id" | "client_id" | "ad_account_id"> & Partial<ClientAdAccountRow>, Partial<ClientAdAccountRow>>;
      meta_daily_insights: Table<MetaDailyInsightRow, Pick<MetaDailyInsightRow, "agency_id" | "ad_account_id" | "insight_date" | "level" | "external_entity_id" | "spend" | "impressions" | "api_version"> & Partial<MetaDailyInsightRow>, Partial<MetaDailyInsightRow>>;
      meta_daily_actions: Table<MetaDailyActionRow, Pick<MetaDailyActionRow, "agency_id" | "ad_account_id" | "insight_date" | "level" | "external_entity_id" | "action_type"> & Partial<MetaDailyActionRow>, Partial<MetaDailyActionRow>>;
      meta_collection_runs: Table<MetaCollectionRunRow, Pick<MetaCollectionRunRow, "agency_id" | "client_id" | "ad_account_id" | "date_from" | "date_to" | "status"> & Partial<MetaCollectionRunRow>, Partial<MetaCollectionRunRow>>;
      meta_period_insights: Table<MetaPeriodInsightRow, Pick<MetaPeriodInsightRow, "agency_id" | "client_id" | "ad_account_id" | "date_from" | "date_to" | "api_version"> & Partial<MetaPeriodInsightRow>, Partial<MetaPeriodInsightRow>>;
      metric_definitions: Table<MetricDefinitionRow, never, never>;
      client_metric_mappings: Table<ClientMetricMappingRow, never, never>;
      report_templates: Table<ReportTemplateRow, Pick<ReportTemplateRow, "agency_id" | "name"> & Partial<ReportTemplateRow>, Partial<ReportTemplateRow>>;
      report_template_versions: Table<ReportTemplateVersionRow, Pick<ReportTemplateVersionRow, "agency_id" | "template_id" | "version_number" | "config"> & Partial<ReportTemplateVersionRow>, never>;
      reports: Table<ReportRow, never, never>;
      report_versions: Table<ReportVersionRow, never, never>;
      report_data_snapshots: Table<ReportDataSnapshotRow, never, never>;
      report_metrics: Table<ReportMetricRow, never, never>;
      audit_logs: Table<AuditRow, Pick<AuditRow, "agency_id" | "action"> & Partial<AuditRow>, Partial<AuditRow>>;
      whatsapp_connections: Table<WhatsAppConnectionRow, Pick<WhatsAppConnectionRow, "agency_id" | "integration_id" | "waba_id" | "phone_number_id"> & Partial<WhatsAppConnectionRow>, Partial<WhatsAppConnectionRow>>;
      report_deliveries: Table<ReportDeliveryRow, Pick<ReportDeliveryRow, "agency_id" | "client_id" | "recipient_id" | "template_name" | "template_language"> & Partial<ReportDeliveryRow>, Partial<ReportDeliveryRow>>;
      report_automations: Table<ReportAutomationRow, Pick<ReportAutomationRow, "agency_id" | "client_id" | "name" | "message_template"> & Partial<ReportAutomationRow>, Partial<ReportAutomationRow>>;
      report_automation_targets: Table<ReportAutomationTargetRow, Pick<ReportAutomationTargetRow, "agency_id" | "automation_id" | "client_id"> & Partial<ReportAutomationTargetRow>, Partial<ReportAutomationTargetRow>>;
      agency_member_permissions: Table<{ agency_id: string; user_id: string; modules: string[]; updated_at: string }, never, never>;
      whatsapp_conversations: Table<WhatsAppConversationRow, never, never>;
      whatsapp_messages: Table<WhatsAppMessageRow, never, never>;
      automation_messages: Table<AutomationMessageRow, Pick<AutomationMessageRow, "agency_id" | "run_id" | "automation_id" | "client_id" | "destination_label"> & Partial<AutomationMessageRow>, Partial<AutomationMessageRow>>;
      message_templates: Table<MessageTemplateRow, Pick<MessageTemplateRow, "agency_id" | "name" | "body"> & Partial<MessageTemplateRow>, Partial<MessageTemplateRow>>;
      report_automation_runs: Table<ReportAutomationRunRow, Pick<ReportAutomationRunRow, "agency_id" | "automation_id" | "scheduled_for"> & Partial<ReportAutomationRunRow>, Partial<ReportAutomationRunRow>>;
    };
    Views: { [_ in never]: never };
    Functions: {
      list_client_snapshot_accounts: { Args: { p_client_id: string }; Returns: { id: string; connection_id: string; external_id: string; name: string; currency: string; timezone_name: string }[] };
      get_confirmed_collection_snapshot: { Args: { p_client_id: string; p_connection_id: string; p_provider: string; p_external_account_id: string; p_date_from: string; p_date_to: string; p_entity_level: string; p_api_version: string; p_contract_version: number }; Returns: Json };
      authorize_integration_collection_job: { Args: { p_job_id: string; p_attempt_count: number }; Returns: string };
      record_integration_provider_health: { Args: { p_integration_id: string; p_provider: string; p_ok: boolean; p_error_code?: string | null; p_latency_ms?: number | null }; Returns: IntegrationProviderHealthRow };
      finish_integration_collection_job: { Args: { p_job_id: string; p_attempt_count: number; p_status: string; p_next_attempt_at?: string | null; p_error_code?: string | null; p_error_message?: string | null; p_completed_at?: string | null }; Returns: undefined };
      persist_integration_collection_result: { Args: { p_job_id: string; p_attempt_count: number; p_status: string; p_metrics: Json; p_reconciliation: Json; p_raw_payloads: Json }; Returns: string };
      request_meta_collection_refresh: { Args: { p_client_id: string; p_connection_id: string; p_date_from: string; p_date_to: string; p_api_version: string; p_contract_version: number; p_scopes: Json }; Returns: Json };
      claim_integration_collection_job: { Args: { p_now?: string }; Returns: { job_id: string; client_id: string; connection_id: string; idempotency_key: string; provider: string; external_account_id: string; date_from: string; date_to: string; entity_level: string; attempt_count: number; api_version: string; contract_version: number; retry_attempt_count?: number }[] };
      claim_meta_collection_job: { Args: { p_now?: string }; Returns: { job_id: string; client_id: string; connection_id: string; idempotency_key: string; provider: string; external_account_id: string; date_from: string; date_to: string; entity_level: string; attempt_count: number; api_version: string; contract_version: number; retry_attempt_count?: number }[] };
      list_agency_members: { Args: { p_agency_id: string }; Returns: { user_id: string; email: string; full_name: string | null; avatar_url: string | null; role: AgencyRole; joined_at: string; last_sign_in_at: string | null; modules: string[] | null }[] };
      list_agency_invitations: { Args: { p_agency_id: string }; Returns: { id: string; email: string; role: AgencyRole; created_at: string; expires_at: string }[] };
      set_agency_member_modules: { Args: { p_agency_id: string; p_user_id: string; p_modules: string[] | null }; Returns: undefined };
      accept_pending_agency_invitations: { Args: Record<string, never>; Returns: number };
      create_own_agency: { Args: { p_name: string; p_timezone?: string }; Returns: string };
      get_client_analytics: {
        Args: { p_client_id: string; p_date_from: string; p_date_to: string; p_ad_account_ids?: string[] | null };
        Returns: Json;
      };
      persist_meta_insight_slice: {
        Args: { p_agency_id: string; p_client_id: string; p_ad_account_id: string; p_date_from: string; p_date_to: string; p_insights: Json; p_actions: Json };
        Returns: { insight_count: number; action_count: number }[];
      };
      persist_meta_detailed_slice: {
        Args: { p_agency_id: string; p_client_id: string; p_ad_account_id: string; p_date_from: string; p_date_to: string; p_insights: Json; p_actions: Json };
        Returns: { insight_count: number; action_count: number }[];
      };
      list_client_portal_clients: {
        Args: Record<PropertyKey, never>;
        Returns: { id: string; agency_id: string; name: string; logo_path: string | null; archived_at: string | null }[];
      };
      list_agency_client_portal_accesses: {
        Args: { p_agency_id: string };
        Returns: { client_id: string; user_id: string; email: string; active: boolean; created_at: string; updated_at: string }[];
      };
      set_client_user_access: {
        Args: { p_agency_id: string; p_client_id: string; p_user_id: string; p_active: boolean };
        Returns: undefined;
      };
      set_client_user_access_by_email: {
        Args: { p_agency_id: string; p_client_id: string; p_email: string; p_active: boolean };
        Returns: string;
      };
      invite_client_portal_user: {
        Args: { p_agency_id: string; p_client_id: string; p_email: string };
        Returns: { invitation_id: string | null; existing_account: boolean; already_active: boolean }[];
      };
      accept_client_portal_invitations: {
        Args: Record<PropertyKey, never>;
        Returns: string[];
      };
      revoke_client_portal_invitation: {
        Args: { p_agency_id: string; p_invitation_id: string };
        Returns: undefined;
      };
      warm_client_analytics: {
        Args: { p_client_id: string; p_date_from: string; p_date_to: string };
        Returns: boolean;
      };
      list_client_portal_invitations: {
        Args: { p_agency_id: string };
        Returns: { id: string; client_id: string; email: string; created_at: string; expires_at: string }[];
      };
      upsert_integration_secret: {
        Args: {
          p_agency_id: string; p_integration_id: string; p_secret_kind: string; p_key_id: string;
          p_nonce_b64: string; p_ciphertext_b64: string; p_auth_tag_b64: string;
        };
        Returns: undefined;
      };
      apply_whatsapp_status: {
        Args: { p_wamid: string; p_status: string; p_at: string | null; p_error_code: string | null; p_error_message: string | null };
        Returns: boolean;
      };
      service_recipient_opt_out: { Args: { p_agency_id: string; p_phone: string; p_source: string }; Returns: number };
      record_whatsapp_message: {
        Args: {
          p_agency_id: string; p_connection_id: string | null; p_remote_id: string; p_is_group: boolean; p_title: string | null;
          p_external_id: string; p_direction: "in" | "out"; p_kind: string; p_body: string | null; p_media_name: string | null;
          p_media_mime: string | null; p_author: string | null; p_status: string | null; p_sent_at: string; p_media_id?: string | null;
        };
        Returns: { conversation_id: string; inserted: boolean; needs_title: boolean }[];
      };
      record_whatsapp_history_message: {
        Args: {
          p_agency_id: string; p_connection_id: string | null; p_remote_id: string; p_is_group: boolean; p_title: string | null;
          p_external_id: string; p_direction: "in" | "out"; p_kind: string; p_body: string | null; p_media_name: string | null;
          p_media_mime: string | null; p_author: string | null; p_status: string | null; p_sent_at: string; p_media_id?: string | null;
        };
        Returns: { conversation_id: string; inserted: boolean; needs_title: boolean }[];
      };
      set_whatsapp_message_media_ref: { Args: { p_agency_id: string; p_external_id: string; p_media_ref: Json }; Returns: undefined };
      update_whatsapp_message_status: { Args: { p_agency_id: string | null; p_external_id: string; p_status: string }; Returns: number };
      set_whatsapp_conversation_title: { Args: { p_conversation_id: string; p_title: string }; Returns: undefined };
      mark_whatsapp_conversation_read: { Args: { p_conversation_id: string }; Returns: undefined };
      mark_whatsapp_read_by_message: { Args: { p_agency_id: string; p_external_id: string }; Returns: number };
      sync_whatsapp_qr_chat_states: { Args: { p_agency_id: string; p_states: Json }; Returns: number };
      set_whatsapp_conversation_archived: { Args: { p_conversation_id: string; p_archived: boolean }; Returns: undefined };
      set_whatsapp_conversation_favorite: { Args: { p_conversation_id: string; p_favorite: boolean }; Returns: undefined };
      service_client_analytics: { Args: { p_client_id: string; p_date_from: string; p_date_to: string }; Returns: Json };
      record_whatsapp_webhook: { Args: { p_dedup_key: string; p_payload: Json }; Returns: boolean };
      delete_integration_secret: { Args: { p_agency_id: string; p_integration_id: string; p_secret_kind: string }; Returns: undefined };
      get_integration_secret: {
        Args: { p_agency_id: string; p_integration_id: string; p_secret_kind: string };
        Returns: { key_id: string; nonce_b64: string; ciphertext_b64: string; auth_tag_b64: string }[];
      };
      set_client_ad_account: {
        Args: { p_agency_id: string; p_client_id: string; p_ad_account_id: string; p_active: boolean };
        Returns: undefined;
      };
      set_client_metric_mapping: {
        Args: {
          p_agency_id: string; p_client_id: string; p_primary_metric_key: string;
          p_primary_action_type: string; p_revenue_action_type?: string | null;
        };
        Returns: undefined;
      };
      get_client_portal_data_context: {
        Args: { p_client_id: string };
        Returns: { client_id: string; data_status: string; compatibility_issue: string | null; currency: string | null; timezone_name: string | null; ad_account_count: number; latest_data_date: string | null }[];
      };
      get_client_portal_metric_summary: {
        Args: { p_client_id: string; p_date_from: string; p_date_to: string };
        Returns: ClientMetricSummaryRow[];
      };
      get_campaign_scoped_analytics: {
        Args: { p_client_id: string; p_date_from: string; p_date_to: string; p_ad_account_ids: string[]; p_entity_keys: string[] };
        Returns: Json;
      };
      get_client_analytics_hierarchy: {
        Args: { p_client_id: string; p_date_from: string; p_date_to: string; p_ad_account_ids: string[] };
        Returns: Json;
      };
      get_client_report_header: { Args: { p_client_id: string }; Returns: Json; };
      create_dashboard_report: {
        Args: { p_client_id: string; p_date_from: string; p_date_to: string; p_ad_account_ids: string[];
          p_entity_keys: string[]; p_metric_keys: string[]; p_title: string; p_header: Json };
        Returns: string;
      };
      get_dashboard_report_document: { Args: { p_report_version_id: string }; Returns: Json; };
      archive_dashboard_report: { Args: { p_client_id: string; p_report_id: string }; Returns: undefined; };
      create_manual_report_version: {
        Args: {
          p_agency_id: string; p_client_id: string; p_date_from: string; p_date_to: string;
          p_report_id?: string | null; p_title?: string;
        };
        Returns: string;
      };
      publish_report_version: {
        Args: { p_agency_id: string; p_report_version_id: string };
        Returns: undefined;
      };
      list_client_portal_reports: {
        Args: { p_client_id: string };
        Returns: {
          report_version_id: string; report_id: string; title: string; version_number: number;
          date_from: string; date_to: string; currency: string | null; timezone_name: string | null;
          data_collected_at: string | null; published_at: string | null;
        }[];
      };
      get_client_portal_report_metrics: {
        Args: { p_report_version_id: string };
        Returns: {
          metric_key: string; label: string; unit: "currency" | "integer" | "percent" | "ratio";
          numeric_value: number | null; display_precision: number;
        }[];
      };
      save_client_recipient: {
        Args: {
          p_agency_id: string; p_client_id: string; p_id: string | null; p_name: string;
          p_phone: string; p_active: boolean;
        };
        Returns: string;
      };
      set_recipient_consent: {
        Args: {
          p_agency_id: string; p_client_id: string; p_recipient_id: string; p_phone: string;
          p_granted: boolean; p_source: string; p_occurred_at: string | null;
        };
        Returns: string;
      };
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
  private: {
    Tables: {
      integration_secrets: Table<IntegrationSecretRow, Pick<IntegrationSecretRow, "agency_id" | "integration_id" | "secret_kind" | "key_id" | "nonce_b64" | "ciphertext_b64" | "auth_tag_b64"> & Partial<IntegrationSecretRow>, Partial<IntegrationSecretRow>>;
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
