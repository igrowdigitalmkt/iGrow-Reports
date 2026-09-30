export const AUTH_COOKIE = "igrow-auth";

export function isAuthCookie(name: string) {
  return name === AUTH_COOKIE || name === `${AUTH_COOKIE}-code-verifier` ||
    new RegExp(`^${AUTH_COOKIE}(?:-code-verifier)?\\.\\d+$`).test(name);
}

