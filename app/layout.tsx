import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "德州研习室｜单机德州扑克教学",
  description: "不涉及真钱的德州扑克单机教学游戏，边打边学位置、范围、底池赔率与下注尺度。",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
