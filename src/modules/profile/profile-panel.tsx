"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { removeAvatarAction, updateProfileAction } from "./actions";

const SIZE = 256;

// Square 256 px WEBP from any photo: small upload, sharp in every avatar.
async function squarePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE; canvas.height = SIZE;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("photo")), "image/webp", 0.86));
}

export function ProfilePanel({ name: initialName, email, avatarUrl, demo = false }: { name: string; email: string; avatarUrl: string | null; demo?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [preview, setPreview] = useState<string | null>(avatarUrl);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, start] = useTransition();
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "?";

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(""); setNotice("");
    if (!file.type.startsWith("image/")) { setError("Escolha uma imagem."); return; }
    try {
      const blob = await squarePhoto(file);
      setPhoto(blob);
      setPreview(URL.createObjectURL(blob));
    } catch { setError("Não foi possível ler esta imagem. Tente outra foto."); }
  }

  function save() {
    setError(""); setNotice("");
    if (demo) { setError("Na demonstração nada é salvo."); return; }
    const form = new FormData();
    form.append("name", name);
    if (photo) form.append("photo", photo, "foto.webp");
    start(async () => {
      const result = await updateProfileAction(form);
      if ("error" in result) { setError(result.error ?? "Não foi possível salvar."); return; }
      setPhoto(null);
      setNotice("Perfil atualizado.");
      router.refresh();
    });
  }

  function remove() {
    setError(""); setNotice("");
    if (demo) { setError("Na demonstração nada é alterado."); return; }
    start(async () => {
      const result = await removeAvatarAction();
      if ("error" in result) { setError(result.error ?? "Não foi possível remover."); return; }
      setPreview(null); setPhoto(null);
      router.refresh();
    });
  }

  return <section className="panel settings-panel profile-panel">
    <div className="panel-heading"><div><h2>Seu perfil</h2><p>Como você aparece para a equipe</p></div><UserRound size={18} className="muted" /></div>
    <div className="profile-body">
      <div className="profile-photo">
        {/* eslint-disable-next-line @next/next/no-img-element -- local preview or small stored photo */}
        {preview ? <img src={preview} alt="Sua foto de perfil" /> : <span aria-hidden="true">{initials}</span>}
        <button type="button" className="profile-photo-edit" onClick={() => input.current?.click()} aria-label="Alterar foto"><Camera size={15} /></button>
      </div>
      <div className="profile-fields">
        <label><span>Nome</span><input className="input" value={name} maxLength={120} onChange={event => setName(event.target.value)} /></label>
        <p className="muted text-xs">{email}</p>
        <div className="profile-actions">
          <Button variant="secondary" size="sm" type="button" onClick={() => input.current?.click()}><Camera size={14} />{preview ? "Trocar foto" : "Adicionar foto"}</Button>
          {preview && <Button variant="ghost" size="sm" type="button" onClick={remove} disabled={pending}><Trash2 size={14} />Remover</Button>}
        </div>
      </div>
    </div>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { void choose(event.target.files?.[0]); event.target.value = ""; }} />
    {error && <p role="alert" className="meta-feedback error">{error}</p>}
    {notice && <p role="status" className="meta-feedback success">{notice}</p>}
    <Button className="mt-4" onClick={save} disabled={pending || name.trim().length < 2}>{pending ? "Salvando…" : "Salvar perfil"}</Button>
  </section>;
}
