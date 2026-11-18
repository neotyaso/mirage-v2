import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MIRAGE",
  description: "Real-time conversational performer and dance stage",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
