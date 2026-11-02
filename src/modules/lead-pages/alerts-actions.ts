"use server";

import { z } from "zod";
import { loadAlertsSnapshot, removeAlertRecipient, saveAlertRecipient, setAlertRecipientActive, type AlertsSnapshot } from "./alerts-admin";
import { sendAlertTest } from "./alerts-send";
import { authorizeLeadsClient } from "./hub-access";

export type AlertsResult = (AlertsSnapshot & { ok: true; message?: string }) | { ok: false; message: string };

const clientId = z.uuid();
const ids = z.array(z.string().regex(/^[0-9]{5,30}$/)).max(100);
const NO_ACCESS = { ok: false as const, message: "Você não tem permissão para esta ação." };

type Access = Extract<Awaited<ReturnType<typeof authorizeLeadsClient>>, { allowed: true }>;
async function snapshot(access: Access, message?: string): Promise<AlertsResult> {
  const data = await loadAlertsSnapshot(access.service, { agencyId: access.agencyId, clientId: access.clientId });
  return data ? { ok: true, ...data, message } : { ok: false, message: "Não foi possível carregar os alertas." };
}
async function manager(input: unknown, schema: z.ZodType<{ clientId: string }>) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: { ok: false as const, message: "Confira os campos e tente de novo." } };
  const access = await authorizeLeadsClient(parsed.data.clientId);
  if (!access.allowed || !access.canManage) return { error: NO_ACCESS };
  return { access, data: parsed.data };
}

export async function loadAlertsAction(input: unknown): Promise<AlertsResult> {
  const checked = await manager(input, z.object({ clientId }));
  return checked.error ?? snapshot(checked.access!);
}

export async function saveAlertRecipientAction(input: unknown): Promise<AlertsResult> {
  const schema = z.object({
    clientId, id: z.uuid().optional(), name: z.string().trim().min(2).max(80), phone: z.string().trim().min(8).max(30), mode: z.enum(["instant", "scheduled"]),
    sendTimes: z.array(z.string()).max(12), weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7), campaignIds: ids.nullable(), formIds: ids.nullable(), consent: z.boolean(),
  });
  const checked = await manager(input, schema);
  if (checked.error) return checked.error;
  const { access, data } = checked as { access: Access; data: z.infer<typeof schema> };
  const saved = await saveAlertRecipient(access.service, { ...data, agencyId: access.agencyId, userId: access.userId });
  return saved.ok ? snapshot(access, data.id ? "Alterações salvas." : "Pessoa cadastrada. Use “Enviar teste” para conferir o número.") : saved;
}

export async function setAlertRecipientActiveAction(input: unknown): Promise<AlertsResult> {
  const checked = await manager(input, z.object({ clientId, recipientId: z.uuid(), active: z.boolean() }));
  if (checked.error) return checked.error;
  const { access, data } = checked as { access: Access; data: { clientId: string; recipientId: string; active: boolean } };
  return await setAlertRecipientActive(access.service, { agencyId: access.agencyId, clientId: access.clientId, recipientId: data.recipientId, active: data.active }) ? snapshot(access) : { ok: false, message: "Não foi possível alterar." };
}

export async function removeAlertRecipientAction(input: unknown): Promise<AlertsResult> {
  const checked = await manager(input, z.object({ clientId, recipientId: z.uuid() }));
  if (checked.error) return checked.error;
  const { access, data } = checked as { access: Access; data: { clientId: string; recipientId: string } };
  return await removeAlertRecipient(access.service, { agencyId: access.agencyId, clientId: access.clientId, recipientId: data.recipientId }) ? snapshot(access, "Pessoa removida.") : { ok: false, message: "Não foi possível remover." };
}

export async function sendAlertTestAction(input: unknown): Promise<AlertsResult> {
  const checked = await manager(input, z.object({ clientId, recipientId: z.uuid() }));
  if (checked.error) return checked.error;
  const { access, data } = checked as { access: Access; data: { clientId: string; recipientId: string } };
  const sent = await sendAlertTest(access.service, { recipientId: data.recipientId, clientId: access.clientId });
  const result = await snapshot(access, sent.ok ? "Teste enviado. Confira o WhatsApp da pessoa." : undefined);
  return sent.ok || !result.ok ? result : { ok: false, message: sent.message };
}
