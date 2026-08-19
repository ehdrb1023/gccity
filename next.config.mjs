/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 봇이 사진을 base64 로 실어 보낸다. 기본 1MB 로는 배치가 통째로 거부된다.
  experimental: { serverActions: { bodySizeLimit: '8mb' } },
};
export default nextConfig;
