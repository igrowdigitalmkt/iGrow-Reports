import "server-only";
import { createHash,timingSafeEqual } from "node:crypto";

export function authorizeWorkerRequest(authorization: string | null,secret: string | undefined): "authorized" | "unauthorized" | "unconfigured" {
  if (!secret || !/^[A-Za-z0-9_-]{32,256}$/.test(secret)) return "unconfigured";
  if (!authorization || !/^Bearer [A-Za-z0-9_-]{32,256}$/.test(authorization)) return "unauthorized";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(authorization.slice(7)),digest(secret)) ? "authorized" : "unauthorized";
}
