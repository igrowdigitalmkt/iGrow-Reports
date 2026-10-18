// Fotografias da seção "pessoas". Preencha `src` (arquivo em public/photos/) para exibir a foto;
// com `src: null` o quadro não aparece. Briefing e prompts em docs/SITE_FOTOS_GROOW_ADS.md.
export type SalesPhoto = { src: string | null; alt: string; caption: string; width: number; height: number };
export const salesPhotos: SalesPhoto[] = [
  { src: null, alt: "Pessoa sentada diante do monitor, acompanhando um painel de resultados de anúncios em modo apresentação", caption: "Resultados claros na tela, sem horas de preparação.", width: 1600, height: 1600 },
  { src: null, alt: "Mão segurando um smartphone que exibe um relatório de resultados recebido por mensagem", caption: "O relatório chega no celular de quem decide.", width: 1600, height: 1000 },
  { src: null, alt: "Equipe em uma sala de reunião avaliando resultados de campanhas exibidos em uma tela grande", caption: "Do painel à reunião, no modo apresentação.", width: 1600, height: 1000 },
];
