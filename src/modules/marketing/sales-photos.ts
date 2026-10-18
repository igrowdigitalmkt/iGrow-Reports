// Fotografias da seção "pessoas", geradas com FLUX.2 Pro (Replicate) em 18/10/2026 a partir do briefing
// em docs/SITE_FOTOS_GROOW_ADS.md. Com `src: null` o quadro não aparece. Arquivos em public/photos/.
export type SalesPhoto = { src: string | null; alt: string; caption: string; width: number; height: number };
export const salesPhotos: SalesPhoto[] = [
  { src: "/photos/mesa-dashboard.webp", alt: "Profissional sentada à mesa, acompanhando um painel de resultados com gráficos em um monitor", caption: "Resultados claros na tela, sem horas de preparação.", width: 1280, height: 1600 },
  { src: "/photos/maos-celular-relatorio.webp", alt: "Mão segurando um smartphone que exibe um relatório de resultados com gráfico de crescimento", caption: "O relatório chega no celular de quem decide.", width: 1744, height: 1168 },
  { src: "/photos/reuniao-apresentacao.webp", alt: "Equipe em uma sala de reunião avaliando resultados exibidos em uma tela grande", caption: "Do painel à reunião, no modo apresentação.", width: 1744, height: 1168 },
];
