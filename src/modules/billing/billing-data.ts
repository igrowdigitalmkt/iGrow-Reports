import { z } from "zod";

// Dados de cobrança do pagador. NÃO são guardados no iGrow Reports: seguem direto para o cadastro do cliente no Asaas
// (que o checkout hospedado exige) e o cartão é digitado só na página do Asaas.

export const onlyDigits = (value: string) => value.replace(/\D/g, "");

export function isValidCpf(input: string) {
  const cpf = onlyDigits(input);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const check = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(cpf[index]) * (length + 1 - index);
    const rest = (sum * 10) % 11;
    return (rest === 10 ? 0 : rest) === Number(cpf[length]);
  };
  return check(9) && check(10);
}

export function isValidCnpj(input: string) {
  const cnpj = onlyDigits(input);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const check = (length: number) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + Number(cnpj[index]) * weight, 0);
    const rest = sum % 11;
    return (rest < 2 ? 0 : 11 - rest) === Number(cnpj[length]);
  };
  return check(12) && check(13);
}

const text = (label: string, min: number, max: number) => z.string().trim().min(min, `Informe ${label}.`).max(max, `${label[0].toUpperCase()}${label.slice(1)} está longo demais.`);

export const billingDataSchema = z.object({
  name: text("o nome ou a razão social", 3, 100),
  cpfCnpj: z.string().trim().transform(onlyDigits).refine((value) => isValidCpf(value) || isValidCnpj(value), "Informe um CPF ou CNPJ válido."),
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido.").max(254),
  phone: z.string().trim().transform(onlyDigits).refine((value) => value.length === 10 || value.length === 11, "Informe o telefone com DDD."),
  postalCode: z.string().trim().transform(onlyDigits).refine((value) => value.length === 8, "Informe o CEP com 8 números."),
  address: text("o endereço", 3, 120),
  addressNumber: z.string().trim().min(1, "Informe o número.").max(10, "Número longo demais.").regex(/^[A-Za-z0-9/ -]+$/, "Use só letras, números e hífen no número."),
  province: text("o bairro", 2, 80),
  complement: z.string().trim().max(60, "Complemento longo demais.").optional().transform((value) => value || undefined),
});
export type BillingData = z.infer<typeof billingDataSchema>;
