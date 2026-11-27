export function buildCloudflareWorkerUploadRequest({
  scriptName,
  scriptContent,
  bindings = [],
  metadata = {},
}) {
  const boundary = `----9routerBoundary${Date.now()}${Math.random().toString(16).slice(2)}`;
  const CRLF = "\r\n";

  const metaValue = JSON.stringify({
    main_module: scriptName,
    bindings,
    ...metadata,
  });

  const parts = [];

  parts.push(
    `--${boundary}${CRLF}`,
    `Content-Disposition: form-data; name="metadata"${CRLF}`,
    `Content-Type: application/json${CRLF}`,
    `${CRLF}`,
    `${metaValue}${CRLF}`
  );

  parts.push(
    `--${boundary}${CRLF}`,
    `Content-Disposition: form-data; name="index.js"; filename="${scriptName}"${CRLF}`,
    `Content-Type: application/javascript+module${CRLF}`,
    `${CRLF}`,
    `${scriptContent}${CRLF}`
  );

  parts.push(`--${boundary}--${CRLF}`);

  const body = Buffer.from(parts.join(""));
  const contentType = `multipart/form-data; boundary=${boundary}`;

  return { body, contentType };
}