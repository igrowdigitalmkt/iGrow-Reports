// Bump whenever the source or aggregation semantics of a cached metric change.
export const META_ANALYTICS_VERSION = 11;
// Exact-period aggregates stay valid for a day; any newer daily collection for the
// same accounts invalidates them earlier (private.valid_dashboard_scope).
export const META_ANALYTICS_MAX_AGE_MS = 24 * 3_600_000;
export const META_ATTRIBUTION_REFRESH_DAYS = 28;
// Ad set and ad daily rows are kept for this many days (accounts and campaigns
// keep full history). Older detail comes from Meta's exact-period aggregates.
export const META_DETAIL_RETENTION_DAYS = 180;
