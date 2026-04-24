import PricingPageClient from "./PricingPageClient";
import { getPricing } from "@/lib/localDb";

export default async function PricingSettingsPage() {
  const pricing = await getPricing();

  return <PricingPageClient initialPricing={pricing} />;
}
