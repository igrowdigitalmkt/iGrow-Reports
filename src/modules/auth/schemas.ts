import { z } from "zod";

export const loginSchema = z.object({
  email: z.email("Informe um e-mail válido.").trim().max(254),
  password: z.string().min(1, "Informe sua senha.").max(256),
});

export const passwordSchema = z.object({
  password: z.string().min(8, "Use uma senha com pelo menos 8 caracteres.").max(128),
  confirmation: z.string(),
}).refine((data) => data.password === data.confirmation, {
  message: "As senhas precisam ser iguais.",
  path: ["confirmation"],
});

export const invitationTokenSchema = z.string().regex(/^[a-f0-9]{64}$/, "Convite inválido.");

