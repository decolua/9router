// Auto-initialize cloud sync when server starts
// Removed: import "@/lib/initCloudSync"; — initialization happens at runtime via middleware
import { redirect } from "next/navigation";

export default function InitPage() {
  redirect('/dashboard');
}
