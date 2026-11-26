import test from "node:test";
import assert from "node:assert/strict";
import {openStore} from "../selfhost/sqlite.mjs";
import {handleApi} from "../shared/api.mjs";
import {DAY,dayOf,midnight,rangeDays,totals} from "../shared/model.mjs";
const owner={owner:true,signed:true,claimed:true,mode:"self"};
function client(db,identity=owner){
  async function req(path,body){const r=await handleApi(new Request("https://test.example/api/"+path,body?{method:"POST",body:JSON.stringify(body)}:{}),db,identity);return [r.status,await r.json()]}
  return {req,state:async()=>(await req("state"))[1],change:async(rev,action,data={})=>req("change",{revision:rev,token:crypto.randomUUID(),action,...data})};
}
test("two devices share one timer, deduplicate retries and reject stale edits",async()=>{
  const db=openStore(":memory:"),a=client(db),b=client(db),id=crypto.randomUUID();
  assert.equal((await a.change(0,"start",{kind:"work",token:id}))[0],200);
  assert.equal((await b.change(0,"start",{kind:"work",token:id}))[0],200);
  assert.equal((await b.state()).active.kind,"work");
  assert.equal((await a.change(1,"start",{kind:"study"}))[0],200);
  assert.equal((await b.change(1,"stop"))[0],409);
  assert.equal((await b.change(2,"stop"))[0],200);
  const [_,backup]=await a.req("backup");assert.equal(backup.records.length,2);
  const work=backup.records.find(r=>r.kind==="work"),study=backup.records.find(r=>r.kind==="study");
  assert.equal(work.end,study.start);assert.ok(study.end>=study.start);
  const race=await Promise.all([a.change(3,"start",{kind:"study"}),b.change(3,"start",{kind:"work"})]);assert.deepEqual(race.map(r=>r[0]).sort(),[200,409]);db.close();
});
test("record corrections, freeze, public scope and cross-midnight totals",async()=>{
  const db=openStore(":memory:"),c=client(db),pub=client(db,{owner:false}),day="2025-07-16",base=midnight(day);
  const rec={id:"overnight",mode:"timer",kind:"work",start:base-600000,end:base+600000,day:null,minutes:null};
  const backup={format:"shixu",version:1,timezone:"Asia/Shanghai",goals:{work:120,study:60},records:[rec]};
  assert.equal((await c.change(0,"restore",{backup}))[0],200);
  const vals=(await pub.req("public?date="+day))[1];assert.deepEqual(Object.keys(vals).sort(),["daily","date"]);assert.equal(vals.daily.at(-1).work,600000);assert.equal(vals.daily.at(-2).work,600000);
  for(const path of ["state","backup","change"])assert.equal((await pub.req(path))[0],403);
  assert.equal((await c.change(1,"manual",{kind:"study",minutes:12,day}))[0],200);
  const r=(await c.req("state?date="+day))[1].records.find(row=>row.mode==="manual");
  assert.equal((await c.change(2,"edit",{id:r.id,kind:r.kind,minutes:42,day}))[0],200);
  assert.equal((await pub.req("public?date="+day))[1].daily.at(-1).study,42*60000);
  assert.equal((await c.change(3,"remove",{id:r.id}))[0],200);
  assert.equal((await c.change(4,"freeze",{frozen:true}))[0],200);
  assert.equal((await c.change(5,"manual",{kind:"study",minutes:12,day}))[0],409);
  assert.equal((await c.change(5,"freeze",{frozen:false}))[0],200);
  assert.equal((await c.change(6,"edit",{id:"overnight",kind:"work",start:base-600000,end:base+300000}))[0],200);
  assert.equal((await pub.req("public?date="+day))[1].daily.at(-1).work,300000);db.close();
});
export function yearBackup(){
  const first=midnight(dayOf())-365*DAY,records=[];
  for(let i=0;i<365;i++){const d=first+i*DAY;records.push({id:"w-"+i,mode:"timer",kind:"work",start:d+9*3600000,end:d+9*3600000+1000*(61+i),day:null,minutes:null},{id:"s-"+i,mode:"manual",kind:"study",start:null,end:null,day:dayOf(d),minutes:i%90+1})}
  records.push({id:"cross",mode:"timer",kind:"study",start:first+DAY-600000,end:first+DAY+600000,day:null,minutes:null},{id:"active",mode:"timer",kind:"work",start:midnight(dayOf()),end:null,day:null,minutes:null});
  return {format:"shixu",version:1,timezone:"Asia/Shanghai",goals:{work:240,study:60},records};
}
test("year backup round trip and invalid restore leaves empty database",async()=>{
  const a=openStore(":memory:"),b=openStore(":memory:"),c=client(a),dest=client(b);
  const original=yearBackup(),bad=structuredClone(original);bad.records.push(bad.records[0]);
  assert.equal((await dest.change(0,"restore",{backup:bad}))[0],400);assert.equal((await dest.state()).revision,0);
  assert.equal((await c.change(0,"restore",{backup:original}))[0],200);
  const exported=(await c.req("backup"))[1];assert.equal((await dest.change(0,"restore",{backup:exported}))[0],200);
  const imported=(await dest.req("backup"))[1];assert.deepEqual(imported.records,exported.records);assert.deepEqual(imported.goals,exported.goals);
  for(const d of rangeDays(dayOf(),366))assert.deepEqual(totals(imported.records,d),totals(original.records,d));
  assert.equal((await dest.state()).active.id,"active");assert.equal((await dest.change(1,"stop"))[0],200);
  assert.equal((await dest.change(2,"restore",{backup:original}))[0],400);a.close();b.close();
});
