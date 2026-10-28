import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const bebas = Bebas_Neue({
  variable: "--font-bebas",
  weight: "400",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WHITE LINKS — Le jeu secret du White Line Club ISSIG",
  description:
    "De petites attentions. Des liens invisibles. WHITE LINKS est le jeu de l'ami secret du White Line Club ISSIG : 14 jours de messages anonymes, de gentillesse et de connexions cachées.",
  keywords: ["White Line Club", "ISSIG", "Gabès", "ami secret", "WHITE LINKS", "jeu étudiant"],
  authors: [{ name: "White Line Club ISSIG" }],
  openGraph: {
    title: "WHITE LINKS — White Line Club ISSIG",
    description: "Small gestures. Secret connections. Le jeu de l'ami secret du club.",
    siteName: "White Line Club ISSIG",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body
        className={`${bebas.variable} ${inter.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
