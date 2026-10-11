"use client";
import { WhatsAppEmoji } from "./whatsapp-emoji";
import catalog from "./emoji-catalog.json";

import { useRef, useState } from "react";
import { Car, Clock3, Flag, Globe, Heart, Lightbulb, PawPrint, Search, Smile, Sticker, ThumbsUp, UtensilsCrossed } from "lucide-react";

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
const REACTION_CATEGORIES = [
  { ...CATEGORIES[0], items: CATEGORIES[0].items
    .replace("😊 sorriso tímido", "☺️ sorriso satisfeito|😊 sorriso tímido")
    .replace("😘 beijo|😋 delícia|😛 língua", "😘 beijo|😗 beijando|😙 beijo sorrindo|😚 beijo olhos fechados|😋 delícia|😛 língua|😝 língua olhos fechados") + "|" + CATEGORIES[1].items },
  CATEGORIES[5], CATEGORIES[4],
  { key: "activities", label: "Atividades", icon: Globe, items: "⚽ futebol|🏀 basquete|🏈 futebol americano|⚾ beisebol|🎾 tênis|🏐 vôlei|🎱 bilhar|🏓 tênis de mesa|🏸 badminton|🥊 boxe|🏊 natação|🎮 videogame jogo|🎲 dado|🎨 arte pintura|🎭 teatro" },
  CATEGORIES[6], { ...CATEGORIES[3], label: "Objetos" }, { ...CATEGORIES[2], label: "Símbolos" }, CATEGORIES[7],
];
const assigned = new Set(REACTION_CATEGORIES.flatMap(category => parse(category.items).map(item => item.emoji)));
const COMPLETE_CATEGORIES = REACTION_CATEGORIES.map(category => {
  const first=parse(category.items);
  const known=new Set(first.map(item=>item.emoji));
  return {...category,items:[...first,...catalog.filter(item=>item.category===category.key && !known.has(item.emoji) && !assigned.has(item.emoji))]};
});
const COMPLETE_ALL=[...new Map(COMPLETE_CATEGORIES.flatMap(category=>category.items).map(item=>[item.emoji,item])).values()];
const normalize = (value: string) => value.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function readRecent(): string[] {
  try { const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); return Array.isArray(value) ? value.filter(item => typeof item === "string").slice(0, 24) : []; } catch { return []; }
}

/** Emoji panel in the WhatsApp layout: category tabs, search and the recently used ones. */
export function EmojiPicker({ onPick, onSticker, variant = "composer" }: { onPick: (emoji: string) => void; onSticker?:()=>void; variant?: "composer" | "reaction" }) {
  const reaction = variant === "reaction";
  const categories = COMPLETE_CATEGORIES;
  const content = useRef<HTMLDivElement>(null);
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [category, setCategory] = useState(!reaction && recent.length ? "recent" : "smileys");
  const [query, setQuery] = useState("");
  const [visibleCount,setVisibleCount]=useState(120);
  const search = query.trim().toLocaleLowerCase("pt-BR");
  const shown = search ? COMPLETE_ALL.filter(item => normalize(`${item.emoji} ${item.words}`).includes(normalize(search)))
    : category === "recent" ? recent.map(emoji => ({ emoji, words: "" }))
    : categories.find(item => item.key === category)?.items ?? [];

  function selectCategory(key: string) {
    setCategory(key); setQuery(""); setVisibleCount(120);
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
    {shown.length ? shown.slice(0,visibleCount).map(item => <button key={item.emoji} type="button" onClick={() => pick(item.emoji)} aria-label={`${item.emoji} ${item.words}`} title={item.words || undefined}><WhatsAppEmoji emoji={item.emoji} eager /></button>)
      : <p className="wai-emoji-empty" role="status">{search ? "Nenhum emoji encontrado." : "Os emojis que você usar aparecem aqui."}</p>}
  </div>;

  return <div className={`wai-emoji${reaction ? " wai-emoji-reaction" : ""}`} role={reaction ? "group" : "dialog"} aria-label={reaction ? "Emojis para reagir" : "Emojis"}>
    <div className="wai-emoji-tabs" role="tablist" aria-label="Categorias de emojis" onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")];
      const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      selectCategory(tabs[next].dataset.category ?? "recent"); tabs[next]?.focus();
    }}>
      {!reaction && recent.length > 0 && <button type="button" role="tab" data-category="recent" aria-label="Recentes" aria-selected={category === "recent" && !search} className={category === "recent" && !search ? "is-active" : undefined} onClick={() => selectCategory("recent")} title="Recentes"><Clock3 size={26} /></button>}
      {categories.map(item => <button key={item.key} data-category={item.key} type="button" role="tab" tabIndex={category !== item.key ? -1 : 0} aria-label={item.label} aria-selected={category === item.key && !search} className={category === item.key && !search ? "is-active" : undefined} onClick={() => selectCategory(item.key)} title={item.label}><item.icon size={26} /></button>)}
    </div>
    <label className="wai-search wai-emoji-search"><Search size={reaction ? 20 : 16} /><input autoFocus={reaction} value={query} onChange={event => { setQuery(event.target.value); setVisibleCount(120); content.current?.scrollTo({top:0}); }} placeholder={reaction ? "Pesquisar reação" : "Pesquisar emoji"} aria-label={reaction ? "Pesquisar reação" : "Pesquisar emoji"} /></label>
    <div className="wai-emoji-content" ref={content} onScroll={event=>{if(event.currentTarget.scrollHeight-event.currentTarget.scrollTop-event.currentTarget.clientHeight<150 && visibleCount<shown.length)setVisibleCount(count=>count+120);}}>{title}{grid}</div>
    {!reaction && <footer className="wai-emoji-modes" aria-label="Tipo de conteúdo"><button type="button" aria-pressed="true" aria-label="Emojis"><Smile size={21} /></button><button type="button" disabled title="GIFs não disponíveis nesta integração">GIF</button><button type="button" disabled={!onSticker} onClick={onSticker} title="Nova figurinha" aria-label="Figurinhas"><Sticker size={21} /></button></footer>}
  </div>;
}
