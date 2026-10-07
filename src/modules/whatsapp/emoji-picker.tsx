"use client";

import { useState } from "react";
import { Car, Clock3, Flag, Heart, Lightbulb, PawPrint, Search, Smile, ThumbsUp, UtensilsCrossed } from "lucide-react";

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

function readRecent(): string[] {
  try { const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); return Array.isArray(value) ? value.filter(item => typeof item === "string").slice(0, 24) : []; } catch { return []; }
}

/** Emoji panel in the WhatsApp layout: category tabs, search and the recently used ones. */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [category, setCategory] = useState(recent.length ? "recent" : "smileys");
  const [query, setQuery] = useState("");
  const search = query.trim().toLocaleLowerCase("pt-BR");
  const shown = search ? ALL.filter(item => item.words.includes(search))
    : category === "recent" ? recent.map(emoji => ({ emoji, words: "" }))
    : parse(CATEGORIES.find(item => item.key === category)?.items ?? "");

  function pick(emoji: string) {
    onPick(emoji);
    const next = [emoji, ...recent.filter(item => item !== emoji)].slice(0, 24);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* private window: recent list stays in memory */ }
  }

  return <div className="wai-emoji" role="dialog" aria-label="Emojis">
    <div className="wai-emoji-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={category === "recent" && !search} className={category === "recent" && !search ? "is-active" : undefined} onClick={() => { setCategory("recent"); setQuery(""); }} title="Recentes"><Clock3 size={18} /></button>
      {CATEGORIES.map(item => <button key={item.key} type="button" role="tab" aria-selected={category === item.key && !search} className={category === item.key && !search ? "is-active" : undefined} onClick={() => { setCategory(item.key); setQuery(""); }} title={item.label}><item.icon size={18} /></button>)}
    </div>
    <label className="wai-search wai-emoji-search"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Pesquisar emoji" aria-label="Pesquisar emoji" /></label>
    <p className="wai-emoji-title">{search ? "Resultados" : category === "recent" ? "Recentes" : CATEGORIES.find(item => item.key === category)?.label}</p>
    <div className="wai-emoji-grid">
      {shown.length ? shown.map(item => <button key={item.emoji} type="button" onClick={() => pick(item.emoji)} title={item.words || undefined}>{item.emoji}</button>)
        : <p className="wai-emoji-empty">{search ? "Nenhum emoji encontrado." : "Os emojis que você usar aparecem aqui."}</p>}
    </div>
  </div>;
}
