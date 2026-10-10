"use client";
import { WhatsAppEmoji } from "./whatsapp-emoji";

import { useRef, useState } from "react";
import { Car, Clock3, Flag, Globe, Heart, Lightbulb, PawPrint, Search, Smile, ThumbsUp, UtensilsCrossed } from "lucide-react";

// Common emojis grouped like WhatsApp, each with Portuguese words for the search.
const CATEGORIES: Array<{ key: string; label: string; icon: typeof Smile; items: string }> = [
  { key: "smileys", label: "Smileys e pessoas", icon: Smile, items: "😀 sorriso feliz|😃 feliz alegre|😄 risada|😁 sorrisão|😆 rindo|🥹 emocionado|😅 suor nervoso|😂 chorando de rir|🤣 rolando de rir|🥲 sorriso lágrima|😊 sorriso tímido|😇 anjo|🙂 leve sorriso|🙃 de cabeça para baixo|😉 piscada|😌 aliviado|😍 apaixonado|🥰 carinho|😘 beijo|😋 delícia|😛 língua|😜 brincadeira|🤪 maluco|🤨 desconfiado|🧐 analisando|🤓 nerd|😎 óculos legal|🤩 deslumbrado|🥳 festa comemoração|😏 malicioso|😒 entediado|😞 desapontado|😔 pensativo triste|😟 preocupado|😕 confuso|🙁 triste|😣 sofrendo|😫 cansado|😩 exausto|🥺 por favor|😢 chorando|😭 choro forte|😤 bufando|😠 bravo|😡 furioso|🤯 cabeça explodindo|😳 envergonhado|😱 grito susto|😨 assustado|😰 ansioso|🤗 abraço|🤔 pensando|🤭 ops|🤫 silêncio|😶 sem palavras|😐 neutro|😬 constrangido|🙄 revirando olhos|😯 surpreso|😴 dormindo|🤤 babando|😷 máscara doente|🤒 febre|🤑 dinheiro|🤠 caubói|😈 travesso|👀 olhos olhando|🧠 cérebro ideia" },
  { key: "gestures", label: "Gestos", icon: ThumbsUp, items: "👍 joinha ok positivo|👎 negativo|👌 perfeito|🤌 italiano|✌️ paz vitória|🤞 dedos cruzados sorte|🤝 aperto de mão acordo|🙏 por favor obrigado|👏 palmas parabéns|🙌 celebrando|👋 tchau olá|🤙 me liga|💪 força|👉 apontando direita|👈 apontando esquerda|👆 para cima|👇 para baixo|☝️ atenção|✋ mão pare|🫶 coração com as mãos|✍️ escrevendo|🫡 continência|🤷 sei lá|🙋 levantando a mão|🙇 desculpa|💁 informação|🙆 ok|🙅 não" },
  { key: "hearts", label: "Corações e símbolos", icon: Heart, items: "❤️ coração amor|🧡 coração laranja|💛 coração amarelo|💚 coração verde|💙 coração azul|💜 coração roxo|🖤 coração preto|🤍 coração branco|💔 coração partido|💕 corações|💖 brilhando|✨ brilho|⭐ estrela|🌟 estrela brilhante|🔥 fogo|💯 cem por cento|✅ certo feito|☑️ marcado|✔️ ok|❌ errado não|❗ exclamação importante|❓ pergunta|⚠️ atenção aviso|🚫 proibido|🆗 ok|🆕 novo|🔴 vermelho|🟢 verde|🟡 amarelo|🔵 azul|➡️ seta direita|⬆️ seta cima|⬇️ seta baixo|📌 fixar|📍 local" },
  { key: "work", label: "Trabalho e objetos", icon: Lightbulb, items: "📊 gráfico relatório|📈 crescimento alta|📉 queda baixa|💰 dinheiro|💵 nota|💳 cartão pagamento|🧾 recibo|📄 documento|📑 páginas|📎 clipe anexo|📁 pasta|🗂️ arquivos|📅 calendário data|🗓️ agenda|⏰ alarme horário|⏳ tempo|📞 telefone ligação|📱 celular|💻 computador|🖥️ monitor|📧 email|✉️ carta|📣 anúncio megafone|📢 alto-falante|🎯 alvo meta|🚀 foguete lançamento|💡 ideia|🔎 lupa busca|🔒 cadeado seguro|🔑 chave|🛒 carrinho compras|🎁 presente|🏆 troféu|🥇 primeiro lugar|📸 câmera foto|🎥 vídeo|🎉 festa|🎊 confete" },
  { key: "food", label: "Comidas", icon: UtensilsCrossed, items: "☕ café|🍕 pizza|🍔 hambúrguer|🍟 batata|🌭 cachorro-quente|🍰 bolo|🎂 aniversário|🍫 chocolate|🍿 pipoca|🍺 cerveja|🍷 vinho|🥂 brinde|🍎 maçã|🍓 morango|🍉 melancia|🥗 salada|🍝 macarrão|🍣 sushi" },
  { key: "nature", label: "Animais e natureza", icon: PawPrint, items: "🐶 cachorro|🐱 gato|🐭 rato|🐰 coelho|🦊 raposa|🐻 urso|🐼 panda|🦁 leão|🐮 vaca|🐷 porco|🐵 macaco|🐔 galinha|🐧 pinguim|🐦 pássaro|🦋 borboleta|🐝 abelha|🌸 flor|🌹 rosa|🌻 girassol|🌴 palmeira|🌵 cacto|☀️ sol|🌙 lua|⛅ nublado|🌧️ chuva|⚡ raio|❄️ neve|🌈 arco-íris|🌊 onda mar" },
  { key: "travel", label: "Viagens e lugares", icon: Car, items: "🚗 carro|🚕 táxi|🚌 ônibus|🏍️ moto|🚲 bicicleta|✈️ avião viagem|🚢 navio|🏠 casa|🏢 prédio empresa|🏥 hospital|🏫 escola|⛪ igreja|🏖️ praia|⛰️ montanha|🗺️ mapa|🧭 bússola" },
  { key: "flags", label: "Bandeiras", icon: Flag, items: "🇧🇷 brasil|🇵🇹 portugal|🇺🇸 estados unidos|🇪🇸 espanha|🇦🇷 argentina|🏁 chegada|🚩 bandeira vermelha|🏳️ bandeira branca" },
];
const RECENT_KEY = "igrow:whatsapp-recent-emojis";
const parse = (items: string) => items.split("|").map(entry => { const [emoji, ...words] = entry.split(" "); return { emoji, words: words.join(" ") }; });
const ALL = CATEGORIES.flatMap(category => parse(category.items));
const REACTION_CATEGORIES = [
  { ...CATEGORIES[0], items: CATEGORIES[0].items
    .replace("😊 sorriso tímido", "☺️ sorriso satisfeito|😊 sorriso tímido")
    .replace("😘 beijo|😋 delícia|😛 língua", "😘 beijo|😗 beijando|😙 beijo sorrindo|😚 beijo olhos fechados|😋 delícia|😛 língua|😝 língua olhos fechados") + "|" + CATEGORIES[1].items },
  CATEGORIES[5], CATEGORIES[4],
  { key: "activities", label: "Atividades", icon: Globe, items: "⚽ futebol|🏀 basquete|🏈 futebol americano|⚾ beisebol|🎾 tênis|🏐 vôlei|🎱 bilhar|🏓 tênis de mesa|🏸 badminton|🥊 boxe|🏊 natação|🎮 videogame jogo|🎲 dado|🎨 arte pintura|🎭 teatro" },
  CATEGORIES[6], { ...CATEGORIES[3], label: "Objetos" }, { ...CATEGORIES[2], label: "Símbolos" }, CATEGORIES[7],
];
const REACTION_ALL = REACTION_CATEGORIES.flatMap(category => parse(category.items));
const normalize = (value: string) => value.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function readRecent(): string[] {
  try { const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); return Array.isArray(value) ? value.filter(item => typeof item === "string").slice(0, 24) : []; } catch { return []; }
}

/** Emoji panel in the WhatsApp layout: category tabs, search and the recently used ones. */
export function EmojiPicker({ onPick, variant = "composer" }: { onPick: (emoji: string) => void; variant?: "composer" | "reaction" }) {
  const reaction = variant === "reaction";
  const categories = reaction ? REACTION_CATEGORIES : CATEGORIES;
  const content = useRef<HTMLDivElement>(null);
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [category, setCategory] = useState(!reaction && recent.length ? "recent" : "smileys");
  const [query, setQuery] = useState("");
  const search = query.trim().toLocaleLowerCase("pt-BR");
  const shown = search ? (reaction ? REACTION_ALL : ALL).filter(item => normalize(`${item.emoji} ${item.words}`).includes(normalize(search)))
    : category === "recent" ? recent.map(emoji => ({ emoji, words: "" }))
    : parse(categories.find(item => item.key === category)?.items ?? "");

  function selectCategory(key: string) {
    setCategory(key); setQuery("");
    content.current?.scrollTo({ top: 0 });
  }

  function pick(emoji: string) {
    onPick(emoji);
    const next = [emoji, ...recent.filter(item => item !== emoji)].slice(0, 24);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* private window: recent list stays in memory */ }
  }

  const title = <p className="wai-emoji-title">{search ? "Resultados" : category === "recent" ? "Recentes" : categories.find(item => item.key === category)?.label}</p>;
  const grid = <div className="wai-emoji-grid">
    {shown.length ? shown.map(item => <button key={item.emoji} type="button" onClick={() => pick(item.emoji)} aria-label={`${item.emoji} ${item.words}`} title={item.words || undefined}><WhatsAppEmoji emoji={item.emoji} /></button>)
      : <p className="wai-emoji-empty" role="status">{search ? "Nenhum emoji encontrado." : "Os emojis que você usar aparecem aqui."}</p>}
  </div>;

  return <div className={`wai-emoji${reaction ? " wai-emoji-reaction" : ""}`} role={reaction ? "group" : "dialog"} aria-label={reaction ? "Emojis para reagir" : "Emojis"}>
    <div className="wai-emoji-tabs" role="tablist" aria-label="Categorias de emojis" onKeyDown={event => {
      if (!reaction || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")];
      const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      selectCategory(categories[next].key); tabs[next]?.focus();
    }}>
      {!reaction && <button type="button" role="tab" aria-selected={category === "recent" && !search} className={category === "recent" && !search ? "is-active" : undefined} onClick={() => selectCategory("recent")} title="Recentes"><Clock3 size={18} /></button>}
      {categories.map(item => <button key={item.key} type="button" role="tab" tabIndex={reaction && category !== item.key ? -1 : 0} aria-label={item.label} aria-selected={category === item.key && !search} className={category === item.key && !search ? "is-active" : undefined} onClick={() => selectCategory(item.key)} title={item.label}><item.icon size={reaction ? 26 : 18} /></button>)}
    </div>
    <label className="wai-search wai-emoji-search"><Search size={reaction ? 20 : 16} /><input autoFocus={reaction} value={query} onChange={event => { setQuery(event.target.value); content.current?.scrollTo({top:0}); }} placeholder={reaction ? "Pesquisar reação" : "Pesquisar emoji"} aria-label={reaction ? "Pesquisar reação" : "Pesquisar emoji"} /></label>
    {reaction ? <div className="wai-emoji-content" ref={content}>{title}{grid}</div> : <>{title}{grid}</>}
  </div>;
}
