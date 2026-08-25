import { redirect } from "next/navigation";

export default function SmartRoutingAnalysisPage() {
  redirect("/dashboard/usage?tab=smart-routing");
}
