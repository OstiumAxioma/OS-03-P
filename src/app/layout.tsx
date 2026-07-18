import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "LUMEN — Medical Slice Atlas",
  description: "An isometric vtk.js and Three.js medical slice study."
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#53ffba"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
