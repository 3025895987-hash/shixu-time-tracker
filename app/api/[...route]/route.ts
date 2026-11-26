import { env } from "cloudflare:workers";
import { handleApi } from "../../../shared/api.mjs";
import { hostedAccess } from "../../../shared/hosted-access.mjs";

export const dynamic = "force-dynamic";
async function route(request: Request) {
  const { DB, CLAIM_HASH } = env as unknown as { DB: D1Database; CLAIM_HASH?: string };
  const auth = new URL(request.url).pathname === "/api/public"
    ? { owner: false, mode: "sites" }
    : await hostedAccess(request, DB, CLAIM_HASH);
  return handleApi(request, DB, auth);
}
export { route as GET, route as POST };
