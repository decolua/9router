import { DEFAULT_LANG } from "@/constants/languages";

// Static-friendly redirect to default language (meta refresh + client script)
export const metadata = {
  title: "Redirecting...",
  other: {
    "http-equiv:refresh": `0; url=/${DEFAULT_LANG}/`
  }
};

export default function HomePage() {
  const target = `/${DEFAULT_LANG}/`;
  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: `window.location.replace("${target}");`
        }}
      />
      <meta httpEquiv="refresh" content={`0; url=${target}`} />
      <p style={{ padding: "2rem", textAlign: "center" }}>
        Redirecting to <a href={target}>{target}</a>...
      </p>
    </>
  );
}
