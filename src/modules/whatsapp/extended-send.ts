import { z } from "zod";
const line=z.string().trim().min(1).max(200).refine(value=>!/[\r\n\u0000-\u001f]/.test(value));
export const extendedSendSchema=z.discriminatedUnion("type",[
  z.object({type:z.literal("contact"),name:line,phone:z.string().regex(/^[1-9][0-9]{7,14}$/)}).strict(),
  z.object({type:z.literal("poll"),name:line,options:z.array(line).min(2).max(12),multiple:z.boolean()}).strict(),
  z.object({type:z.literal("sticker"),base64:z.string().min(1).max(550000).regex(/^[A-Za-z0-9+/]+={0,2}$/)}).strict(),
]).refine(value=>value.type!=="poll" || new Set(value.options.map(option=>option.toLocaleLowerCase("pt-BR"))).size===value.options.length,"Use opções diferentes.");
export type ExtendedSend=z.infer<typeof extendedSendSchema>;
