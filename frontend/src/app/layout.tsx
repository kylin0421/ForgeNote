import type { Metadata } from "next";
import "./globals.css";
import { themeScript } from "@/lib/theme-script";

export const metadata: Metadata = {
  title: {
    default: "ForgeNote｜画像驱动的 AI 学习工作台",
    template: "%s｜ForgeNote",
  },
  description:
    "先通过自然对话理解学生，再由多智能体协作生成、编排与评估个性化多模态学习资源。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">
        {children}
      </body>
    </html>
  );
}
