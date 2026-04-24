import ConsoleLogClient from "./ConsoleLogClient";
import React from "react";

// Force dynamic so Next.js standalone build includes the server-side JS file
export const dynamic = "force-dynamic";

export default function ConsoleLogPage() {
 return <ConsoleLogClient />;
}
