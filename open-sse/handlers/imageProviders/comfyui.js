// ComfyUI — local, noAuth (placeholder; full graph workflow not implemented)
const provider = {
  noAuth: true,
  buildUrl: () => "http://localhost:8188",
  buildHeaders: () => ({ "Content-Type": "application/json" }),
  buildBody: (_model, body) => ({ prompt: body.prompt }),
  normalize: (responseBody) => responseBody,
};

export default provider;
