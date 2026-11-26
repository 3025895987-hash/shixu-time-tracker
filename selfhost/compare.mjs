import assert from "node:assert/strict";import {readFileSync} from "node:fs";
const [oldFile,newFile]=process.argv.slice(2);if(!oldFile||!newFile)throw Error("需要两份备份的路径");
const clean=file=>{const {exportedAt,...b}=JSON.parse(readFileSync(file,"utf8"));b.records.sort((a,z)=>a.id.localeCompare(z.id));return b};
const a=clean(oldFile);assert.deepEqual(a,clean(newFile));console.log("核对一致："+a.records.length+" 条记录、目标与时区。");
