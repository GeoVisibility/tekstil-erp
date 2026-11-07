import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tekstil Üretim Takip",
  description: "Tekstil imalatı üretim ve görev takip sistemi",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body className="font-sans">{children}</body>
    </html>
  );
}
