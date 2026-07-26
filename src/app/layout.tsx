import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ARVritivo | Splat portal",
  description: "Publish and stream Gaussian splat scenes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
