import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {makeExam,gradeExam,validateBackup,recordAnswer,currentRecord,mergeBackup} from '../src/core.js';
const bank=JSON.parse(fs.readFileSync(new URL('../data/questions.json',import.meta.url)));
const audit=JSON.parse(fs.readFileSync(new URL('../data/quality.json',import.meta.url)));
const round=JSON.parse(fs.readFileSync(new URL('../data/rounds.json',import.meta.url))).rounds[0];
const core=bank.filter(q=>round.coreIds.includes(q.id)).map(q=>({...q,quality:audit.questions.find(a=>a.id===q.id)}));
const fresh=()=>({schemaVersion:1,revision:0,records:{},sessions:[],activeExam:null,settings:{}});
test('500核心与100重写全量一致，暂停题不进入核心',()=>{
 assert.equal(new Set(round.coreIds).size,500);assert.equal(new Set(round.revisedIds).size,100);
 assert.equal(core.length,500);assert(core.every(q=>q.quality.examUse==='eligible'));
 const newMulti=core.filter(q=>round.revisedIds.includes(q.id)&&q.type==='multiple');assert.equal(newMulti.length,40);
 assert(newMulti.every(q=>Object.keys(q.options).length===5));assert.equal(newMulti.filter(q=>q.answer.length===4).length,20);
});
test('短卷10+5、25分钟、100分且按开考题目快照计分',()=>{
 const exam=makeExam(core,1000,Math.random,'short');assert.equal(exam.ids.length,15);assert.equal(exam.deadline,1501000);
 assert.equal(exam.snapshot.filter(q=>q.type==='single').length,10);
 for(const q of exam.snapshot)exam.answers[q.id]=q.answer;
 assert.equal(gradeExam(exam,new Map()).points,100);
 const m=exam.snapshot.find(q=>q.type==='multiple');exam.answers[m.id]=m.answer.slice(1);
 assert.equal(gradeExam(exam,new Map()).points,92);
 delete exam.answers[exam.snapshot[0].id];assert.equal(gradeExam(exam,new Map()).points,86);
});
test('E选项与四答案可记录、导出、导入，越界答案拒绝',()=>{
 const q=core.find(q=>q.answer.includes('E')&&q.answer.length===4);assert(q);
 const s=fresh();recordAnswer(s,q,q.answer,1000);assert(currentRecord(s,q).lastCorrect);
 s.activeExam=makeExam(core,1000,Math.random,'short');s.activeExam.snapshot[10]=q;s.activeExam.ids[10]=q.id;
 // Ensure the fixture does not collide with another random selection.
 const selected=[...core.filter(x=>x.type==='single').slice(0,10),q,...core.filter(x=>x.type==='multiple'&&x.id!==q.id).slice(0,4)];
 s.activeExam.snapshot=structuredClone(selected);s.activeExam.ids=selected.map(x=>x.id);s.activeExam.answers[q.id]=q.answer;
 const restored=mergeBackup(fresh(),JSON.parse(JSON.stringify(s)));assert(restored.activeExam.answers[q.id].includes('E'));
 const bad=structuredClone(s);bad.activeExam.snapshot[0].answer=['E'];assert.throws(()=>validateBackup(bad),/快照无效/);
});
test('短卷刷新后的快照和模式保留，损坏题数与模式拒绝',()=>{
 const s=fresh();s.activeExam=makeExam(core,1000,Math.random,'short');assert.equal(validateBackup(JSON.parse(JSON.stringify(s))).activeExam.mode,'short');
 const bad=structuredClone(s);bad.activeExam.ids.pop();assert.throws(()=>validateBackup(bad));
 bad.activeExam.mode='bogus';assert.throws(()=>validateBackup(bad));
});
test('修订历史按内容版本隔离，同时间不同版本不错误去重',()=>{
 const q=core.find(q=>round.revisedIds.includes(q.id));const a=fresh(),b=fresh();
 recordAnswer(a,{...q,review:{contentHash:'old'}},q.answer,1000);a.records[q.id].favorite=true;
 assert.equal(currentRecord(a,q).attempts.length,0);recordAnswer(b,q,q.answer,1000);
 const merged=mergeBackup(a,b);assert.equal(merged.records[q.id].attempts.length,2);assert.equal(currentRecord(merged,q).attempts.length,1);assert(merged.records[q.id].favorite);
});

test('公开训练数据排除个人记录和官方原题，保留15道原创专项映射',()=>{
 const privateFields=['score','answered','unanswered','elapsedSeconds','officialAnswerKeyVisible','recordingDurationSeconds','recordingFile','observedFormat','observations','nextRounds','officialAnswerKeyComplete','officialAnswerKeyCoverage','confirmedMistakes'];
 for(const field of privateFields)assert(!Object.hasOwn(round,field),`公开训练数据不应包含 ${field}`);
 assert.equal(round.focusedPracticeIds.length,15);assert.equal(new Set(round.focusedPracticeIds).size,15);
 const byId=new Map(bank.map(q=>[q.id,q]));
 for(const id of round.focusedPracticeIds){
  assert(round.coreIds.includes(id));
  const question=byId.get(id);assert(question,`原创题不存在：${id}`);
  assert(question.stem&&question.explanation&&question.sources.length);
 }
});
