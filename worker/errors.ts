// Invalid input. The REST API answers with err.status and the message; MCP tools return the message as a tool error.
export class BadRequest extends Error {
  readonly status: 400 | 404 = 400;
}

export class NotFound extends BadRequest {
  override readonly status = 404;
}
