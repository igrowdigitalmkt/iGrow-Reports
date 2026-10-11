// Preserve the authenticated app-state contact fields before Baileys narrows the event.
// This is deliberately version checked: do not ship an unverified replacement on upgrades.
import { readFileSync, writeFileSync } from "node:fs";
const file = "node_modules/baileys/lib/Utils/chat-utils.js";
const source = readFileSync(file, "utf8");
const anchor = "name: action.contactAction.fullName,";
if (source.split(anchor).length !== 2) throw new Error("Unexpected Baileys contact action implementation");
writeFileSync(file, source.replace(anchor, `${anchor}\n                igrowContactAction: { ...action.contactAction },`));
