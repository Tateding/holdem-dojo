import type { Metadata } from "next";
import "./globals.css";

export function generateMetadata(): Metadata {
  return {
    title: "Hold'em Dojo | Learn Texas Hold'em from Zero",
    description: "Learn Texas Hold'em from your first card: beginner lessons, three AI levels, heads-up and six-max training, with no real money.",
    icons: { icon: "/favicon.svg" },
    openGraph: {
      title: "Hold'em Dojo",
      description: "Meet your first card, then learn your first hand.",
    },
    twitter: {
      card: "summary_large_image",
      title: "Hold'em Dojo",
      description: "Meet your first card, then learn your first hand.",
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
