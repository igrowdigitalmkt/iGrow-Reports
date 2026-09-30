"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AGENCY_COOKIE, requireUserSession } from "./context";

export async function selectAgencyAction(formData: FormData) {
  const { supabase, user } = await requireUserSession();
  const id = z.uuid().safeParse(formData.get("agency_id"));
  if (!id.success) redirect("/selecionar-agencia?erro=agencia-invalida");

  const { data, error } = await supabase.from("agency_users").select("agency_id")
    .eq("agency_id", id.data).eq("user_id", user.id).maybeSingle();
  if (error || !data) redirect("/selecionar-agencia?erro=acesso-negado");

  (await cookies()).set(AGENCY_COOKIE, data.agency_id, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/dashboard");
}

