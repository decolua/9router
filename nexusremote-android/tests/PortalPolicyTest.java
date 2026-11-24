package za.nexusremote.portal;
public final class PortalPolicyTest {
  private static void check(boolean value, String label) { if(!value) throw new AssertionError(label); }
  public static void main(String[] args) {
    check(PortalPolicy.isTrusted("https://nexusremote-operations.vercel.app/"), "portal HTTPS");
    check(PortalPolicy.isTrusted("https://NEXUSREMOTE-OPERATIONS.VERCEL.APP:443/worker"), "canonical HTTPS port");
    for(String url:new String[]{"http://nexusremote-operations.vercel.app/", "https://nexusremote-operations.vercel.app:444/", "https://nexusremote-operations.vercel.app.evil.test/", "https://evil.test/", "file:///tmp/a", "https://user@nexusremote-operations.vercel.app/", "%%%", ""}) check(!PortalPolicy.isTrusted(url), "reject "+url);
    check(!PortalPolicy.isTrusted(null), "null URL");
    check("unknown".equals(PortalPolicy.integrationState(null)), "missing is unknown");
    check("unknown".equals(PortalPolicy.integrationState("true")), "string is not evidence");
    check("not connected".equals(PortalPolicy.integrationState(false)), "explicit false");
    check("reported enabled (unverified)".equals(PortalPolicy.integrationState(true)), "flag is not live verification");
    System.out.println("PortalPolicy: all checks passed");
  }
}
