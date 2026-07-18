/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@kitware/vtk.js"]
};

export default nextConfig;
