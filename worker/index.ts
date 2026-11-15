import { handleApiRequest } from "./api/router.ts";
import type { Env } from "./env.ts";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const api = await handleApiRequest(request, env, ctx);
    if (api) return api;
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;