import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Excel içe aktarma dosya yüklemesi için (Vercel istek sınırı ~4.5 MB)
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
