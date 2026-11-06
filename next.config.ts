import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA,
  poweredByHeader: false,
  devIndicators: false,
  // Voltar a uma tela visitada há menos de 30 s reaproveita a resposta do servidor (instantâneo). Sem isto (padrão do Next 15+: 0 s) cada
  // troca de tela refaz a renderização no servidor e mostra o esqueleto de novo. Ações que gravam dados invalidam este cache (revalidatePath/router.refresh).
  experimental: { staleTimes: { dynamic: 30, static: 180 } },
  async redirects() {
    return [{ source: "/dashboard/:path*", destination: "/:path*", permanent: true }];
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" }
      ]
    }];
  }
};

export default nextConfig;
