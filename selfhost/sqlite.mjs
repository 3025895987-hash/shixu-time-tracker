import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
export function openStore(filename){
  const db=new DatabaseSync(filename);db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000");
  db.exec("CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)");
  const dir=new URL("../drizzle/",import.meta.url);
  for(const name of readdirSync(dir).filter(n=>n.endsWith(".sql")).sort()){
    if(db.prepare("SELECT name FROM local_migrations WHERE name=?").get(name))continue;
    db.exec("BEGIN IMMEDIATE");try{
      db.exec(readFileSync(new URL(name,dir),"utf8"));
      db.prepare("INSERT INTO local_migrations(name) VALUES(?)").run(name);db.exec("COMMIT");
    }catch(e){db.exec("ROLLBACK");throw e}
  }
  function prepare(sql,params=[]){return {bind:(...args)=>prepare(sql,args),first:()=>db.prepare(sql).get(...params)||null,all:()=>({results:db.prepare(sql).all(...params)})}}
  return {prepare,close:()=>db.close(),batch(statements){
    db.exec("BEGIN IMMEDIATE");try{const rows=statements.map(s=>s.all());db.exec("COMMIT");return rows}catch(e){db.exec("ROLLBACK");throw e}
  }};
}
