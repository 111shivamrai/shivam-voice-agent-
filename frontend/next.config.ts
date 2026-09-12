import type { NextConfig } from "next";

const backendUrl =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:3001";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/documents",
        destination: `${backendUrl}/api/documents`,
      },
      {
        source: "/api/documents/:path*",
        destination: `${backendUrl}/api/documents/:path*`,
      },
    ];
  },
};

export default nextConfig;
