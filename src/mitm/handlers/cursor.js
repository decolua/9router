/**
 * Cursor MITM handler — coming soon
 * This feature is currently under development.
 */
async function intercept(req, res) {
  res.writeHead(501, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    error: {
      message: "Cursor MITM support is coming soon.",
      type: "not_implemented"
    }
  }));
}

module.exports = { intercept };
