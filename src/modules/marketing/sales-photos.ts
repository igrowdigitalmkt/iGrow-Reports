// Imagens fornecidas pelo proprietário em 18/10/2026 (cenas de gestores de tráfego e equipes de agência com a
// interface da Groow Ads nas telas, dados demonstrativos). Arquivos em public/photos/. `wide` ocupa a largura toda.
export type SalesPhoto = { src: string | null; alt: string; caption: string; width: number; height: number; wide?: boolean };
export const salesPhotos: SalesPhoto[] = [
  { src: "/photos/gestor-paineis-ia.jpg", width: 2000, height: 1116, wide: true, alt: "Gestor de tráfego trabalhando no notebook, cercado por painéis translúcidos com os indicadores da Groow Ads (dados demonstrativos)", caption: "Todos os números do negócio ao alcance de um olhar." },
  { src: "/photos/gestor-monitor-tablet.jpg", width: 2000, height: 1116, alt: "Gestor consultando a Groow Ads no tablet, com a visão geral aberta no monitor ao lado (dados demonstrativos)", caption: "Do monitor ao tablet, o mesmo painel." },
  { src: "/photos/gestor-celular-notebook.jpg", width: 2000, height: 1116, alt: "Profissional conferindo os resultados de um cliente no celular e no notebook, em uma cafeteria (dados demonstrativos)", caption: "No escritório ou no café, o resultado vai junto." },
  { src: "/photos/gestora-home-office.jpg", width: 2000, height: 1116, alt: "Gestora de tráfego em seu home office, com o painel da Groow Ads no monitor e no notebook (dados demonstrativos)", caption: "A rotina de anúncios cabe em qualquer mesa." },
  { src: "/photos/equipe-reuniao.jpg", width: 2000, height: 1116, alt: "Equipe de uma agência reunida em torno dos resultados exibidos na Groow Ads em notebook e TV (dados demonstrativos)", caption: "A reunião de resultados, sem montar apresentação." },
  { src: "/photos/gestor-escritorio.jpg", width: 2000, height: 1116, wide: true, alt: "Gestor de tráfego diante do monitor com o painel de um cliente na Groow Ads, ao lado de um painel translúcido de indicadores (dados demonstrativos)", caption: "Cada cliente, cada conta, num só lugar." },
];
