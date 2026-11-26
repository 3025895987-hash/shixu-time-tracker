import { digest } from "./identity.mjs";
import { fail } from "./model.mjs";

const tokenPattern = /^[0-9a-f]{64}$/;
const validToken = value => typeof value === "string" && tokenPattern.test(value);
export function newToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
}

// The public view never needs to consult the private device registry.
export async function hostedAccess(request, db, masterHash) {
  const device = request.headers.get("x-shixu-device");
  const deviceId = validToken(device) ? "device:" + await digest(device) : null;
  const user = request.headers.get("oai-authenticated-user-id");
  const lookup = key => db.prepare("SELECT value FROM settings WHERE key=?").bind(key).first();
  const [registered, legacy] = await Promise.all([deviceId ? lookup(deviceId) : null, user ? lookup("owner") : null]);
  const owner = !!registered || !!(user && legacy?.value === user);
  return {
    mode: "sites", owner, signed: !!user,
    async claim(input) {
      if (!deviceId) fail("请重新打开个人记录链接。", 400);
      if (registered) return {ok:true};
      const hasKey = validToken(input?.key);
      if (owner || (hasKey && masterHash && await digest(input.key) === masterHash)) {
        await db.batch([db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES(?,'1')").bind(deviceId)]);
      } else if (validToken(input?.pair)) {
        const pairId = "pair:" + await digest(input.pair);
        // Activation and consumption are one transaction. A repeated request from
        // the same device is safe after a lost HTTP response.
        await db.batch([
          db.prepare("INSERT OR IGNORE INTO settings(key,value) SELECT ?, '1' FROM settings WHERE key=? AND CAST(value AS INTEGER)>?").bind(deviceId,pairId,Date.now()),
          db.prepare("DELETE FROM settings WHERE key=?").bind(pairId)
        ]);
        if (!await lookup(deviceId)) fail("连接链接已使用或已过期。请在已连接设备的设置里生成新链接。", 403);
      } else {
        fail("这个链接无法连接设备。请打开自己的专属记录链接。", 403);
      }
      return {ok:true};
    },
    async pair() {
      if (!owner) fail("请在已连接的设备上生成链接。", 403);
      const code = newToken();
      const expiresAt = Date.now() + 86400000;
      await db.batch([
        db.prepare("DELETE FROM settings WHERE key GLOB 'pair:*' AND CAST(value AS INTEGER)<=?").bind(Date.now()),
        db.prepare("INSERT INTO settings(key,value) VALUES(?,?)").bind("pair:"+await digest(code),String(expiresAt))
      ]);
      return {code,expiresAt};
    }
  };
}
