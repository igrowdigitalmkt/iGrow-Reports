import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { getEncryptionConfig } from "@/lib/env";

export type EncryptedSecret = {
  keyId: string;
  nonceB64: string;
  ciphertextB64: string;
  authTagB64: string;
};

export function encryptWithKey(
  plaintext: string,
  key: Buffer,
  keyId: string,
  associatedData?: Buffer,
): EncryptedSecret {
  if (key.length !== 32) throw new Error("Chave AES-256 inválida.");
  if (!plaintext) throw new Error("Segredo vazio não pode ser criptografado.");

  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  if (associatedData) cipher.setAAD(associatedData);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    keyId,
    nonceB64: nonce.toString("base64"),
    ciphertextB64: ciphertext.toString("base64"),
    authTagB64: authTag.toString("base64"),
  };
}

export function decryptWithKey(
  envelope: EncryptedSecret,
  key: Buffer,
  associatedData?: Buffer,
): string {
  if (key.length !== 32) throw new Error("Chave AES-256 inválida.");

  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.nonceB64, "base64"),
  );
  if (associatedData) decipher.setAAD(associatedData);
  decipher.setAuthTag(Buffer.from(envelope.authTagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertextB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

export function encryptServerSecret(
  plaintext: string,
  associatedData: string,
): EncryptedSecret {
  const config = getEncryptionConfig();
  if (!config) {
    throw new Error("Criptografia do servidor não configurada.");
  }
  return encryptWithKey(
    plaintext,
    config.key,
    config.keyId,
    Buffer.from(associatedData, "utf8"),
  );
}

export function decryptServerSecret(
  envelope: EncryptedSecret,
  associatedData: string,
): string {
  const config = getEncryptionConfig();
  if (!config) {
    throw new Error("Criptografia do servidor não configurada.");
  }
  if (envelope.keyId !== config.keyId) {
    throw new Error("A chave ativa não corresponde ao segredo armazenado.");
  }
  return decryptWithKey(
    envelope,
    config.key,
    Buffer.from(associatedData, "utf8"),
  );
}
