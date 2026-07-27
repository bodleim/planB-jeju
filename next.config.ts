import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 홈 디렉터리에 남은 package-lock.json 때문에 workspace root가 잘못 잡힌다
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
