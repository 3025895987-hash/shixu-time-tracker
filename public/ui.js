import {DAY,dayOf,midnight,clockText,names,rangeDays} from "./time-model.mjs";

const app=document.getElementById("app");
const sharePage=location.pathname.replace(/\/$/,"")==="/share";
let publicView=sharePage;
const queryDay=new URLSearchParams(location.search).get("day");
let date=queryDay||dayOf(), snapshot, access, busy=false, loadId=0, dialog, toastTimer, clockDay=dayOf(), pinToday=!queryDay;
const deviceSlot="shixu-device-v1";
function deviceKey(){
  try{return localStorage.getItem(deviceSlot)||""}catch{return ""}
}
function rememberDevice(){
  if(deviceKey())return;
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  const device=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
  try{localStorage.setItem(deviceSlot,device)}catch{throw new Error("浏览器未允许保存设备。请允许本站存储，再打开个人记录链接。")}
}
function pendingLink(){
  const fragment=new URLSearchParams(location.hash.slice(1));
  for(const type of ["key","pair"]){if(fragment.get(type))return {type,value:fragment.get(type)}}
  try{const old=sessionStorage.getItem("shixu-key");if(old)return {type:"key",value:old}}catch{}
  return null;
}
function clearLink(){
  try{sessionStorage.removeItem("shixu-key")}catch{}
  if(location.hash)history.replaceState(null,"",location.pathname+location.search);
}
function deviceHeaders(){const key=deviceKey();return key?{"X-Shixu-Device":key}:{}}

const shapes={
  share:'<path d="M9 15l6-6m-4-2h6v6"/><path d="M9 7H5v12h12v-4"/>',
  settings:'<path d="M3 6h10m4 0h4M3 12h3m4 0h11M3 18h12m4 0h2"/><circle cx="15" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  play:'<path d="m7 4 13 8-13 8z"/>',stop:'<rect x="6" y="6" width="12" height="12" rx="1"/>',
  plus:'<path d="M12 5v14m-7-7h14"/>',left:'<path d="m14.5 5-7 7 7 7"/>',right:'<path d="m9 5 7 7-7 7"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  edit:'<path d="M5 19l4-1 11-11-3-3L6 15z"/>',close:'<path d="m5 5 14 14m0-14L5 19"/>',
  swap:'<path d="M4 8h15l-4-4m5 12H5l4 4"/>'
};
const ico=n=>'<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">'+shapes[n]+'</svg>';
const brand='<div class="brand"><svg viewBox="0 0 42 32" aria-hidden="true"><path d="M1 19h8l5-13 7 22 6-17h13" fill="none" stroke="#c5d9ed" stroke-width="2.4"/></svg>时序</div>';
const color=k=>k==="work"?"blue":"amber";
const mark=k=>'<i class="mark '+color(k)+'"></i>';
const btn=(act,html,cls="linkbtn",label="")=>'<button type="button" class="'+cls+'" data-act="'+act+'"'+(label?' aria-label="'+label+'"':'')+'>'+html+'</button>';
const header=(nav="")=>'<header class="sitebar"><div class="bar">'+brand+'<nav class="nav">'+nav+'</nav></div></header>';
const legend='<div class="legend"><span>'+mark("work")+'工作</span><span>'+mark("study")+'学习</span></div>';
const units=ms=>{const m=Math.floor(Math.max(0,ms)/60000);return m>=60?Math.floor(m/60)+' 小时'+(m%60?' '+m%60+' 分钟':''):m>0?m+' 分钟':ms>0?'不足 1 分钟':'0 分钟'};
const hhmm=ms=>{const m=Math.floor(Math.max(0,ms)/60000);return String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0")};
const ticker=ms=>hhmm(ms)+":"+String(Math.floor(ms/1000)%60).padStart(2,"0");
function tip(message){let el=document.querySelector(".toast");if(!el){el=document.createElement("div");el.className="toast";el.setAttribute("role","status");document.body.append(el)}el.textContent=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.textContent="",3500)}
async function api(path,body){
  const headers=path.startsWith("public?")?{}:deviceHeaders();
  if(body)headers["Content-Type"]="application/json";
  const r=await fetch("/api/"+path,{cache:"no-store",headers,...(body?{method:"POST",body:JSON.stringify(body)}:{})});
  let data;try{data=await r.json()}catch{throw new Error("连接暂时不可用，请重试。")}if(!r.ok)throw Object.assign(new Error(data.error||"请求未完成。"),{status:r.status});return data;
}
async function refresh(render=true){
  const id=++loadId;
  const result=await api((publicView?"public":"state")+"?date="+date);
  if(id!==loadId)return;
  const changed=JSON.stringify(result)!==JSON.stringify(snapshot);
  snapshot=result;if(render && changed)draw();
}
function livePart(now){
  if(publicView || !snapshot.active)return 0;
  const a=snapshot.active, left=midnight(date);return Math.max(0,Math.min(now,left+DAY)-Math.max(left,a.start));
}
function amounts(now){
  const last=snapshot.daily.at(-1),value={work:last.work,study:last.study};
  if(!publicView && snapshot.active)value[snapshot.active.kind]+=livePart(now);
  return value;
}
function num(ms){const m=Math.floor(ms/60000);return (m>=60?Math.floor(m/60)+'<small>小时</small>':'')+m%60+'<small>分</small>'}
function gauge(value){
  const total=value.work+value.study, len=2*Math.PI*113;
  const work=Math.min(1,value.work/DAY)*len,study=Math.min(1-work/len,value.study/DAY)*len;
  let ticks="";
  for(let i=0;i<96;i++){const major=i%4===0; ticks+='<line x1="130" y1="'+(major?9:12)+'" x2="130" y2="'+(major?18:16)+'" transform="rotate('+i*3.75+' 130 130)" stroke="'+(major?'#7e8b9e':'#46515f')+'" stroke-width="'+(major?1.7:1)+'"/>'}
  let hours="";for(const [n,x,y] of [["00",130,40],["06",222,134],["12",130,226],["18",38,134]])hours+='<text x="'+x+'" y="'+y+'" text-anchor="middle" fill="#94a0af" font-size="10" font-family="Arial">'+n+'</text>';
  const circle=(c,l,off)=>l>0?'<circle cx="130" cy="130" r="113" fill="none" stroke="'+c+'" stroke-width="5" stroke-dasharray="'+l+' '+(len-l)+'" stroke-dashoffset="'+(-off)+'" transform="rotate(-90 130 130)"/>':'';
  return '<div class="dial"><svg aria-hidden="true" viewBox="0 0 260 260">'+ticks+'<circle cx="130" cy="130" r="113" fill="none" stroke="#303946" stroke-width="4"/><circle cx="130" cy="130" r="86" fill="none" stroke="#272e38" stroke-dasharray="2 5"/>'+hours+circle("#9bbfe6",work,0)+circle("#e7b879",study,work)+'<path d="m127 3 3 5 3-5z" fill="#d4deea"/></svg><div class="dialtext"><span>累计投入</span><b id="dial-total">'+hhmm(total)+'</b><small>小时 / 分钟</small></div></div>';
}
function metrics(v){
  return ["work","study"].map(k=>{const g=snapshot.goals?.[k]||0;return '<div class="metric"><label>'+mark(k)+names[k]+'</label><div class="num" id="num-'+k+'">'+num(v[k])+'</div>'+(!publicView?'<div class="goal" id="goal-'+k+'">'+goalText(g,v[k])+'</div>'+(g?'<div class="goalline"><i class="'+color(k)+'" style="width:'+Math.min(100,100*v[k]/(g*60000))+'%"></i></div>':''):'')+'</div>'}).join("");
}
function goalText(g,ms){return g?(ms===0?'目标 '+units(g*60000):ms>=g*60000?'已达目标 · '+units(g*60000):'目标 '+units(g*60000)+' · 还差 '+units(Math.ceil((g*60000-ms)/60000)*60000)):'目标未设置'}
function controls(){
  if(publicView)return '';
  if(snapshot.frozen)return '<div class="notice">当前为只读模式</div>';
  if(date!==dayOf())return '<div class="controls">'+btn("manual",ico("plus")+"补记时长","action work")+btn("today","回到今天","ghost")+'</div>';
  const a=snapshot.active;
  return (a?'<div class="active-info">正在'+names[a.kind]+' · 本次 <b id="elapsed">'+ticker(Math.max(0,Date.now()-a.start))+'</b></div>':'')+'<div class="controls">'+["work","study"].map(k=>{
    const stop=a?.kind===k,text=stop?"结束"+names[k]:a?"切到"+names[k]:"开始"+names[k];
    return btn(stop?"stop":k,ico(stop?"stop":a?"swap":"play")+text,'action '+(stop?'stop':k))}).join('')+btn("manual",ico("plus")+"补记","ghost")+'</div>';
}
function timeline(){
  const start=midnight(date);let html="";
  for(const r of snapshot.records.filter(r=>r.mode==="timer")){
    const from=Math.max(start,r.start), to=Math.min(start+DAY,r.end??Date.now());
    if(to>from)html+='<span class="segment '+color(r.kind)+'" title="'+names[r.kind]+' '+clockText(from)+' 至 '+(to===start+DAY?"24:00":clockText(to))+'" style="left:'+(from-start)/DAY*100+'%;width:'+(to-from)/DAY*100+'%"></span>';
  }
  return '<section class="timeline"><div class="panelhead"><h2>时间轴</h2>'+legend+'</div><div class="track">'+html+'</div><div class="ticks"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div></section>';
}
function week(){
  const daily=snapshot.daily, max=Math.max(3600000,...daily.flatMap(d=>[d.work,d.study]));
  return '<section class="section history"><div class="panelhead"><h2>近七天</h2>'+legend+'</div><div class="week">'+daily.map(d=>{
    const label=d.day.slice(5).replace("-","/"),total=d.work+d.study;
    return '<button type="button" data-day="'+d.day+'" class="'+(d.day===date?'selected':'')+'" aria-label="'+d.day+'，工作 '+units(d.work)+'，学习 '+units(d.study)+'"><strong>'+(total?hhmm(total):'—')+'</strong><div class="bars">'+["work","study"].map(k=>'<i class="'+color(k)+'" style="height:'+(d[k]?Math.max(3,100*d[k]/max):0)+'%"></i>').join('')+'</div><span>'+label+'</span></button>'}).join("")+'</div></section>';
}
function recordList(){
  if(publicView) return '<section class="section"><div class="panelhead"><h2>每日汇总</h2></div><ul class="records publiclist">'+snapshot.daily.slice().reverse().map(d=>'<li><span>'+d.day.slice(5).replace("-","/")+'</span>'+(d.work+d.study?'<span class="range">工作 '+units(d.work)+'</span><strong>学习 '+units(d.study)+'</strong>':'<span class="range">未记录</span>')+'</li>').join("")+'</ul></section>';
  const rows=[...snapshot.records].sort((a,b)=>(b.start??0)-(a.start??0));
  return '<section class="section"><div class="panelhead"><h2>当日记录</h2><span class="quietnote">'+rows.length+' 条</span></div>'+(rows.length?'<ul class="records">'+rows.map(r=>{
    const open=r.mode==="timer" && r.end===null;
    const duration=r.mode==="timer"?(r.end??Date.now())-r.start:r.minutes*60000;
    const time=t=>dayOf(t)===date?clockText(t):dayOf(t).slice(5)+' '+clockText(t);
    return '<li>'+mark(r.kind)+'<span>'+names[r.kind]+'</span><span class="range">'+(r.mode==="manual"?"补记":time(r.start)+' – '+(open?'进行中':time(r.end)))+'</span><strong>'+units(duration)+'</strong>'+(!open&&!snapshot.frozen?btn("edit-"+r.id,ico("edit"),"iconbtn","编辑这条"+names[r.kind]+"记录"):'')+'</li>'}).join("")+'</ul>':'<p class="empty">这一天还没有记录。</p>')+'</section>';
}
function draw(){
  const d=new Date(midnight(date));
  const title=new Intl.DateTimeFormat('zh-CN',{timeZone:"Asia/Shanghai",month:"long",day:"numeric"}).format(d);
  const weekday=new Intl.DateTimeFormat('zh-CN',{timeZone:"Asia/Shanghai",weekday:"long"}).format(d);
  const nav=publicView?'<span class="quietnote">公开记录</span>'+(!sharePage?btn("connect","连接我的设备","ghost"):''):btn("share",ico("share")+'<span>分享</span>',"ghost")+btn("settings",ico("settings")+'<span class="navword">设置</span>',"ghost","设置");
  const dateControl='<div class="date-controls">'+btn("prev",ico("left"),"iconbtn","上一天")+'<label class="calendar">'+ico("calendar")+'<input aria-label="查看日期" type="date" id="date" value="'+date+'" max="'+dayOf()+'"></label><button type="button" data-act="next" aria-label="下一天" '+(date===dayOf()?'disabled':'')+'>'+ico("right")+'</button></div>';
  const v=amounts(Date.now());app.innerHTML=header(nav)+'<main class="content '+(publicView?'public':'')+'"><div class="dateline"><div class="dategroup"><h1 class="daytitle">'+title+'</h1><span class="weekday">'+weekday+'</span></div>'+dateControl+'</div><div class="hero"><div class="summary"><div class="metrics">'+metrics(v)+'</div>'+controls()+'</div>'+gauge(v)+'</div>'+(publicView?'':timeline())+'<div class="lower">'+week()+recordList()+'</div></main>';app.setAttribute("aria-busy","false");
  const input=document.querySelector("#date");input.onchange=()=>input.value && choose(input.value);
  input.onclick=()=>{try{input.showPicker?.()}catch{}};
}
function tick(){
  const today=dayOf();if(today!==clockDay){clockDay=today;if(pinToday){choose(today);return}}
  if(!snapshot || !snapshot.active || publicView)return;
  const now=Date.now(),v=amounts(now);for(const k of ["work","study"]){const n=document.getElementById("num-"+k);if(n)n.innerHTML=num(v[k]);const g=document.getElementById("goal-"+k);if(g)g.textContent=goalText(snapshot.goals[k],v[k]);}
  const t=document.getElementById("elapsed");if(t)t.textContent=ticker(Math.max(0,now-snapshot.active.start));const total=document.getElementById("dial-total");if(total)total.textContent=hhmm(v.work+v.study);
}
async function choose(day){const old=date;date=day;pinToday=day===dayOf();try{await refresh();history.replaceState(null,"",location.pathname+(pinToday?"":"?day="+day));}catch(e){if(date===day){date=old;tip(e.message)}}}
function showDialog(title,body){
  dialog?.close();dialog=document.createElement("dialog");dialog.innerHTML='<div class="dialoghead"><h2>'+title+'</h2>'+btn("close",ico("close"),"iconbtn","关闭")+'</div>'+body+'<p class="error" role="alert"></p>';
  document.body.append(dialog);dialog.addEventListener("close",e=>{e.target.remove();if(dialog===e.target)dialog=null},{once:true});dialog.showModal();
}
async function change(action,fields,success){
  if(busy)return;busy=true;
  const target=dialog, msg=target?.querySelector(".error");if(msg)msg.textContent="";
  const payload={action,...fields,token:crypto.randomUUID(),revision:snapshot.revision};
  try{
    try{await api("change",payload)}catch(e){if(e.status)throw e;await api("change",payload)}
    target?.close();await refresh();tip(success);
  }catch(e){if(e.status===409)await refresh().catch(()=>{});if(msg)msg.textContent=e.message;else tip(e.message)}
  finally{busy=false}
}
function formDialog(r){
  const timed=r?.mode==="timer", iso=t=>dayOf(t)+'T'+clockText(t)+':'+new Date(t).toISOString().slice(17,23);
  const fields=timed?'<label for="from">开始时间</label><input id="from" type="datetime-local" step="0.001" required value="'+iso(r.start)+'"><label for="to">结束时间</label><input id="to" type="datetime-local" step="0.001" required value="'+iso(r.end)+'">':'<label for="entryday">日期</label><input id="entryday" type="date" required max="'+dayOf()+'" value="'+(r?.day||date)+'"><label for="minutes">时长（分钟）</label><input id="minutes" type="number" inputmode="numeric" min="1" max="1440" required value="'+(r?.minutes||30)+'"><div class="pills">'+[15,30,60].map(n=>btn("preset-"+n,n+" 分钟","")).join("")+'</div>';
  showDialog(r?"编辑记录":"补记时长",'<form id="entry"><label for="kind">类别</label><select id="kind"><option value="work">工作</option><option value="study">学习</option></select>'+fields+'<div class="dialogactions">'+(r?btn("delete-"+r.id,"删除记录","linkbtn destruct"):'')+'<button class="solid">保存记录</button></div></form>');
  const form=document.querySelector("#entry");form.querySelector("#kind").value=r?.kind||"work";
  form.onsubmit=e=>{e.preventDefault();const kind=form.querySelector("#kind").value;const f=timed?{start:Date.parse(form.querySelector("#from").value+"+08:00"),end:Date.parse(form.querySelector("#to").value+"+08:00")}:{day:form.querySelector("#entryday").value,minutes:Number(form.querySelector("#minutes").value)};change(r?"edit":"manual",{...f,kind,id:r?.id},r?"记录已更新":"已记入"+names[kind]+" "+f.minutes+" 分钟")};
}
function settings(){
  showDialog("设置",'<form id="goals"><h3>每日目标</h3><div class="twocol">'+["work","study"].map(k=>'<div><label for="g-'+k+'">'+names[k]+'（分钟）</label><input id="g-'+k+'" type="number" min="0" max="1440" value="'+snapshot.goals[k]+'" required></div>').join('')+'</div><p class="quietnote">填 0 可关闭该项目标。</p><div class="dialogactions"><button class="solid">保存目标</button></div></form>'+(access?.mode==="sites"?btn("pair","连接另一台设备"):'')+'<details><summary>备份与迁移</summary>'+btn("download-backup","下载完整备份")+btn("import","从备份恢复")+btn("freeze",snapshot.frozen?"恢复记录":"设为只读")+'<input id="backupfile" type="file" accept=".json,application/json" hidden></details>');
  document.querySelector("#goals").onsubmit=e=>{e.preventDefault();change("goals",{goals:{work:Number(document.querySelector("#g-work").value),study:Number(document.querySelector("#g-study").value)}},"目标已保存")};
  document.querySelector("#backupfile").onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const backup=JSON.parse(await f.text());await change("restore",{backup},"备份已恢复")}catch{dialog.querySelector(".error").textContent="无法读取这个备份文件。"}};
}
function share(){
  const url=location.origin+"/share";showDialog("分享每日时长",'<label for="shareurl">公开链接</label><input id="shareurl" readonly><p class="quietnote">访客可查看每天的工作与学习时长。</p><div class="dialogactions"><a class="linkbtn" href="/share" target="_blank" rel="noopener">预览</a>'+btn("copy","复制链接","solid")+'</div>');document.getElementById("shareurl").value=url;
}
document.addEventListener("click",async e=>{const b=e.target.closest("button");if(!b||b.disabled)return;
  if(b.dataset.day){choose(b.dataset.day);return}
  const a=b.dataset.act;if(!a)return;
  if(a==="close")dialog?.close();
  else if(a==="retry")boot();
  else if(a==="prev"||a==="next")choose(dayOf(midnight(date)+(a==="prev"?-DAY:DAY)));
  else if(a==="today")choose(dayOf());
  else if(a==="settings")settings();else if(a==="share")share();
  else if(a==="connect"){connectDialog()}
  else if(a==="pair"){await newPairLink(b)}
  else if(a==="download-backup"){
    try{const backup=await api("backup");const blob=new Blob([JSON.stringify(backup)],{type:"application/json"}),url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="shixu-"+dayOf()+".json";link.click();setTimeout(()=>URL.revokeObjectURL(url),10000)}catch(err){dialog.querySelector(".error").textContent=err.message}
  }
  else if(a==="copy"){const input=document.getElementById("shareurl");try{await navigator.clipboard.writeText(input.value);tip("链接已复制")}catch{input.select();tip("请复制已选中的链接")}}
  else if(a==="manual")formDialog();
  else if(a.startsWith("preset-"))document.querySelector("#minutes").value=a.slice(7);
  else if(a.startsWith("edit-"))formDialog(snapshot.records.find(r=>r.id===a.slice(5)));
  else if(a.startsWith("delete-")){const id=a.slice(7);showDialog("删除这条记录？",'<p>当天的时长将随之更新。</p><div class="dialogactions">'+btn("close","取消")+btn("confirm-delete-"+id,"删除","solid")+'</div>');}
  else if(a.startsWith("confirm-delete-"))change("remove",{id:a.slice(15)},"记录已删除");
  else if(a==="import")document.getElementById("backupfile").click();
  else if(a==="freeze")change("freeze",{frozen:!snapshot.frozen},snapshot.frozen?"已恢复记录":"已设为只读");
  else if(a==="stop")change("stop",{},"已记入"+names[snapshot.active.kind]+" "+units(Date.now()-snapshot.active.start));
  else if(a==="work"||a==="study")change("start",{kind:a},"已开始"+names[a]);
});
function localLogin(){
  app.innerHTML=header('<a href="/share">查看公开记录</a>')+'<main class="auth"><h1>我的时序</h1><form id="login"><label for="password">站主密码</label><input id="password" type="password" autocomplete="current-password" required><button class="solid">登录</button></form><p class="error" role="alert"></p></main>';
  document.getElementById("login").onsubmit=async e=>{e.preventDefault();try{await api("login",{password:document.getElementById("password").value});await boot()}catch(err){document.querySelector(".auth .error").textContent=err.message}};
}
function connectDialog(){
  showDialog("连接我的设备",'<form id="connect-form"><label for="connect-url">个人记录链接</label><input id="connect-url" type="url" required autocomplete="off" placeholder="粘贴链接"><p class="quietnote">可在已连接设备的「设置」里获取。</p><div class="dialogactions"><button class="solid">连接</button></div></form>');
  document.querySelector("#connect-form").onsubmit=async e=>{
    e.preventDefault();
    const error=dialog.querySelector(".error");
    try{
      const link=new URL(document.getElementById("connect-url").value.trim());
      const fragment=new URLSearchParams(link.hash.slice(1));
      if(link.origin!==location.origin || !["key","pair"].some(type=>fragment.get(type)))throw new Error("请粘贴完整的个人记录或设备连接链接。");
      history.replaceState(null,"",location.pathname+location.search+link.hash);dialog.close();await boot();
    }catch(err){error.textContent=err.message}
  };
}
async function newPairLink(button){
  button.disabled=true;
  try{
    const result=await api("pair",{});
    showDialog("连接另一台设备",'<label for="shareurl">一次性记录链接</label><input id="shareurl" readonly><p class="quietnote">在你自己的手机或电脑上打开。链接 24 小时内有效，可连接一台设备。</p><div class="dialogactions">'+btn("copy","复制设备链接","solid")+'</div>');
    document.getElementById("shareurl").value=location.origin+"/#pair="+result.code;
  }catch(err){if(dialog)dialog.querySelector(".error").textContent=err.message;button.disabled=false}
}
async function boot(){try{
  publicView=sharePage;
  let linkError;
  if(!sharePage){
    access=await api("access");
    const link=pendingLink();
    if(link){
      try{
        if(!access.owner || access.mode==="sites" && !deviceKey()){
          if(access.mode==="self"){await api("login",{password:link.value})}
          else{rememberDevice();await api("claim",{[link.type]:link.value})}
          access=await api("access");
          if(!access.owner)throw new Error("设备连接尚未完成，请重新打开个人链接。");
        }
        clearLink();
      }catch(err){if(err.status!==403)throw err;clearLink();linkError=err.message}
    }
    if(!access.owner && access.mode==="self"){localLogin();return}
    publicView=!access.owner;
  }
  await refresh(false);draw();if(linkError){connectDialog();dialog.querySelector('.error').textContent=linkError}
}catch(e){app.innerHTML=header()+'<main class="auth"><h1>暂时无法打开记录</h1><p id="boot-error"></p>'+btn("retry","重试","solid")+'</main>';document.getElementById("boot-error").textContent=e.message}}
setInterval(tick,1000);function sync(){if(!document.hidden&&!busy&&!dialog&&snapshot)refresh().catch(()=>{})}
setInterval(sync,20000);window.addEventListener("focus",sync);document.addEventListener("visibilitychange",sync);boot();