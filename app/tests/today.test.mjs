import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToday} from '../src/today.js';
import {recordAnswer,todayPlan} from '../src/core.js';

// 最小 DOM 桩：只验证 renderToday 模板可执行、绑定不抛错、内容齐全
function stubElement(){
  return {
    innerHTML:'',
    onclick:null,
    querySelector(){return stubElement();},
    querySelectorAll(){return [];},
  };
}
const q=(id,module,use)=>({id,type:'single',module,answer:['B'],quality:{examUse:use},stem:'题干'});
const questions=[q('FDE-M1-001','M1','eligible'),q('FDE-M2-001','M2','eligible'),q('FDE-M3-001','M3','learning_only')];
const state=()=>({schemaVersion:1,revision:0,records:{},sessions:[{id:'exam-1',points:73,finishedAt:1,mode:'full'}],activeExam:null,settings:{targetDate:'2026-11-23'}});

test('今日任务页渲染：倒计时、任务、薄弱模块、最近成绩齐全且可交互',()=>{
  const s=state();
  recordAnswer(s,questions[1],['A'],Date.now()-1000); // M2 错一次 → 薄弱
  recordAnswer(s,questions[1],['B'],Date.now()-500);
  const target=stubElement();
  const calls=[];
  renderToday(target,{
    questions,state:()=>s,manifest:{version:'2026.10.13.3'},
    MODULES:[['M1','AI 基础',10],['M2','ADP 定位',7],['M3','核心功能',22]],
    actions:{startNew:(ids)=>calls.push(['new',ids]),startReview:()=>calls.push(['review']),startModule:(m)=>calls.push(['module',m]),startExam:()=>calls.push(['exam']),openLastExam:()=>calls.push(['last'])},
    save:()=>calls.push(['save']),render:()=>calls.push(['render']),
  });
  for(const part of ['距考试还有','今日新题目标','到期复习题','核心题库完成率','近期薄弱模块','最近模拟：73 分','每日新题目标','不会被自动标记为完成','value="50"'])assert(target.innerHTML.includes(part),`缺少内容：${part}`);
  assert(!target.innerHTML.includes('undefined'),'页面出现 undefined');
  assert(!target.innerHTML.includes('NaN'),'页面出现 NaN');
});

test('todayPlan：当日首做计数进 doneToday，freshIds 只装剩余额度（修复：刷新后不再看似从头开始）',()=>{
  const s=state();
  const now=Date.now();
  recordAnswer(s,questions[0],['B'],now-60000); // 今天首做 M1 → doneToday=1
  recordAnswer(s,questions[1],['A'],now-30000);  // 今天首做 M2 → doneToday=2
  const plan=todayPlan(questions,s,{now,dailyNew:2});
  assert.equal(plan.doneToday,2);
  assert.equal(plan.freshIds.length,0,'已达每日目标，剩余额度应为 0');
  const plan2=todayPlan(questions,s,{now,dailyNew:3});
  assert.equal(plan2.doneToday,2);
  assert.equal(plan2.freshIds.length,1,'quota 3 - 今日已做 2 → 剩 1 道');
  assert.deepEqual(plan2.freshIds,['FDE-M3-001']);
  // 昨日作答不计入 doneToday
  const yesterday=new Date(now-86400000);yesterday.setHours(12,0,0,0);
  const s2=state();recordAnswer(s2,questions[0],['B'],yesterday.getTime());
  assert.equal(todayPlan(questions,s2,{now,dailyNew:2}).doneToday,0);
});

test('今日页展示当日进度与"继续今日练习"按钮（修复 bug-没有保存之前的记录）',()=>{
  const s=state();
  recordAnswer(s,questions[0],['B'],Date.now()-60000);
  const target=stubElement();
  renderToday(target,{
    questions,state:()=>s,manifest:{version:'x'},
    MODULES:[['M1','AI 基础',10],['M2','ADP 定位',7],['M3','核心功能',22]],
    actions:{startNew:()=>{},startReview:()=>{},startModule:()=>{},startExam:()=>{},openLastExam:()=>{},resumeToday:()=>{}},
    save:()=>{},render:()=>{},
  });
  assert(target.innerHTML.includes('1<small> / 50 道'),'应显示今日已完成 1/50');
  assert(target.innerHTML.includes('还剩'),'应显示剩余额度');
  assert(!target.innerHTML.includes('继续今日练习'),'无会话时不渲染继续按钮');
  const target2=stubElement();
  renderToday(target2,{
    questions,state:()=>s,manifest:{version:'x'},
    MODULES:[['M1','AI 基础',10],['M2','ADP 定位',7],['M3','核心功能',22]],
    actions:{startNew:()=>{},startReview:()=>{},startModule:()=>{},startExam:()=>{},openLastExam:()=>{},resumeToday:()=>{}},
    save:()=>{},render:()=>{},resume:{index:2,total:10},
  });
  assert(target2.innerHTML.includes('继续今日练习（第 3/10 题）'),'应渲染继续按钮');
});

test('理解诊断卡（FR-013 Stage D）：队列计数、障碍分布与巩固入口齐全',()=>{
  const s=state();
  recordAnswer(s,questions[1],['A'],Date.now()-1000); // 答错 → 入队
  const elements={};
  const target={...stubElement(),querySelector(sel){return elements[sel]??=stubElement();}};
  const calls=[];
  renderToday(target,{
    questions,state:()=>s,manifest:{version:'2026.10.13.3'},
    MODULES:[['M1','AI 基础',10],['M2','ADP 定位',7],['M3','核心功能',22]],
    actions:{startNew:()=>{},startReview:()=>{},startModule:()=>{},startExam:()=>{},openLastExam:()=>{},startConsolidation:()=>calls.push(['consolidation'])},
    save:()=>{},render:()=>{},
    diagnosis:{queueCount:3,obstacle:{marked:2,counts:{knowledge_gap:2,term:1}},mastery:{understood:1,partial:2,lost:0,unmarked:5},lucky:1,recovered:1,struggling:3},
  });
  for(const part of ['理解诊断','待巩固 <b>3</b> 题','靠猜答对 <b>1</b> 题','已挽回 <b>1</b> 题','挽回率 <b>33%</b><small>（1/3）</small>','知识盲区 × 2','术语不懂 × 1','开始巩固练习（3 题）','标“已理解”（晚于末次作答）即出队'])assert(target.innerHTML.includes(part),`缺少内容：${part}`);
  assert(!target.innerHTML.includes('undefined'));
  assert(!target.innerHTML.includes('NaN'));
  const btn=target.querySelector('#today-consolidation');
  btn.onclick();
  assert.deepEqual(calls,[['consolidation']]);
});
