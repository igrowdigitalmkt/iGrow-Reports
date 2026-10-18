// Fotografias geradas com FLUX.2 Pro (Replicate) em 18/10/2026, no contexto de quem usa a plataforma
// (gestores de tráfego e agências). As telas dos aparelhos foram geradas em verde chapado e substituídas, em
// perspectiva e com recorte de croma, por capturas REAIS da plataforma (dados demonstrativos); logos de
// terceiros que apareceram foram retocados. Arquivos prontos em public/photos/. Com `src: null` o quadro some.
export type SalesPhoto = { src: string | null; alt: string; caption: string; width: number; height: number };
export const salesPhotos: SalesPhoto[] = [
  { src: "/photos/gestor-home-studio.webp", width: 1744, height: 1168, alt: "Gestor de tráfego em seu home studio à noite, acompanhando a visão geral da Groow Ads em um monitor (dados demonstrativos)", caption: "Toda a carteira de clientes, numa tela só." },
  { src: "/photos/agencia-reuniao.webp", width: 1744, height: 1168, alt: "Equipe de uma agência de marketing reunida diante de um monitor que exibe o painel de um cliente na Groow Ads (dados demonstrativos)", caption: "A reunião de resultados, sem montar apresentação." },
];
