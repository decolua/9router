import ModelMarketClient from "./ModelMarketClient";

export default async function ModelMarketPage({ searchParams }) {
  const params = await searchParams;
  const isDashboardView = params?.source === "dashboard";

  return <ModelMarketClient isDashboardView={isDashboardView} />;
}
