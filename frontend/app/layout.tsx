import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AEP — AI Employee Platform",
  description: "Holiday Extras AI Employee Platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-surface text-gray-200 antialiased">
        {children}
      </body>
    </html>
  );
}
