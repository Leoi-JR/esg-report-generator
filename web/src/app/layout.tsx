import type { Metadata } from "next";
import { Noto_Serif_SC, Noto_Sans_SC } from "next/font/google";
import "./globals.css";

const notoSerifSC = Noto_Serif_SC({
  weight: ["400", "600", "700"],
  subsets: ["latin"],
  variable: "--font-head",
  display: "swap",
});

const notoSansSC = Noto_Sans_SC({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ESG 报告编辑平台",
  description: "ESG 报告协作编辑平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={`${notoSerifSC.variable} ${notoSansSC.variable}`}>
        {children}
      </body>
    </html>
  );
}
