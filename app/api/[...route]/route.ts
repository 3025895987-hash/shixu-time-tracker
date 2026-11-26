import { env } from "cloudflare:workers";
import { handleApi } from "../../../shared/api.mjs";
import { digest } from "../../../shared/identity.mjs";
export const dynamic = "force-dynamic";
async function route(req: Request) {
  const bindings=env as unknown as { DB: D1Database; CLAIM_HASH?: string };
  const db=bindings.DB;
  const user=req.headers.get("oai-authenticated-user-id");
  const binding=await db.prepare("SELECT value FROM settings WHERE key='owner'").first<{value:string}>();
  return handleApi(req,db,{
    owner:!!user && binding?.value===user,signed:!!user,claimed:!!binding,mode:"sites",
    async claim(input:{key?:string}){
      if(!user || binding || !bindings.CLAIM_HASH || typeof input.key!=="string" || await digest(input.key)!==bindings.CLAIM_HASH) throw Object.assign(new Error("请从你的首次启用链接打开，并使用自己的账户登录。"),{status:403});
      await db.prepare("INSERT INTO settings(key,value) VALUES('owner',?) ON CONFLICT DO NOTHING").bind(user).run();
      const row=await db.prepare("SELECT value FROM settings WHERE key='owner'").first<{value:string}>();
      if(row?.value!==user)throw Object.assign(new Error("站主已经绑定。"),{status:403});
      return {ok:true};
    }
  });
}
export { route as GET, route as POST };
