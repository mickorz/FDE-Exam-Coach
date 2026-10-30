export const MODULES = [
  ['M1','AI 与生成式 AI 基础',10],['M2','ADP 产品定位与能力边界',7],['M3','ADP 核心功能与应用搭建',22],['M4','场景理解与方案设计',25],['M5','行业解决方案与案例落地',15],['M6','交付实施、评测与运维',11],['M7','安全合规与责任 AI',10]
];
export const isCorrect = (given, correct) => Array.isArray(given) && given.length === correct.length && [...given].sort().join('|') === [...correct].sort().join('|');
export function currentRecord(state, question) {
  const old=state.records[question.id]||{attempts:[],favorite:false};
  const version=question.review?.contentHash || question.version || '2026-10-09';
  const attempts=old.attempts.filter(a=>a.questionVersion===version);
  const result={...old,attempts,lastCorrect:undefined,due:undefined,streak:0};
  for(const a of attempts)result.streak=a.correct?result.streak+1:0;
  const last=attempts.at(-1);
  if(last){result.lastCorrect=last.correct;result.due=last.at+(last.correct?[1,3,7,14,30][Math.min(result.streak-1,4)]*86400000:600000);}
  return result;
}
export function recordAnswer(state, question, answers, now=Date.now(), mode) {
  const old = state.records[question.id] || {attempts:[], streak:0, favorite:false};
  old.streak=currentRecord(state,question).streak;
  const correct = isCorrect(answers, question.answer);
  // mode 记录练习模式（chapter/random/unseen/wrong/favorite/review/exam）；旧备份无此字段，兼容
  const attempt={at:now,answers:[...answers],correct,questionVersion:question.review?.contentHash || question.version || '2026-10-09'};
  if(mode)attempt.mode=mode;
  old.attempts.push(attempt);
  old.streak = correct ? (old.streak||0)+1 : 0;
  old.due = now + (correct ? [1,3,7,14,30][Math.min(old.streak-1,4)]*86400000 : 600000);
  old.lastCorrect = correct;
  state.records[question.id] = old;
  return correct;
}
// 错因五分类（PRD 场景 B），用户标注事实，AI 只能建议不能代替
export const ERROR_TYPES = [
  ['concept','知识点不理解'],['confusion','相似概念混淆'],['memory','记忆不牢固'],['careless','审题失误'],['disputed','题目或答案争议']
];
export const ERROR_TYPE_LABELS = Object.fromEntries(ERROR_TYPES);
// 错题四态：完全由当前版本作答历史推导，不落库（借鉴 wrong-notebook 调度不落库设计）
// 最近一次作答错误：到期为待复习，答错 10 分钟冷却期内为复习中；错后连续答对 1~2 次为暂时掌握，3 次及以上为已掌握
export function wrongStatus(state, question, now=Date.now()) {
  const attempts=currentRecord(state,question).attempts;
  let lastWrong=-1;
  for(let i=attempts.length-1;i>=0;i--){if(!attempts[i].correct){lastWrong=i;break;}}
  if(lastWrong<0)return null;
  const correctSince=attempts.length-1-lastWrong;
  if(correctSince===0)return attempts.at(-1).at+600000>now?'复习中':'待复习';
  if(correctSince<=2)return '暂时掌握';
  return '已掌握';
}
// 考试结果按模块统计（快照题目优先，缺失题目跳过并计数）
export function examModuleStats(result, byId=new Map()) {
  const stats=new Map();
  let missing=0;
  for(const row of result.results){
    const q=row.question||byId.get(row.id);
    if(!q){missing++;continue;}
    const item=stats.get(q.module)||{module:q.module,total:0,correct:0};
    item.total++;if(row.correct)item.correct++;
    stats.set(q.module,item);
  }
  return {modules:[...stats.values()].sort((a,b)=>a.correct/a.total-b.correct/b.total),missing};
}
// 今日学习任务（FR-006）：全部由真实作答记录推导；未完成任务不做任何自动标记
export function todayPlan(questions, state, {now=Date.now(), dailyNew=30}={}) {
  const active=questions.filter(q=>q.quality?.examUse!=='hold');
  const fresh=active.filter(q=>currentRecord(state,q).attempts.length===0);
  // 新题优先推荐核心可组卷题，其次学习题
  const ordered=[...fresh.filter(q=>q.quality?.examUse==='eligible'),...fresh.filter(q=>q.quality?.examUse!=='eligible')];
  const due=active.filter(q=>{const r=currentRecord(state,q);return r.due&&r.due<=now;});
  const core=active.filter(q=>q.quality?.examUse==='eligible');
  const coreLearned=core.filter(q=>currentRecord(state,q).attempts.length>0).length;
  // 薄弱模块：最近 100 次作答（不限版本）中作答数达 5 次的模块按正确率升序
  const byId=new Map(active.map(q=>[q.id,q]));
  const flat=[];
  for(const [id,r] of Object.entries(state.records))for(const a of r.attempts)flat.push({id,correct:a.correct,at:a.at});
  flat.sort((a,b)=>a.at-b.at);
  const recent=flat.slice(-100);
  const per=new Map();
  for(const a of recent){const q=byId.get(a.id);if(!q)continue;const item=per.get(q.module)||{total:0,correct:0};item.total++;if(a.correct)item.correct++;per.set(q.module,item);}
  const weakModules=[...per.entries()].filter(([,v])=>v.total>=5).map(([module,v])=>({module,...v,accuracy:v.correct/v.total})).sort((a,b)=>a.accuracy-b.accuracy).slice(0,2);
  return {now,dailyNew,dueCount:due.length,dueIds:due.map(q=>q.id),freshIds:ordered.slice(0,dailyNew).map(q=>q.id),freshRemaining:Math.max(0,fresh.length-dailyNew),coreTotal:core.length,coreLearned,weakModules};
}
export function shuffle(array, random=Math.random) {
  const result = [...array]; for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;
}
export const EXAM_PROFILES = {
 full:{single:40,multiple:20,minutes:90,singlePoints:1.5,multiplePoints:2,label:'60题完整练习'},
 short:{single:10,multiple:5,minutes:25,singlePoints:6,multiplePoints:8,label:'15题短练（本地计分）'}
};
export function makeExam(questions, now=Date.now(), random=Math.random, mode='full') {
  const profile=EXAM_PROFILES[mode];if(!profile)throw new Error('未知练习模式');
  questions=questions.filter(q=>!q.quality || q.quality.examUse==='eligible');
  const single = questions.filter(q=>q.type==='single'), multiple=questions.filter(q=>q.type==='multiple');
  if(single.length<profile.single||multiple.length<profile.multiple) throw new Error(`可组卷题库不足 ${profile.single} 道单选和 ${profile.multiple} 道多选，暂不能组卷。`);
  // Largest-remainder target by official module proportions; fill from remaining pool if necessary.
  const choose = (pool,n) => {
    const picked=[]; const targets=MODULES.map(([id,,weight])=>({id,n:Math.floor(n*weight/100),r:n*weight/100%1}));
    let remaining=n-targets.reduce((a,x)=>a+x.n,0);
    [...targets].sort((a,b)=>b.r-a.r).slice(0,remaining).forEach(t=>t.n++);
    targets.forEach(t=>picked.push(...shuffle(pool.filter(q=>q.module===t.id),random).slice(0,t.n)));
    picked.push(...shuffle(pool.filter(q=>!picked.includes(q)),random).slice(0,n-picked.length));
    return shuffle(picked,random);
  };
  const selected=[...choose(single,profile.single),...choose(multiple,profile.multiple)];
  return {id:'exam-'+now,mode,startedAt:now,deadline:now+profile.minutes*60000,ids:selected.map(q=>q.id),snapshot:structuredClone(selected),answers:{},index:0};
}
export function gradeExam(exam, byId, now=Date.now()) {
  const profile=EXAM_PROFILES[exam.mode||'full'];if(!profile)throw new Error('未知练习模式');
  let points=0,correct=0; const results=[];
  const frozen=new Map((exam.snapshot||[]).map(q=>[q.id,q]));
  for(const id of exam.ids){const q=frozen.get(id)||byId.get(id);if(!q)throw new Error('试卷题目缺失，请恢复原题库版本后交卷');const ok=isCorrect(exam.answers[id]||[],q.answer);if(ok){correct++;points+=q.type==='single'?profile.singlePoints:profile.multiplePoints;}results.push({id,correct:ok,answers:exam.answers[id]||[],question:structuredClone(q)});}
  return {id:exam.id,mode:exam.mode||'full',bankVersion:exam.bankVersion||'legacy',startedAt:exam.startedAt,finishedAt:now,points,correct,total:exam.ids.length,results};
}
const choiceList=value=>Array.isArray(value)&&value.length<=5&&new Set(value).size===value.length&&value.every(k=>['A','B','C','D','E'].includes(k));
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
function validateQuestion(q){
  if(!object(q)||!['id','stem','topic','difficulty','explanation'].every(k=>typeof q[k]==='string')||!['single','multiple'].includes(q.type)||!object(q.options)||!['ABCD','ABCDE'].includes(Object.keys(q.options).sort().join(''))||!Object.values(q.options).every(v=>typeof v==='string')||!choiceList(q.answer)||(q.type==='single'?q.answer.length!==1:q.answer.length<2||q.answer.length>=Object.keys(q.options).length)||q.answer.some(k=>!Object.hasOwn(q.options,k))||!object(q.distractors)||!Object.values(q.distractors).every(v=>typeof v==='string')||!Array.isArray(q.sources)||!q.sources.length)throw new Error('备份题目快照无效');
  for(const source of q.sources){if(!object(source)||!['url','title','section','fact','verifiedAt','version'].every(k=>typeof source[k]==='string')||!/^https:\/\/(cloud\.tencent\.com|adp\.tencent\.com)\//.test(source.url))throw new Error('备份题目来源无效');}
}
export function validateBackup(value){
  if(!object(value)||value.schemaVersion!==1||!object(value.records)||!Array.isArray(value.sessions))throw new Error('不是受支持的学习备份');
  for(const [id,r] of Object.entries(value.records)){if(['__proto__','constructor','prototype'].includes(id)||!object(r)||!Array.isArray(r.attempts))throw new Error('备份题目记录无效：'+id);for(const a of r.attempts){if(!object(a)||!Number.isFinite(a.at)||typeof a.correct!=='boolean'||!choiceList(a.answers))throw new Error('备份答题记录无效：'+id);}}
  for(const s of value.sessions){
    if(s.mode!==undefined&&!EXAM_PROFILES[s.mode])throw new Error('备份历史练习模式无效');
    if(!object(s)||typeof s.id!=='string'||!Number.isFinite(s.points)||s.points<0||s.points>100||!Number.isFinite(s.finishedAt)||!Number.isFinite(s.startedAt)||!Number.isInteger(s.total)||!Number.isInteger(s.correct)||s.correct<0||s.correct>s.total||!Array.isArray(s.results)||s.total!==s.results.length)throw new Error('备份考试历史无效');
    for(const r of s.results){if(!object(r)||typeof r.id!=='string'||!choiceList(r.answers)||typeof r.correct!=='boolean')throw new Error('备份考试复盘无效');if(r.question){validateQuestion(r.question);if(r.question.id!==r.id)throw new Error('备份历史题目ID不一致');}}
  }
  if(value.activeExam){
    const x=value.activeExam;const profile=EXAM_PROFILES[x.mode||'full'];if(!profile)throw new Error('备份练习模式无效');const count=profile.single+profile.multiple;
    if(!object(x)||typeof x.id!=='string'||!Number.isFinite(x.startedAt)||!Array.isArray(x.ids)||x.ids.length!==count||!x.ids.every(id=>typeof id==='string')||new Set(x.ids).size!==count||!Number.isFinite(x.deadline)||!Number.isInteger(x.index)||x.index<0||x.index>=count||!object(x.answers)||Object.entries(x.answers).some(([id,a])=>!x.ids.includes(id)||!choiceList(a)))throw new Error('备份试卷无效');
    if(x.snapshot!==undefined){if(!Array.isArray(x.snapshot)||x.snapshot.length!==count||new Set(x.snapshot.map(q=>q?.id)).size!==count)throw new Error('备份题目快照无效');for(const q of x.snapshot){validateQuestion(q);if(!x.ids.includes(q.id))throw new Error('备份快照与试卷不一致');}}
  }
  return value;
}
function recalculateRecord(record){
  let streak=0;for(const a of record.attempts)streak=a.correct?streak+1:0;
  const last=record.attempts.at(-1);record.streak=streak;
  if(last){record.lastCorrect=last.correct;record.due=last.at+(last.correct?[1,3,7,14,30][Math.min(streak-1,4)]*86400000:600000);}
  return record;
}
export function mergeBackup(current,incoming,{recoverActive=false}={}){
  validateBackup(incoming); const merged=structuredClone(current);
  for(const [id,r] of Object.entries(incoming.records)){
    const old=merged.records[id]; if(!old){merged.records[id]=recalculateRecord(structuredClone(r));continue;}
    const attempts=[...old.attempts,...r.attempts].filter((a,i,arr)=>arr.findIndex(b=>b.at===a.at&&b.questionVersion===a.questionVersion&&JSON.stringify(b.answers)===JSON.stringify(a.answers))===i).sort((a,b)=>a.at-b.at);
    const latest=(r.attempts.at(-1)?.at||0)>(old.attempts.at(-1)?.at||0)?r:old;
    merged.records[id]=recalculateRecord({...latest,attempts,favorite:!!(old.favorite||r.favorite)});
  }
  merged.sessions=[...current.sessions,...incoming.sessions].filter((s,i,arr)=>arr.findIndex(t=>t.id===s.id)===i);
  const completed=new Set(merged.sessions.map(s=>s.id));
  if(merged.activeExam&&completed.has(merged.activeExam.id))merged.activeExam=null;
  if(incoming.activeExam&&!completed.has(incoming.activeExam.id)&&(!merged.activeExam||(recoverActive&&merged.activeExam.id===incoming.activeExam.id)))merged.activeExam=structuredClone(incoming.activeExam);
  return merged;
}
