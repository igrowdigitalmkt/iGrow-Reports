import Image from "next/image";

/** Logo oficial (a mesma do site). Escuro: wordmark claro com G azul; claro: G azul com texto escuro; barra recolhida: so o G. */
export function Brand() {
  return <span className="brand">
    <Image className="brand-icon" src="/brand/groow-icon-blue.png" alt="" width={1063} height={1000} aria-hidden="true" />
    <Image className="brand-wordmark brand-on-dark" src="/brand/groow-ads-color.png" alt="Groow Ads" width={1179} height={212} />
    <Image className="brand-wordmark brand-on-light" src="/brand/groow-ads-light.png" alt="" width={1179} height={212} aria-hidden="true" />
  </span>;
}
