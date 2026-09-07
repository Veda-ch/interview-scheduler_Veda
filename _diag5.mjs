const H={'Content-Type':'application/json','x-service-token':'dev-shared-service-token'};
// Ananya vs the backend role, five times with a cache-busting extra skill so
// each call really hits the model.
const base={required:[{name:'Java',weight:1,mustHave:true},{name:'Spring Boot',weight:.9,mustHave:true},{name:'Distributed Messaging',weight:.8,mustHave:false},{name:'Relational Databases',weight:.7,mustHave:false}]};
const off=[{name:'Java',proficiency:5,years:9},{name:'Spring Boot',proficiency:5,years:7},{name:'Kafka',proficiency:4,years:5},{name:'PostgreSQL',proficiency:4,years:6},{name:'Microservices',proficiency:5,years:6},{name:'REST APIs',proficiency:5,years:8}];
for (const i of [1,2,3,4]) {
  const body={...base, offered: off};
  const r=await fetch('http://localhost:8000/match/skills',{method:'POST',headers:H,body:JSON.stringify(body)});
  const j=await r.json();
  console.log(`run ${i}: overall=${j.overall} cached=${j.cached} | ` + (j.per_skill||[]).map(p=>`${p.skill}<-${p.matched_with||'-'}=${p.score}`).join('  '));
}
