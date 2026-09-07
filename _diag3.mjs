const H={'Content-Type':'application/json','x-service-token':'dev-shared-service-token'};
const mk=(n)=>({required:[{name:'Java',weight:1,mustHave:true},{name:'Distributed Messaging',weight:.8,mustHave:false}],offered:[{name:'Java',proficiency:5,years:9},{name:`Kafka${n}`,proficiency:4,years:5}]});
// one call, warm
let t=Date.now();
await fetch('http://localhost:8000/match/skills',{method:'POST',headers:H,body:JSON.stringify(mk(''))});
console.log(`single call: ${((Date.now()-t)/1000).toFixed(1)}s`);
// five distinct calls in parallel
t=Date.now();
await Promise.all([1,2,3,4,5].map(n=>fetch('http://localhost:8000/match/skills',{method:'POST',headers:H,body:JSON.stringify(mk(n))})));
console.log(`five in parallel: ${((Date.now()-t)/1000).toFixed(1)}s`);
