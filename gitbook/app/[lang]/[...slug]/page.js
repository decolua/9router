import DocsLayout from "@/components/DocsLayout";
import DocsContent from "@/components/DocsContent";
import { extractHeadings } from "@/utils/markdown";
import { loadContent, getAllSlugs } from "@/lib/content";
import { LANG_CODES, isValidLang, DEFAULT_LANG } from "@/constants/languages";
import { notFound } from "next/navigation";

export const dynamicParams = false;

export async function generateStaticParams() {
  // Build params for every (lang × slug) combination based on default language slugs.
  const slugs = getAllSlugs(DEFAULT_LANG);
  const params = [];
  for (const lang of LANG_CODES) {
    for (const slug of slugs) {
      params.push({ lang, slug });
    }
  }
  return params;
}

export default async function DocPage({ params }) {
  const { lang, slug } = await params;
  if (!isValidLang(lang)) notFound();

  const content = loadContent(lang, slug);
  if (!content) notFound();

  const headings = extractHeadings(content);

  return (
    <DocsLayout headings={headings} lang={lang}>
      <DocsContent content={content} />
    </DocsLayout>
  );
}
