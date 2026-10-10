import fs from "node:fs/promises";
// Public glyph endpoint currently used by WhatsApp Web (Unicode 16, WhatsApp set, 64px).
// Fetch image data only; no WhatsApp account, cookies or messages are involved.
const endpoint = "https://web.whatsapp.com/emoji/v1/16/0/2/single/w/64/";
const source = await fs.readFile("src/modules/whatsapp/emoji-picker.tsx", "utf8");
const segments = new Intl.Segmenter("pt-BR", { granularity: "grapheme" });
const emojis = new Set([...segments.segment(source)].map(item => item.segment)
  .filter(item => /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(item)));
const key = emoji => Array.from(emoji, char => char.codePointAt(0).toString(16).padStart(6, "0")).join("_");
await fs.mkdir("public/whatsapp-emojis", { recursive: true });
const manifest = {};
const failures = [];
const queue = [...emojis];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (queue.length) {
    const emoji = queue.shift();
    const filename = key(emoji) + ".png";
    let response = await fetch(endpoint + filename);
    if (!response.ok && emoji.includes("\ufe0f")) response = await fetch(endpoint + key(emoji.replaceAll("\ufe0f", "")) + ".png");
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/png")) { failures.push(emoji); continue; }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) throw Error("Invalid PNG");
    await fs.writeFile("public/whatsapp-emojis/" + filename, bytes);
    manifest[emoji] = filename;
  }
}));
await fs.writeFile("src/modules/whatsapp/emoji-assets.json", JSON.stringify(manifest, null, 2) + "\n");
console.log({ imported: Object.keys(manifest).length, failures });
if (failures.length) process.exitCode = 1;
