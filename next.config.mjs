/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@kitware/vtk.js"],
  serverExternalPackages: ["@itk-wasm/dicom", "@itk-wasm/image-io", "itk-wasm"],
  outputFileTracingExcludes: {
    "/api/studies": ["./src/**/*", "./docs/**/*", "./vitest.config.ts", "./tsconfig.json"]
  }
};

export default nextConfig;
