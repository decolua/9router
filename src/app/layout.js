import { Inter } from "next/font/google";
import "material-symbols/outlined.css";
import "./globals.css";
import { ThemeProvider } from "@/shared/components/ThemeProvider";
import { RuntimeI18nProvider } from "@/i18n/RuntimeI18nProvider";
import { execSync } from "node:child_process";
import pkg from "../../package.json";

// Build/runtime-time version stamp for production debugging.
// Resolved once at module load: app version from package.json + short git commit.
// ponynote: commit falls back to "unknown" if git unavailable (e.g. bare deploy).
function resolveCommit() {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}
const APP_VERSION = pkg.version;
const GIT_COMMIT = resolveCommit();

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

// Google Analytics — inlined instead of @next/third-parties/google's <GoogleAnalytics />,
// which depends on next/script and does not render under vinext's SSR.
const GA_ID = "G-LC959F603F";
const gaScript = `
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${GA_ID}');
`;

export const metadata = {
  title: "9Router - AI Infrastructure Management",
  description: "One endpoint for all your AI providers. Manage keys, monitor usage, and scale effortlessly.",
  icons: {
    icon: "/favicon.svg",
  },
};

export const viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning data-version={APP_VERSION} data-commit={GIT_COMMIT}>
      <head>
        <meta name="app-version" content={APP_VERSION} />
        <meta name="app-commit" content={GIT_COMMIT} />
        <script
          dangerouslySetInnerHTML={{
            __html: `if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){document.documentElement.classList.add('fonts-loaded')})}else{document.documentElement.classList.add('fonts-loaded')}`,
          }}
        />
        {/* Google Analytics */}
        <script
          async
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        />
        <script dangerouslySetInnerHTML={{ __html: gaScript }} />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider>
          <RuntimeI18nProvider>
            {children}
          </RuntimeI18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
