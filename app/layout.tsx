import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Email Screenshot → MJML",
  description: "Convert email design screenshots into editable, Outlook-safe MJML and HTML.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
