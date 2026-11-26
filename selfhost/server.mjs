import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {readFileSync,mkdirSync,existsSync,writeFileSync} from "node:fs";
import {randomBytes,createHash,createHmac,timingSafeEqual} from "node:crypto";
import {openStore} from "./sqlite.mjs";
import {handleApi} from "../shared/api.mjs";
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,"..");
const index='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#101319"><title>时序 · 每日工作与学习</title><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/mark.svg"><link rel="apple-touch-icon" href="/icon-192.png"><link rel="stylesheet" href="/desk.css"></head><body><div id="app" aria-busy="true"><div class="loading">正在读取时序…</div></div><script type="module" src="/ui.js"></script></body></html>';
const assets={"ui.js":"text/javascript","desk.css":"text/css","time-model.mjs":"text/javascript","mark.svg":"image/svg+xml","icon-192.png":"image/png","icon-512.png":"image/png","manifest.webmanifest":"application/manifest+json"};
const hash=v=>createHash("sha256").update(v).digest();
export function createServer({database,password,publicOrigin}){
  if(!password)throw Error("需要设置站主密码");
  const db=openStore(database),secret=hash("shixu-cookie-v1/"+password),digest=hash(password),attempts=new Map();
  const sign=exp=>createHmac("sha256",secret).update(exp).digest("hex");
  const server=http.createServer(async(incoming,out)=>{
    const send=(status,headers,body)=>{out.writeHead(status,{"X-Content-Type-Options":"nosniff","Referrer-Policy":"same-origin",...headers});out.end(body)};
    try{
      const url=new URL(incoming.url,publicOrigin||("http://"+incoming.headers.host));
      if(url.pathname.startsWith("/api/")){
        const chunks=[];let size=0;
        for await(const c of incoming){size+=c.length;if(size>16*1024*1024){send(413,{},'{"error":"备份文件过大。"}');return}chunks.push(c)}
        const req=new Request(url,{method:incoming.method,headers:incoming.headers,body:chunks.length?Buffer.concat(chunks):undefined});
        const cookie=(incoming.headers.cookie||"").split(";").map(c=>c.trim()).find(s=>s.startsWith("shixu_owner="))?.slice(12)||"";
        const [exp,signature]=cookie.split(".");
        const owner=/^\d{13}$/.test(exp)&&Number(exp)>Date.now()&& /^[0-9a-f]{64}$/.test(signature||"") && timingSafeEqual(Buffer.from(signature,"hex"),Buffer.from(sign(exp),"hex"));
        let result;
        if(url.pathname==="/api/login" && incoming.method==="POST"){
          if(req.headers.get("origin") && req.headers.get("origin")!==url.origin){send(403,{},'{}');return}
          const ip=incoming.socket.remoteAddress,now=Date.now(),a=attempts.get(ip);
          if(a && a.until>now && a.count>=10){result=Response.json({error:"尝试次数过多，请稍后再试。"},{status:429})}
          else if(!timingSafeEqual(hash(String((await req.json()).password||"")),digest)){
            attempts.set(ip,{count:a?.until>now?a.count+1:1,until:a?.until>now?a.until:now+600000});result=Response.json({error:"密码不正确。"},{status:403});
          }else{
            attempts.delete(ip);const expiry=String(now+60*86400000);
            result=Response.json({ok:true},{headers:{"Set-Cookie":"shixu_owner="+expiry+"."+sign(expiry)+"; HttpOnly; SameSite=Strict; Path=/; Max-Age=5184000"+(url.protocol==="https:"?"; Secure":"")}});
          }
        }else{result=await handleApi(req,db,{owner:!!owner,signed:!!owner,mode:"self",claimed:true});}
        send(result.status,{"Cache-Control":"no-store",...Object.fromEntries(result.headers)},Buffer.from(await result.arrayBuffer()));return;
      }
      if(incoming.method!=="GET"&&incoming.method!=="HEAD"){send(405,{},'');return}
      if(["/","/share","/share/"].includes(url.pathname)){send(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-cache"},index);return}
      const file=url.pathname.slice(1);if(Object.hasOwn(assets,file)){send(200,{"Content-Type":assets[file],"Cache-Control":"no-cache"},readFileSync(path.join(root,"public",file)));return}
      send(404,{},"Not found");
    }catch(err){console.error("HTTP request failed",err.message);send(500,{"Content-Type":"application/json"},JSON.stringify({error:"暂时无法完成请求。"}))}
  });
  server.on("close",()=>db.close());return server;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const local=process.argv.includes("--local");
  const dir=path.resolve(process.env.DATA_DIR||path.join(root,"outputs","local-data"));mkdirSync(dir,{recursive:true});
  let password=process.env.OWNER_PASSWORD;
  const port=Number(process.env.PORT||4186),host=local?"127.0.0.1":(process.env.BIND||"127.0.0.1");
  if(!password&&local){
    const keyfile=path.join(dir,"local-key");
    if(!existsSync(keyfile))writeFileSync(keyfile,randomBytes(32).toString("base64url"),{flag:"wx",mode:0o600});
    password=readFileSync(keyfile,"utf8");
    writeFileSync(path.join(dir,"打开我的时序.url"),"[InternetShortcut]\r\nURL=http://127.0.0.1:"+port+"/#key="+password+"\r\n");
  }
  const server=createServer({database:path.join(dir,"shixu.sqlite"),password,publicOrigin:process.env.PUBLIC_ORIGIN});
  server.listen(port,host,()=>console.log("时序 http://"+host+":"+port));
}
