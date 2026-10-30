import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToday} from '../src/today.js';
import {recordAnswer} from '../src/core.js';

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
  for(const part of ['距考试还有','今日新题目标','到期复习题','核心题库完成率','近期薄弱模块','最近模拟：73 分','每日新题目标','不会被自动标记为完成'])assert(target.innerHTML.includes(part),`缺少内容：${part}`);
  assert(!target.innerHTML.includes('undefined'),'页面出现 undefined');
  assert(!target.innerHTML.includes('NaN'),'页面出现 NaN');
});
