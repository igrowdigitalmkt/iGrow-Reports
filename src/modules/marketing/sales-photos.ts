// Imagens fornecidas pelo proprietário em 18/10/2026: cenas de gestores de tráfego e equipes de agência com a
// interface da Groow Ads nas telas (dados demonstrativos). Cada imagem tem um papel na narrativa da página.
export type SalesPhoto = { src: string; alt: string; width: number; height: number };
const photo = (src: string, alt: string): SalesPhoto => ({ src, alt, width: 2000, height: 1116 });
export const photos = {
  problem: photo("/photos/gestor-celular-notebook.jpg", "Profissional conferindo os resultados de um cliente no celular e no notebook, em uma cafeteria (dados demonstrativos)"),
  command: photo("/photos/gestor-escritorio.jpg", "Gestor de tráfego diante do monitor com o painel de um cliente na Groow Ads, ao lado de um painel translúcido de indicadores (dados demonstrativos)"),
  meeting: photo("/photos/equipe-reuniao.jpg", "Equipe de uma agência reunida em torno dos resultados exibidos na Groow Ads em notebook e TV (dados demonstrativos)"),
  control: photo("/photos/gestora-home-office.jpg", "Gestora de tráfego em seu home office, com o painel da Groow Ads no monitor e no notebook (dados demonstrativos)"),
  cta: photo("/photos/gestor-monitor-tablet.jpg", "Gestor consultando a Groow Ads no tablet, com a visão geral aberta no monitor ao lado (dados demonstrativos)"),
};
