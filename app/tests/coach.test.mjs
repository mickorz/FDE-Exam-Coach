import test from 'node:test';
import assert from 'node:assert/strict';
import {recordAnswer,wrongStatus,examModuleStats,todayPlan,ERROR_TYPES,ERROR_TYPE_LABELS,validateBackup} from '../src/core.js';
const q={id:'FDE-M1-001',type:'single',module:'M1',answer:['B'],quality:{examUse:'eligible'}};
const q2={id:'FDE-M2-001',type:'single',module:'M2',answer:['A'],quality:{examUse:'eligible'}};
const q3={id:'FDE-M2-002',type:'single',module:'M2',answer:['C'],quality:{examUse:'learning_only'}};
const fresh=()=>({schemaVersion:1,revision:0,records:{},sessions:[],activeExam:null,settings:{}});

test('作答记录练习模式，旧格式兼容',()=>{
  const s=fresh();
  recordAnswer(s,q,['B'],1000,'chapter');
  assert.equal(s.records[q.id].attempts[0].mode,'chapter');
  recordAnswer(s,q2,['X'],1000);
  assert.equal(s.records[q2.id].attempts[0].mode,undefined);
});

test('错因五分类与 PRD 定义一致',()=>{
  assert.deepEqual(ERROR_TYPES.map(([k])=>k),['concept','confusion','memory','careless','disputed']);
  assert.equal(ERROR_TYPE_LABELS.disputed,'题目或答案争议');
});

test('错题四态推导：答错冷却期为复习中，到期为待复习',()=>{
  const s=fresh();
  recordAnswer(s,q,['A'],1000,'chapter');
  assert.equal(wrongStatus(s,q,2000),'复习中');
  assert.equal(wrongStatus(s,q,1000+600001),'待复习');
});

test('错题四态推导：错后连续答对进入暂时掌握与已掌握，再答错回到待复习',()=>{
  const s=fresh();
  recordAnswer(s,q,['A'],1000);
  recordAnswer(s,q,['B'],2000);
  assert.equal(wrongStatus(s,q,2000),'暂时掌握');
  recordAnswer(s,q,['B'],3000);
  recordAnswer(s,q,['B'],4000);
  assert.equal(wrongStatus(s,q,4000),'已掌握');
  recordAnswer(s,q,['A'],5000);
  assert.equal(wrongStatus(s,q,5000),'复习中');
});

test('带练习模式与错因的记录通过备份校验，合并后字段保留',()=>{
  const s=fresh();
  recordAnswer(s,q,['A'],1000,'chapter');
  s.records[q.id].errorType='concept';
  const merged=validateBackup(structuredClone(s));
  assert.equal(merged.records[q.id].attempts[0].mode,'chapter');
  assert.equal(merged.records[q.id].errorType,'concept');
});

test('从未答错或修订换版后的新历史不产生错题状态',()=>{
  const s=fresh();
  recordAnswer(s,q,['B'],1000);
  assert.equal(wrongStatus(s,q),null);
  const revised={...q,review:{contentHash:'v2'}};
  assert.equal(wrongStatus(s,revised),null);
});

test('考试结果按模块统计并按正确率升序，缺题计入缺失',()=>{
  const rows=[
    {id:'a',correct:false,question:{module:'M1'}},
    {id:'b',correct:true,question:{module:'M1'}},
    {id:'c',correct:true,question:{module:'M2'}},
    {id:'d',correct:false,answers:[],question:null},
  ];
  // 快照题目优先；无快照时回退当前题库，仍缺则计入 missing
  const resolved=examModuleStats({results:rows},new Map([['d',{module:'M3'}]]));
  assert.equal(resolved.missing,0);
  assert.deepEqual(resolved.modules,[{module:'M3',total:1,correct:0},{module:'M1',total:2,correct:1},{module:'M2',total:1,correct:1}]);
  const {modules,missing}=examModuleStats({results:rows});
  assert.equal(missing,1);
  assert.deepEqual(modules,[{module:'M1',total:2,correct:1},{module:'M2',total:1,correct:1}]);
});

test('今日任务：新题限量且核心优先，到期复习计数，核心完成率正确',()=>{
  const s=fresh();
  const bank=[q,q2,q3];
  recordAnswer(s,q2,['A'],1000,'chapter');
  const plan=todayPlan(bank,s,{now:2000,dailyNew:30});
  assert.equal(plan.coreTotal,2);
  assert.equal(plan.coreLearned,1);
  assert.equal(plan.dueCount,0); // q2 刚答对，下次复习在 1 天后，未到期
  assert.deepEqual(plan.freshIds,[q.id,q3.id]);
  // 学习题排在学习题之后：截断时核心题优先保留
  const plan2=todayPlan(bank,s,{now:2000,dailyNew:1});
  assert.deepEqual(plan2.freshIds,[q.id]);
  assert.equal(plan2.freshRemaining,1);
});

test('今日任务：薄弱模块按最近作答正确率识别，样本不足不评估',()=>{
  const s=fresh();
  // M1 错 4 对 1（达 5 次样本线）；M2 仅 1 次作答，样本不足不进入薄弱列表
  recordAnswer(s,q,['A'],1000);
  recordAnswer(s,q,['A'],2000);
  recordAnswer(s,q,['A'],3000);
  recordAnswer(s,q,['A'],3500);
  recordAnswer(s,q,['B'],4000);
  recordAnswer(s,q2,['A'],5000);
  const plan=todayPlan([q,q2],s,{now:6000});
  assert.equal(plan.weakModules.length,1);
  assert.equal(plan.weakModules[0].module,'M1');
  assert.equal(plan.weakModules[0].accuracy,0.2);
});

test('今日任务：待修订题不进入新题与复习推荐',()=>{
  const s=fresh();
  const held={id:'FDE-X-999',type:'single',module:'M1',answer:['A'],quality:{examUse:'hold'}};
  const plan=todayPlan([q,held],s,{now:1000});
  assert.deepEqual(plan.freshIds,[q.id]);
});
