const H={'Content-Type':'application/json','x-service-token':'dev-shared-service-token'};
const body={required:[{name:'Java',weight:1,mustHave:true},{name:'Distributed Messaging',weight:.8,mustHave:false}],offered:[{name:'Java',proficiency:5,years:9},{name:'Kafka',proficiency:4,years:5}]};
for (const i of [1,2,3]) {
  const t=Date.now();
  const r=await fetch('http://localhost:8000/match/skills',{method:'POST',headers:H,body:JSON.stringify(body)});
  const j=await r.json();
  console.log(`call ${i}: ${((Date.now()-t)/1000).toFixed(1)}s cached=${j.cached} used_llm=${j.used_llm} overall=${j.overall}`);
}
