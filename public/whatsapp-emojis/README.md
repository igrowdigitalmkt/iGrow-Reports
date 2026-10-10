# Emoji artwork

Original WhatsApp Web glyphs fetched on 2026-10-10 from its public image endpoint:
`https://web.whatsapp.com/emoji/v1/16/0/2/single/w/64/{codepoints}.png`.

The design and artwork belong to WhatsApp. Filenames use six-digit Unicode code points joined by underscores. `src/modules/whatsapp/emoji-assets.json` maps Unicode strings to the bundled files. `scripts/import-whatsapp-emoji-assets.mjs` reproduces the import for the emoji picker and validates PNG responses.

Payloads sent through WhatsApp remain Unicode text. The images change presentation only.
