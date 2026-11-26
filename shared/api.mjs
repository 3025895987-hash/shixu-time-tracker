import {DAY, KINDS, dayOf, midnight, validDay, totals, rangeDays, validateRecord, fail} from "./model.mjs";

const selectRecords = "SELECT id, kind, mode, start, end, day, minutes FROM records";
const insertRecord = "INSERT INTO records(id,kind,mode,start,end,day,minutes) VALUES(?,?,?,?,?,?,?)";
const values = r => [r.id,r.kind,r.mode,r.start,r.end,r.day,r.minutes];
const upsert = "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value";
const revisionSQL = "SELECT COALESCE(MAX(revision),0) AS value FROM changes";
const prefsSQL = "SELECT key,value FROM settings WHERE key IN ('goals','frozen')";
const json = (value,status=200,headers={}) => Response.json(value,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff",...headers}});
function preferences(rows) {
  const map=Object.fromEntries(rows.map(r=>[r.key,r.value]));
  return {goals:JSON.parse(map.goals||'{"work":0,"study":0}'),frozen:map.frozen==="1"};
}
function checkGoals(g) {
  if(!g || !KINDS.every(k=>Number.isInteger(g[k]) && g[k]>=0 && g[k]<=1440)) fail("目标须在 0 到 1440 分钟之间。");
  return {work:g.work,study:g.study};
}
function validateBackup(b, now) {
  if(!b || b.format!=="shixu" || b.version!==1 || b.timezone!=="Asia/Shanghai" || !Array.isArray(b.records)) fail("请选择时序的完整备份文件。");
  checkGoals(b.goals);
  const ids=new Set();
  for(const r of b.records) {
    validateRecord(r,now);
    if(ids.has(r.id)) fail("备份中有重复记录。");
    ids.add(r.id);
  }
  const timers=b.records.filter(r=>r.mode==="timer").sort((a,b)=>a.start-b.start || (a.end??Infinity)-(b.end??Infinity));
  for(let i=1;i<timers.length;i++) if(timers[i].start < (timers[i-1].end??Infinity)) fail("备份中的计时段重叠。");
}
export async function handleApi(request,db,auth) {
  const q=(sql,...args)=>{const s=db.prepare(sql);return args.length?s.bind(...args):s};
  const url=new URL(request.url), path=url.pathname, now=Date.now();
  try {
    if(request.method==="POST" && request.headers.get("origin") && request.headers.get("origin")!==url.origin) fail("请求来源无效。",403);
    if(path==="/api/access" && request.method==="GET") return json({owner:auth.owner,signed:auth.signed,mode:auth.mode,claimed:auth.claimed});
    if(path==="/api/claim" && request.method==="POST" && auth.claim) return json(await auth.claim(await request.json()));
    const pub=path==="/api/public";
    if(!pub && !auth.owner) fail("请使用记录者账户登录。",403);
    if((pub || path==="/api/state") && request.method==="GET") {
      const date=url.searchParams.get("date")||dayOf(now);
      if(!validDay(date) || date>dayOf(now)) fail("请选择今天或更早的日期。");
      const days=rangeDays(date), left=midnight(days[0]),right=midnight(date)+DAY;
      const scope=" WHERE (mode='manual' AND day BETWEEN ? AND ?) OR (mode='timer' AND start < ? AND COALESCE(end,?) > ?)";
      const queries=[q(selectRecords+scope+" ORDER BY start,id",days[0],date,right,now+1,left)];
      if(!pub)queries.push(q(revisionSQL),q(prefsSQL),q(selectRecords+" WHERE mode='timer' AND end IS NULL"));
      const [entries,revision,config,active]=await db.batch(queries);
      const rows=entries.results, daily=days.map(day=>({day,...totals(rows,day,now,false)}));
      if(pub) return json({date,daily});
      const begin=midnight(date);
      const details=rows.filter(r=>r.mode==="manual"?r.day===date:r.start<right && (r.end??now+1)>begin);
      return json({date,daily,records:details,active:active.results[0]||null,revision:revision.results[0].value,...preferences(config.results)});
    }
    if(path==="/api/backup" && request.method==="GET"){
      const [entries,config]=await db.batch([q(selectRecords+" ORDER BY id"),q(prefsSQL)]);
      return json({format:"shixu",version:1,timezone:"Asia/Shanghai",exportedAt:new Date(now).toISOString(),goals:preferences(config.results).goals,records:entries.results},200,{"Content-Disposition":'attachment; filename="shixu-'+dayOf(now)+'.json"'});
    }
    if(path!=="/api/change" || request.method!=="POST")fail("没有这个接口。",404);
    const body=await request.json(), {action,token,revision}=body;
    if(typeof token!=="string" || !/^[A-Za-z0-9_-]{8,80}$/.test(token)|| !Number.isSafeInteger(revision)||revision<0)fail("请刷新后再试。");
    const [seen,ver,config,open]=await db.batch([q("SELECT revision FROM changes WHERE token=?",token),q(revisionSQL),q(prefsSQL),q(selectRecords+" WHERE mode='timer' AND end IS NULL")]);
    if(seen.results.length)return json({ok:true});
    if(ver.results[0].value!==revision)fail("另一台设备刚更新了记录，请核对后再试。",409);
    if(preferences(config.results).frozen && action!=="freeze")fail("当前记录已设为只读。",409);
    const active=open.results[0], statements=[q("INSERT INTO changes(revision,token) VALUES(?,?)",revision+1,token)];
    function add(r){validateRecord(r,now);statements.push(q(insertRecord,...values(r)));}
    if(action==="start"||action==="stop"){
      if(action==="start" && !KINDS.includes(body.kind))fail("请选择工作或学习。");
      if(action==="stop" && !active)fail("当前没有进行中的计时。",409);
      if(active && action==="start" && active.kind===body.kind)fail("已经在计时。",409);
      if(active)statements.push(q("UPDATE records SET end=? WHERE id=?",Math.max(active.start,now),active.id));
      if(action==="start")add({id:crypto.randomUUID(),mode:"timer",kind:body.kind,start:now,end:null,day:null,minutes:null});
    }else if(action==="manual"){
      add({id:crypto.randomUUID(),mode:"manual",kind:body.kind,start:null,end:null,day:body.day,minutes:body.minutes});
    }else if(action==="edit"||action==="remove"){
      const r=await q(selectRecords+" WHERE id=?",body.id).first();
      if(!r || (r.mode==="timer"&&r.end===null))fail("请先结束计时，再编辑这条记录。");
      if(action==="remove")statements.push(q("DELETE FROM records WHERE id=?",r.id));
      else{
        const edit={...r,kind:body.kind,...(r.mode==="manual"?{day:body.day,minutes:body.minutes}:{start:body.start,end:body.end})};validateRecord(edit,now);
        if(edit.mode==="timer" && await q("SELECT id FROM records WHERE id!=? AND mode='timer' AND start<? AND COALESCE(end,?)>? LIMIT 1",r.id,edit.end,now+1,edit.start).first())fail("这段时间与另一条计时记录重叠。");
        statements.push(q("UPDATE records SET kind=?,start=?,end=?,day=?,minutes=? WHERE id=?",edit.kind,edit.start,edit.end,edit.day,edit.minutes,r.id));
      }
    }else if(action==="goals"){statements.push(q(upsert,"goals",JSON.stringify(checkGoals(body.goals))));}
    else if(action==="freeze"){if(typeof body.frozen!=="boolean")fail("只读设置无效。");statements.push(q(upsert,"frozen",body.frozen?"1":"0"));}
    else if(action==="restore"){
      if(await q("SELECT id FROM records LIMIT 1").first())fail("请将备份恢复到空数据库。");
      const b=body.backup;validateBackup(b,now);
      statements.push(q(upsert,"goals",JSON.stringify(checkGoals(b.goals))));
      for(let i=0;i<b.records.length;i+=100){
        statements.push(q("INSERT INTO records(id,kind,mode,start,end,day,minutes) SELECT json_extract(value,'$.id'),json_extract(value,'$.kind'),json_extract(value,'$.mode'),json_extract(value,'$.start'),json_extract(value,'$.end'),json_extract(value,'$.day'),json_extract(value,'$.minutes') FROM json_each(?)",JSON.stringify(b.records.slice(i,i+100))));
      }
    }else fail("未知操作。");
    try{await db.batch(statements);}catch(e){
      if(await q("SELECT revision FROM changes WHERE token=?",token).first())return json({ok:true});
      if((await q(revisionSQL).first()).value!==revision)fail("记录已在另一台设备更新。",409);
      throw e;
    }
    return json({ok:true});
  }catch(e){if(!e.status && !(e instanceof SyntaxError))console.error("Request failed",path,e.message);return json({error:e.status?e.message:e instanceof SyntaxError?"请求格式不正确。":"暂时无法保存或读取数据，请重试。"},e.status|| (e instanceof SyntaxError?400:500));}
}
