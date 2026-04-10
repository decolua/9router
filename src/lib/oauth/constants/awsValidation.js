export const AWS_REGION_PATTERN = /^[a-z]{2}-[a-z0-9-]+-\d+$/;
export const AWS_SSO_HOST_PATTERN = /^[a-z0-9-]+\.awsapps\.com$/i;

export function validateAwsSsoStartUrl(startUrl) {
  try {
    const parsed = new URL(startUrl);
    if (parsed.protocol !== "https:") {
      return { valid: false, error: "Invalid startUrl. Must start with https://" };
    }
    if (parsed.username || parsed.password) {
      return { valid: false, error: "Invalid startUrl format" };
    }
    if (!AWS_SSO_HOST_PATTERN.test(parsed.hostname)) {
      return { valid: false, error: "Invalid startUrl. Must be an AWS IAM Identity Center URL" };
    }
    if (!parsed.pathname.startsWith("/start")) {
      return { valid: false, error: "Invalid startUrl. Must point to AWS IAM Identity Center /start URL" };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid startUrl format" };
  }
}
