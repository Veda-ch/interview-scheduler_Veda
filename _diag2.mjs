import { DateTime } from 'luxon';
const BASE='http://localhost:4000/api';
async function call(m,p,{token,body}={}){const r=await fetch(BASE+p,{method:m,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}),...(m!=='GET'?{'Idempotency-Key':`${Date.now()}-${Math.random()}`}:{})},...(body?{body:JSON.stringify(body)}:{})});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}return{status:r.status,json:j,text:t};}
async function login(e){const r=await call('POST','/auth/login',{body:{email:e,password:'Password123'}});return r.json.accessToken;}
const kavya=await login('recruiter@scheduler.dev');
const aisha=await login('aisha.khan@example.dev');
const arr=(await call('GET','/interview-requests?limit=50',{token:kavya})).json;
const rq=arr.find(r=>(r.candidate?.name||r.application?.candidate?.user?.name)==='Aisha Khan');
console.log('request',rq.id,rq.status);
let d=DateTime.now().setZone('Europe/London').startOf('day').plus({days:1});
while(d.weekday>5) d=d.plus({days:1});
const slots=[{startUtc:d.set({hour:9}).toUTC().toISO(),endUtc:d.set({hour:12}).toUTC().toISO()}];
console.log('slots',JSON.stringify(slots));
const t=Date.now();
const r=await call('POST',`/interview-requests/${rq.id}/candidate-slots`,{token:aisha,body:{slots}});
console.log(`STATUS ${r.status} in ${((Date.now()-t)/1000).toFixed(1)}s`);
console.log('BODY',r.text.slice(0,500));
