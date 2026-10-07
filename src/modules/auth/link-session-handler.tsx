"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { establishLinkSessionAction } from "./actions";

const invalidLink = "Este link não é válido ou expirou. Solicite um novo convite ao responsável.";

// Supabase's default email templates land here with the session in the URL
// fragment (#access_token=…). Read it once, remove it from the address bar and
// let the server validate it and set the session cookies.
export function LinkSessionHandler() {
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    if (!fragment) return;
    const params = new URLSearchParams(fragment);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const failed = params.get("error") || params.get("error_description");
    if (!failed && !accessToken) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    async function run() {
      await Promise.resolve();
      if (failed || !refreshToken) {
        const detail = params.get("error_description")?.replaceAll("+", " ").slice(0, 160);
        setStatus("error"); setMessage(detail ? `${invalidLink} Motivo: ${detail}` : invalidLink); return;
      }
      setStatus("working");
      try {
        // Where the link should continue (e.g. the invitation page), kept across login and password setup.
        const next = new URLSearchParams(window.location.search).get("next");
        const result = await establishLinkSessionAction({ accessToken, refreshToken, type: params.get("type"), next });
        if ("error" in result) { setStatus("error"); setMessage(result.error); return; }
        // Full navigation so every server component reads the new session cookies.
        window.location.assign(result.redirectTo);
      } catch {
        setStatus("error"); setMessage(invalidLink);
      }
    }
    void run();
  }, []);

  if (status === "working") return <p role="status" className="mt-5 flex items-center gap-2 rounded-xl border border-blue-400/20 bg-blue-400/10 p-3 text-sm text-blue-100"><LoaderCircle size={16} className="animate-spin" />Confirmando seu acesso…</p>;
  if (status === "error") return <p role="alert" className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200">{message}</p>;
  return null;
}
