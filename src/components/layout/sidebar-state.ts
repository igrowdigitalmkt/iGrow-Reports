// Shared by the server layout (initial render) and the client shell (toggle),
// so the sidebar opens in the saved state without a flash.
export const SIDEBAR_COOKIE = "igrow-sidebar";
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isSidebarCollapsed(value: string | undefined) {
  return value === "collapsed";
}
