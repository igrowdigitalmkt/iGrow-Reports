-- Repair the legacy label consumed by both the dashboard and report definitions.
update public.metric_definitions set label = 'Impressões' where key = 'impressions';
