import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        head: ["'Noto Serif SC'", "serif"],
        body: ["'Noto Sans SC'", "sans-serif"],
      },
      colors: {
        // Style C — 暖白务实 色彩系统
        // 主色：墨绿
        green: {
          DEFAULT: "#2D6A4F",
          hover: "#245C44",
          soft: "#EAF4EE",
          mid: "#C8E6D4",
          line: "#95D5B2",
          50: "#EAF4EE",
          100: "#C8E6D4",
          500: "#2D6A4F",
          600: "#245C44",
          700: "#1D4D39",
        },
        // Pipeline 专属：靛蓝
        indigo: {
          DEFAULT: "#3D3D99",
          soft: "#EDEDF8",
          50: "#EDEDF8",
          100: "#D5D5F0",
          600: "#3D3D99",
          700: "#333380",
        },
        // 暖背景色
        warm: {
          bg: "#F7F5F0",
          card: "#FFFFFF",
          panel: "#F0EDE6",
          sidebar: "#F3F0EA",
        },
        // 暖边框
        "warm-border": "#DDD9D0",
        "warm-border-light": "#E8E4DC",
        // 暖文字
        "text-warm": "#1C1C1A",
        "text-warm-2": "#3D3D39",
        "text-warm-3": "#6B6860",
        "text-warm-4": "#9C9890",
        // 语义色
        amber: {
          DEFAULT: "#B45C0A",
          soft: "#FEF3E2",
          line: "#F0A44A",
          50: "#FEF3E2",
          500: "#B45C0A",
        },
        // 基础 token（向下兼容）
        border: "#DDD9D0",
        background: "#F7F5F0",
        foreground: "#1C1C1A",
        primary: {
          DEFAULT: "#2D6A4F",
          foreground: "#FFFFFF",
        },
        secondary: {
          DEFAULT: "#F0EDE6",
          foreground: "#3D3D39",
        },
        muted: {
          DEFAULT: "#F3F0EA",
          foreground: "#6B6860",
        },
        accent: {
          DEFAULT: "#EAF4EE",
          foreground: "#2D6A4F",
        },
        destructive: {
          DEFAULT: "#9B2020",
          foreground: "#FDEAEA",
        },
        success: {
          DEFAULT: "#2D6A4F",
          foreground: "#EAF4EE",
        },
        warning: {
          DEFAULT: "#B45C0A",
          foreground: "#FEF3E2",
        },
      },
      borderRadius: {
        DEFAULT: "4px",
        sm: "3px",
        md: "4px",
        lg: "4px",
        xl: "6px",
        "2xl": "8px",
        full: "99px",
      },
      boxShadow: {
        sm: "0 1px 3px rgba(28,28,26,0.06)",
        DEFAULT: "0 1px 3px rgba(28,28,26,0.06)",
        md: "0 3px 10px rgba(28,28,26,0.08)",
        lg: "0 6px 20px rgba(28,28,26,0.10)",
      },
    },
  },
  plugins: [],
};
export default config;
