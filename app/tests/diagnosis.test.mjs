import test from 'node:test';
import assert from 'node:assert/strict';
import {recordAnswer,applySelfEval,setMastery,needsConsolidation,luckyCorrect,obstacleStats,masteryStats,wasStruggling,recovered,mergeBackup,validateBackup,CONFIDENCE_LEVELS,OBSTACLE_TYPES,MASTERY_LEVELS} from '../src/core.js';
const q={id:'FDE-M1-001',type:'single',module:'M1',answer:['B'],quality:{examUse:'eligible'}};
const qv={id:'FDE-M1-002',type:'single',module:'M1',answer:['A'],quality:{examUse:'eligible'},review:{contentHash:'hash-v2'}};
const fresh=()=>({schemaVersion:1,revision:0,records:{},sessions:[],activeExam:null,settings:{}});
const V='2026-10-09';

test('诊断常量与 FR-013 定义一致',()=>{
  assert.equal(CONFIDENCE_LEVELS.length,3);
  assert.equal(OBSTACLE_TYPES.length,6);
  assert.deepEqual(MASTERY_LEVELS.map(x=>x[0]),['understood','partial','lost']);
});

test('needsConsolidation：未作答不入队，旧记录安全',()=>{
  assert.equal(needsConsolidation({attempts:[]},V),false);
  assert.equal(needsConsolidation({},V),false);
  assert.equal(needsConsolidation(undefined,V),false);
});

test('条件1-3：答错 / 靠排除 / 靠猜 / 有障碍 → 入队',()=>{
  const s=fresh(); recordAnswer(s,q,['A'],1000);                       // 答错
  assert.equal(needsConsolidation(s.records[q.id],V),true);
  const s2=fresh(); recordAnswer(s2,q,['B'],1000); applySelfEval(s2,q,1000,{confidence:'guess'},1001);
  assert.equal(needsConsolidation(s2.records[q.id],V),true);
  const s3=fresh(); recordAnswer(s3,q,['B'],1000); applySelfEval(s3,q,1000,{confidence:'eliminate',obstacles:['term']},1001);
  assert.equal(needsConsolidation(s3.records[q.id],V),true);
});

test('条件5：答对+确定理解但未标记掌握 → 仍入队（刷完≠理解）',()=>{
  const s=fresh(); recordAnswer(s,q,['B'],1000); applySelfEval(s,q,1000,{confidence:'sure',obstacles:[]},1001);
  assert.equal(needsConsolidation(s.records[q.id],V),true);
});

test('解除：最新作答后标记已理解（当前版本）→ 出队；同毫秒也算之后',()=>{
  const s=fresh(); recordAnswer(s,q,['A'],1000); setMastery(s,q,'understood',1000);
  assert.equal(needsConsolidation(s.records[q.id],V),false);
  const s2=fresh(); recordAnswer(s2,q,['A'],1000); setMastery(s2,q,'understood',999);
  assert.equal(needsConsolidation(s2.records[q.id],V),true);
});

test('版本更新：旧版“已理解”失效，新版重新确认后解除',()=>{
  const s=fresh(); recordAnswer(s,qv,['A'],1000); setMastery(s,qv,'understood',1001);
  assert.equal(needsConsolidation(s.records[qv.id],'hash-v2'),false);
  assert.equal(needsConsolidation(s.records[qv.id],'hash-v3'),true);
});

test('重新作答后需再次确认才解除',()=>{
  const s=fresh(); recordAnswer(s,q,['A'],1000); setMastery(s,q,'understood',1001);
  recordAnswer(s,q,['A'],2000);
  assert.equal(needsConsolidation(s.records[q.id],V),true);
  setMastery(s,q,'understood',2000);
  assert.equal(needsConsolidation(s.records[q.id],V),false);
});

test('partial / lost 直接入队',()=>{
  const s=fresh(); recordAnswer(s,q,['B'],1000);
  setMastery(s,q,'partial',1001); assert.equal(needsConsolidation(s.records[q.id],V),true);
  setMastery(s,q,'lost',1002);    assert.equal(needsConsolidation(s.records[q.id],V),true);
});

test('luckyCorrect：蒙对识别（答对+靠猜）',()=>{
  const s=fresh(); recordAnswer(s,q,['B'],1000);
  assert.equal(luckyCorrect(s.records[q.id]),false);
  applySelfEval(s,q,1000,{confidence:'guess'},1001);
  assert.equal(luckyCorrect(s.records[q.id]),true);
  const s2=fresh(); recordAnswer(s2,q,['A'],1000); applySelfEval(s2,q,1000,{confidence:'guess'},1001);
  assert.equal(luckyCorrect(s2.records[q.id]),false);
  assert.equal(luckyCorrect({attempts:[]}),false);
});

test('applySelfEval：定位成功/失败与字段写入',()=>{
  const s=fresh();
  assert.equal(applySelfEval(s,q,1000,{}),false);
  recordAnswer(s,q,['B'],5000);
  assert.equal(applySelfEval(s,q,9999,{confidence:'sure'}),false);
  assert.equal(applySelfEval(s,q,5000,{confidence:'sure',obstacles:['term','confused']},6000),true);
  const a=s.records[q.id].attempts[0];
  assert.equal(a.confidence,'sure');
  assert.deepEqual(a.obstacles,['term','confused']);
  assert.equal(a.selfEvalAt,6000);
});

test('obstacleStats / masteryStats 统计口径',()=>{
  const records={
    a:{attempts:[{at:1,correct:true,obstacles:['knowledge_gap','term']}]},
    b:{attempts:[{at:2,correct:false,obstacles:['knowledge_gap']}]},
    c:{attempts:[{at:3,correct:true}]},
    d:{attempts:[],mastery:'understood'}
  };
  assert.deepEqual(obstacleStats(records),{marked:2,counts:{knowledge_gap:2,term:1}});
  assert.deepEqual(masteryStats(records),{understood:0,partial:0,lost:0,unmarked:3});
});

test('挽回指标：曾障碍 → 现已确认理解',()=>{
  const s=fresh(); recordAnswer(s,q,['A'],1000);
  assert.equal(wasStruggling(s.records[q.id]),true);
  assert.equal(recovered(s.records[q.id],V),false);
  setMastery(s,q,'understood',1001);
  assert.equal(recovered(s.records[q.id],V),true);
  const s2=fresh(); recordAnswer(s2,q,['B'],1000);
  assert.equal(wasStruggling(s2.records[q.id]),false);
});

test('合并：A 端补标签 ↔ B 端无标签，双向不丢（评审 #1 场景）',()=>{
  const a=fresh(),b=fresh();
  recordAnswer(a,q,['A'],1000); recordAnswer(b,q,['A'],1000);
  applySelfEval(a,q,1000,{confidence:'guess',obstacles:['term']},1500);
  const m1=mergeBackup(structuredClone(b),structuredClone(a)); // current=B（无标签） incoming=A（有标签）
  assert.equal(m1.records[q.id].attempts[0].confidence,'guess');
  assert.deepEqual(m1.records[q.id].attempts[0].obstacles,['term']);
  const m2=mergeBackup(structuredClone(a),structuredClone(b)); // current=A incoming=B
  assert.equal(m2.records[q.id].attempts[0].confidence,'guess');
});

test('合并：双方都补标，selfEvalAt 新者胜',()=>{
  const a=fresh(),b=fresh();
  recordAnswer(a,q,['A'],1000); recordAnswer(b,q,['A'],1000);
  applySelfEval(a,q,1000,{confidence:'guess'},1000);
  applySelfEval(b,q,1000,{confidence:'sure'},2000);
  const m=mergeBackup(a,b);
  assert.equal(m.records[q.id].attempts.length,1);
  assert.equal(m.records[q.id].attempts[0].confidence,'sure');
});

test('合并：掌握状态 masteryAt 新者胜（双向一致）',()=>{
  const a=fresh(),b=fresh();
  recordAnswer(a,q,['A'],1000); recordAnswer(b,q,['A'],1000);
  setMastery(a,q,'understood',1100); setMastery(b,q,'partial',1200);
  assert.equal(mergeBackup(a,b).records[q.id].mastery,'partial');
  assert.equal(mergeBackup(b,a).records[q.id].mastery,'partial');
});

test('备份校验：新字段合法通过，非法值拒绝',()=>{
  const s=fresh(); recordAnswer(s,q,['B'],1000);
  applySelfEval(s,q,1000,{confidence:'guess',obstacles:['term']},1001);
  setMastery(s,q,'partial',1002);
  validateBackup(s);
  const bad=structuredClone(s); bad.records[q.id].attempts[0].confidence='maybe';
  assert.throws(()=>validateBackup(bad),/把握程度/);
  const bad2=structuredClone(s); bad2.records[q.id].attempts[0].obstacles=['hack'];
  assert.throws(()=>validateBackup(bad2),/障碍/);
  const bad3=structuredClone(s); bad3.records[q.id].mastery='zen';
  assert.throws(()=>validateBackup(bad3),/掌握状态/);
});

test('旧记录（无任何新字段）在全部诊断函数下安全',()=>{
  const old={attempts:[{at:1,answers:['B'],correct:true}],streak:1};
  assert.equal(needsConsolidation(old,V),true);   // 条件5：未确认掌握
  assert.equal(luckyCorrect(old),false);
  assert.equal(wasStruggling(old),false);
  assert.deepEqual(obstacleStats({x:old}),{marked:0,counts:{}});
  assert.deepEqual(masteryStats({x:old}),{understood:0,partial:0,lost:0,unmarked:1});
});
