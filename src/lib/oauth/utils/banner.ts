/**
 * Display banner
 */
export function showBanner() {
  console.log("\n  8Router - AI Infrastructure Management");
  console.log("  🚀 OAuth CLI for AI Providers\n");
}

/**
 * Display simple banner (no animation)
 */
export function showSimpleBanner() {
  console.log("  8Router - AI Infrastructure Management");
  console.log("  OAuth CLI for AI Providers\n");
}

/**
 * Display success animation
 */
export async function showSuccess(message: string): Promise<void> {
  console.log(`\n  ✨ ${message}\n`);
}

/**
 * Display loading animation
 */
export function showLoading(text: string) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  
  const interval = setInterval(() => {
    process.stdout.write(`\r${frames[i]} ${text}`);
    i = (i + 1) % frames.length;
  }, 80);

  return {
    stop: () => {
      clearInterval(interval);
      process.stdout.write("\r");
    },
  };
}
