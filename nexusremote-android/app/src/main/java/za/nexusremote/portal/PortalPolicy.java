package za.nexusremote.portal;

import java.net.URI;

final class PortalPolicy {
  private PortalPolicy() {}
  static boolean isTrusted(String value) {
    if (value == null) return false;
    try {
      URI uri = new URI(value);
      return "https".equalsIgnoreCase(uri.getScheme())
          && "nexusremote-operations.vercel.app".equalsIgnoreCase(uri.getHost())
          && uri.getRawUserInfo() == null
          && (uri.getPort() == -1 || uri.getPort() == 443);
    } catch (Exception invalid) { return false; }
  }
  static String integrationState(Object value) {
    if (Boolean.TRUE.equals(value)) return "reported enabled (unverified)";
    if (Boolean.FALSE.equals(value)) return "not connected";
    return "unknown";
  }
}
