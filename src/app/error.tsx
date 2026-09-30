"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="standalone"><div className="panel max-w-lg p-9"><span className="eyebrow">NÃO FOI POSSÍVEL CARREGAR</span><h1 className="mt-4 text-2xl font-semibold">Algo interrompeu esta consulta.</h1><p className="muted my-5">Tente novamente. Se o problema continuar, confira a configuração do Supabase e a disponibilidade do serviço.</p><button className="button button-primary" onClick={reset}>Tentar novamente</button></div></main>;
}

