"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserSession } from "@/modules/agencies/context";

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ["image/webp", "image/png", "image/jpeg"];

async function removeOldPhotos(supabase: Awaited<ReturnType<typeof requireUserSession>>["supabase"], userId: string, keep?: string) {
  const { data } = await supabase.storage.from("avatars").list(userId);
  const old = (data ?? []).map(file => `${userId}/${file.name}`).filter(path => path !== keep);
  if (old.length) await supabase.storage.from("avatars").remove(old);
}

/** Name and, when sent, a new photo (already resized in the browser). */
export async function updateProfileAction(formData: FormData) {
  const name = z.string().trim().min(2, "Informe seu nome com pelo menos 2 letras.").max(120).safeParse(formData.get("name"));
  if (!name.success) return { error: name.error.issues[0].message };
  const { supabase, user } = await requireUserSession("/dashboard/configuracoes");
  const file = formData.get("photo");
  let avatarUrl: string | undefined;
  if (file instanceof Blob && file.size > 0) {
    if (!TYPES.includes(file.type)) return { error: "Use uma imagem PNG, JPG ou WEBP." };
    if (file.size > MAX_BYTES) return { error: "A foto precisa ter até 2 MB." };
    // A new file name each time, so the old photo is not served from cache.
    const path = `${user.id}/foto-${Date.now()}.${file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : "webp"}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, { contentType: file.type, upsert: false });
    if (error) return { error: error.message.includes("Bucket") ? "Fotos de perfil precisam de uma atualização do banco de dados (migração 202610070008)." : "Não foi possível enviar a foto." };
    avatarUrl = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    await removeOldPhotos(supabase, user.id, path);
  }
  const { error } = await supabase.auth.updateUser({ data: { full_name: name.data, ...(avatarUrl ? { avatar_url: avatarUrl } : {}) } });
  if (error) return { error: "Não foi possível salvar o perfil." };
  revalidatePath("/dashboard", "layout");
  return { success: true as const, avatarUrl: avatarUrl ?? null };
}

export async function removeAvatarAction() {
  const { supabase, user } = await requireUserSession("/dashboard/configuracoes");
  await removeOldPhotos(supabase, user.id);
  const { error } = await supabase.auth.updateUser({ data: { avatar_url: null } });
  if (error) return { error: "Não foi possível remover a foto." };
  revalidatePath("/dashboard", "layout");
  return { success: true as const };
}
