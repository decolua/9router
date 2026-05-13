import { DOCS_CONFIG } from "@/constants/docsConfig";
import "./globals.css";

export const metadata = {
  title: DOCS_CONFIG.title,
  description: DOCS_CONFIG.description,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="bg-[#FCFBF9] text-[#6B7280]">
        {children}
      </body>
    </html>
  );
}
