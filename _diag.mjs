const body={required:[{name:'Java',weight:1.0,mustHave:true},{name:'Spring Boot',weight:0.9,mustHave:true},{name:'Distributed Messaging',weight:0.8,mustHave:false},{name:'Relational Databases',weight:0.7,mustHave:false}],offered:[{name:'Java',proficiency:5,years:9},{name:'Spring Boot',proficiency:5,years:7},{name:'Kafka',proficiency:4,years:5},{name:'PostgreSQL',proficiency:4,years:6},{name:'Microservices',proficiency:5,years:6},{name:'REST APIs',proficiency:5,years:8}]};
for (const i of [1,2]) {
  const t=Date.now();
  const r=await fetch('http://localhost:8000/match/skills',{method:'POST',headers:{'Content-Type':'application/json','x-service-token':'dev-shared-service-token'},body:JSON.stringify(body)});
  const j=await r.json();
  console.log(`call ${i}: ${((Date.now()-t)/1000).toFixed(1)}s overall=${j.overall} used_llm=${j.used_llm} provider=${j.provider} fallback=${j.fallback_used} warning=${j.warning}`);
  console.log('  per-skill:', (j.per_skill||[]).map(p=>`${p.required||p.skill}<-${p.covered_by||p.matched_with||'-'}=${p.coverage??p.score}`).join('  '));
}
