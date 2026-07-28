import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "holdem-dojo-cn.taitingding.chatgpt.site";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  return {
    title: "德州研习室｜从零开始学德州扑克",
    description: "连扑克牌都不认识也能学：一次只讲一个概念，再用不涉及真钱的单机牌桌慢慢练习。",
    icons: { icon: "/favicon.svg" },
    openGraph: {
      title: "德州研习室",
      description: "从零认识第一张牌，再学会第一手德州。",
      images: [{ url: image, width: 1672, height: 941, alt: "德州研习室：从零认识第一张牌" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "德州研习室",
      description: "从零认识第一张牌，再学会第一手德州。",
      images: [image],
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
