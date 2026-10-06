// Order of platform actions by business importance: conversions first, then traffic,
// then audience growth, then video and engagement. Unknown actions go last.
const PRIORITY: Array<[RegExp, number]> = [
  [/purchase/, 10],
  [/lead/, 20],
  [/complete_registration/, 30],
  [/offsite_conversion\.custom\./, 35],
  [/messaging_conversation_started|messaging_first_reply|messaging_connection/, 40],
  [/contact|schedule|submit_application|subscribe|start_trial/, 45],
  [/add_to_cart|initiate_checkout|add_payment_info/, 50],
  [/landing_page_view/, 60],
  [/link_click/, 70],
  [/instagram_profile_visit|profile_visit/, 80],
  [/(^|:)like$|follow/, 90],
  [/video_view|video_play|thruplay/, 100],
  [/page_engagement|post_engagement/, 110],
  [/comment|post_reaction|onsite_conversion\.post_save|(^|:)post$/, 120],
];

export function actionPriority(key: string) {
  const action = key.replace(/^action:/, "");
  return PRIORITY.find(([pattern]) => pattern.test(action))?.[1] ?? 1000;
}

export function sortActionsByImportance<T extends { key: string }>(actions: T[], value: (key: string) => number) {
  return [...actions].sort((a, b) => actionPriority(a.key) - actionPriority(b.key) || value(b.key) - value(a.key));
}
