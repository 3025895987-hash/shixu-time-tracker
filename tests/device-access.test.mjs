import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../selfhost/sqlite.mjs";
import { digest } from "../shared/identity.mjs";
import { handleApi } from "../shared/api.mjs";
import { hostedAccess, newToken } from "../shared/hosted-access.mjs";

test("private links connect browsers without ChatGPT and public links grant read-only access", async () => {
  const db = openStore(":memory:"), key = newToken(), masterHash = await digest(key);
  const firstDevice = newToken(), phone = newToken();
  async function call(path, {device, user, body, origin} = {}) {
    const headers = new Headers();
    if (device) headers.set("X-Shixu-Device",device);
    if (user) headers.set("oai-authenticated-user-id",user);
    if (origin) headers.set("Origin",origin);
    const request = new Request("https://example.test/api/"+path,{headers,method:body?"POST":"GET",body:body?JSON.stringify(body):undefined});
    return handleApi(request,db,await hostedAccess(request,db,masterHash));
  }
  try {
    assert.equal((await call("public")).status,200);
    for (const name of ["state","backup","change","pair"]) {
      assert.equal((await call(name,{body:["pair","change"].includes(name)?{}:undefined})).status,403);
    }
    assert.equal((await (await call("access",{user:"unbound-user"})).json()).owner,false);
    assert.equal((await call("claim",{device:firstDevice,body:{key:newToken()}})).status,403);
    assert.equal((await call("claim",{device:firstDevice,body:{key},origin:"https://another.example"})).status,403);
    assert.equal((await call("claim",{device:firstDevice,body:{key}})).status,200);
    assert.equal((await call("state",{device:firstDevice})).status,200);
    const {code}=await (await call("pair",{device:firstDevice,body:{}})).json();
    assert.equal((await call("claim",{device:phone,body:{pair:code}})).status,200);
    assert.equal((await call("claim",{device:phone,body:{pair:code}})).status,200);
    assert.equal((await call("claim",{device:newToken(),body:{pair:code}})).status,403);
    const expired=await (await call("pair",{device:phone,body:{}})).json();
    db.batch([db.prepare("UPDATE settings SET value='0' WHERE key=?").bind("pair:"+await digest(expired.code))]);
    assert.equal((await call("claim",{device:newToken(),body:{pair:expired.code}})).status,403);
    assert.equal((await call("change",{device:phone,body:{revision:0,action:"start",kind:"work",token:newToken()}})).status,200);
    const state=await (await call("state",{device:firstDevice})).json();assert.equal(state.active.kind,"work");
    assert.equal((await call("change",{device:firstDevice,body:{revision:state.revision,action:"stop",token:newToken()}})).status,200);
    const backup=await (await call("backup",{device:phone})).json();assert.equal(backup.records.length,1);
    assert.doesNotMatch(JSON.stringify(backup),/device:|pair:/);
    db.batch([db.prepare("INSERT INTO settings(key,value) VALUES('owner',?)").bind("legacy-owner")]);
    assert.equal((await call("state",{user:"legacy-owner"})).status,200);
    assert.equal((await call("state",{user:"another-user"})).status,403);
  } finally { db.close(); }
});
