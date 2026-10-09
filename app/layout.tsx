import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/app/providers";
import { AppHeader } from "@/widgets/app-header";
import "@/app/styles/globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: { default: "Binance Dashboard", template: "%s · Binance Dashboard" },
  description: "Личный дашборд по Binance: Earn и другие разделы",
};

// <meta name="color-scheme">: браузер не мигнёт светлым фоном до загрузки CSS.
export const viewport: Viewport = { colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full">
        <Providers>
          <AppHeader />
          <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-8">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
