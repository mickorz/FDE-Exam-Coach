export const MODULES = [
  ['M1','AI 与生成式 AI 基础',10],['M2','ADP 产品定位与能力边界',7],['M3','ADP 核心功能与应用搭建',22],['M4','场景理解与方案设计',25],['M5','行业解决方案与案例落地',15],['M6','交付实施、评测与运维',11],['M7','安全合规与责任 AI',10]
];
export const DEFAULT_EXAM_DATE = '2026-11-23';
// 复习到期时间（FR-008）：答错 10 分钟后再试；答对按 [1,3,7,14,30] 天递增；
// 考试临近时封顶——到期日不晚于考前 2 天，且至少次日（避免长间隔把复习排到考后）
function examDateOf(state){
  const raw=state?.settings?.targetDate||DEFAULT_EXAM_DATE;
  const time=new Date(raw+'T00:00:00').getTime();
  return Number.isFinite(time)?time:null;
}
function computeDue(now, correct, streak, examDate){
  if(!correct)return now+600000;
  let due=now+[1,3,7,14,30][Math.min(Math.max(streak-1,0),4)]*86400000;
  if(!examDate||examDate<=now)return due;
  const preExam=examDate-2*86400000;
  return due>preExam?Math.max(now+86400000,preExam):due;
}
export const isCorrect = (given, correct) => Array.isArray(given) && given.length === correct.length && [...given].sort().join('|') === [...correct].sort().join('|');
export const qVersion = question => question.review?.contentHash || question.version || '2026-10-09';
export function currentRecord(state, question) {
  const old=state.records[question.id]||{attempts:[],favorite:false};
  const version=qVersion(question);
  const attempts=old.attempts.filter(a=>a.questionVersion===version);
  const result={...old,attempts,lastCorrect:undefined,due:undefined,streak:0};
  for(const a of attempts)result.streak=a.correct?result.streak+1:0;
  const last=attempts.at(-1);
  if(last){result.lastCorrect=last.correct;result.due=computeDue(last.at,last.correct,result.streak,examDateOf(state));}
  return result;
}
export function recordAnswer(state, question, answers, now=Date.now(), mode) {
  const old = state.records[question.id] || {attempts:[], streak:0, favorite:false};
  old.streak=currentRecord(state,question).streak;
  const correct = isCorrect(answers, question.answer);
  // mode 记录练习模式（chapter/random/unseen/wrong/favorite/review/exam）；旧备份无此字段，兼容
  const attempt={at:now,answers:[...answers],correct,questionVersion:qVersion(question)};
  if(mode)attempt.mode=mode;
  old.attempts.push(attempt);
  old.streak = correct ? (old.streak||0)+1 : 0;
  old.due = computeDue(now, correct, old.streak, examDateOf(state));
  old.lastCorrect = correct;
  state.records[question.id] = old;
  return correct;
}
// 错因五分类（PRD 场景 B），用户标注事实，AI 只能建议不能代替
export const ERROR_TYPES = [
  ['concept','知识点不理解'],['confusion','相似概念混淆'],['memory','记忆不牢固'],['careless','审题失误'],['disputed','题目或答案争议']
];
export const ERROR_TYPE_LABELS = Object.fromEntries(ERROR_TYPES);
// FR-013 题目理解诊断：把握程度（维度A 单选）与障碍类型（维度B 多选）——答对也可标记，刷完 ≠ 理解
export const CONFIDENCE_LEVELS = [['sure','确定理解，能解释答案'],['eliminate','不太确定，靠排除法'],['guess','基本靠猜，不知道怎么选']];
export const OBSTACLE_TYPES = [['knowledge_gap','知识盲区：知识点完全没学过'],['term','术语不懂：专业名词看不懂'],['unclear_goal','考点不明：不知道在考什么'],['cannot_apply','不会应用：知道概念不会选'],['confused','概念混淆：多个选项感觉都对'],['misread','审题失误：忽略条件或关键词']];
export const MASTERY_LEVELS = [['understood','已理解'],['partial','部分理解'],['lost','仍然不懂']];
const CONFIDENCE_KEYS = new Set(CONFIDENCE_LEVELS.map(([k])=>k));
const OBSTACLE_KEYS = new Set(OBSTACLE_TYPES.map(([k])=>k));
const MASTERY_KEYS = new Set(MASTERY_LEVELS.map(([k])=>k));
// 自评写入（作答后补标）：定位指定 attempt，写把握程度/障碍与 selfEvalAt（多端合并依据）
export function applySelfEval(state, question, attemptAt, {confidence, obstacles}, now=Date.now()) {
  const record = state.records[question.id]; if (!record) return false;
  const attempt = record.attempts.find(a => a.at === attemptAt && a.questionVersion === qVersion(question));
  if (!attempt) return false;
  if (confidence !== undefined) attempt.confidence = confidence;
  if (obstacles !== undefined) attempt.obstacles = [...obstacles];
  attempt.selfEvalAt = now;
  return true;
}
// 掌握状态写入：masteryVersion 记录标记时题目版本（题目更新后旧“已理解”失效）
export function setMastery(state, question, mastery, now=Date.now()) {
  const record = state.records[question.id]; if (!record) return false;
  record.mastery = mastery; record.masteryAt = now; record.masteryVersion = qVersion(question);
  return true;
}
// 待巩固队列（计划 v2.1 五条件）：未作答不入队；partial/lost 直接入队；
// 其余仅在“当前版本 + 最新作答之后（含同毫秒）主动确认已理解”时解除（覆盖 条件1答错/2靠排除或猜/3有障碍/5当前版本未确认掌握）
export function needsConsolidation(record, currentVersion) {
  const last = (record?.attempts || []).at(-1);
  if (!last) return false;
  if (record.mastery === 'partial' || record.mastery === 'lost') return true;
  const confirmed = record.mastery === 'understood' && record.masteryVersion === currentVersion && (record.masteryAt || 0) >= last.at;
  return !confirmed;
}
// 蒙对题：最近一次答对但靠猜
export function luckyCorrect(record) {
  const last = (record?.attempts || []).at(-1);
  return !!last && last.correct === true && last.confidence === 'guess';
}
// 障碍分布（每题取最近一次作答的标记）
export function obstacleStats(records) {
  const counts = {}; let marked = 0;
  for (const record of Object.values(records || {})) {
    const obstacles = record?.attempts?.at(-1)?.obstacles;
    if (!Array.isArray(obstacles) || !obstacles.length) continue;
    marked++;
    for (const key of obstacles) counts[key] = (counts[key] || 0) + 1;
  }
  return {marked, counts};
}
// 掌握状态分布（仅统计有作答的题，含未标记）
export function masteryStats(records) {
  const counts = {understood: 0, partial: 0, lost: 0, unmarked: 0};
  for (const record of Object.values(records || {})) {
    if (!record?.attempts?.length) continue;
    if (MASTERY_KEYS.has(record.mastery)) counts[record.mastery]++;
    else counts.unmarked++;
  }
  return counts;
}
// 学习挽回指标（DoD #10）：曾处障碍状态 → 当前已确认理解
export function wasStruggling(record) {
  return (record?.attempts || []).some(a => !a.correct || a.confidence === 'guess' || a.confidence === 'eliminate' || (Array.isArray(a.obstacles) && a.obstacles.length));
}
export function recovered(record, currentVersion) {
  return wasStruggling(record) && !needsConsolidation(record, currentVersion);
}
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
export function todayPlan(questions, state, {now=Date.now(), dailyNew}={}) {
  // 每日目标优先级：显式参数 > settings.dailyNew > 默认 50（FR-012 设置）
  const quota=Math.max(1,Math.min(200,Number(dailyNew??state?.settings?.dailyNew)||50));
  const active=questions.filter(q=>q.quality?.examUse!=='hold');
  const fresh=active.filter(q=>currentRecord(state,q).attempts.length===0);
  // 新题优先推荐核心可组卷题，其次学习题
  const ordered=[...fresh.filter(q=>q.quality?.examUse==='eligible'),...fresh.filter(q=>q.quality?.examUse!=='eligible')];
  const due=active.filter(q=>{const r=currentRecord(state,q);return r.due&&r.due<=now;});
  const core=active.filter(q=>q.quality?.examUse==='eligible');
  const coreLearned=core.filter(q=>currentRecord(state,q).attempts.length>0).length;
  // FR-012 修复：doneToday=当日首次作答（当日新学）的题数；freshIds 只装“今日剩余额度”。
  // 此前 freshIds 永远装满 quota 道未做题，做完几题刷新后仍显示 50 道，用户会误以为进度未保存。
  const dayStart=new Date(now);dayStart.setHours(0,0,0,0);
  const activeIds=new Set(active.map(q=>q.id));
  const doneToday=Object.entries(state.records||{}).filter(([id,r])=>activeIds.has(id)&&r.attempts?.length&&r.attempts[0].at>=dayStart.getTime()).length;
  const freshIds=ordered.slice(0,Math.max(0,quota-doneToday)).map(q=>q.id);
  const freshRemaining=Math.max(0,fresh.length-freshIds.length);
  // 薄弱模块：最近 100 次作答（不限版本）中作答数达 5 次的模块按正确率升序
  const byId=new Map(active.map(q=>[q.id,q]));
  const flat=[];
  for(const [id,r] of Object.entries(state.records))for(const a of r.attempts)flat.push({id,correct:a.correct,at:a.at});
  flat.sort((a,b)=>a.at-b.at);
  const recent=flat.slice(-100);
  const per=new Map();
  for(const a of recent){const q=byId.get(a.id);if(!q)continue;const item=per.get(q.module)||{total:0,correct:0};item.total++;if(a.correct)item.correct++;per.set(q.module,item);}
  const weakModules=[...per.entries()].filter(([,v])=>v.total>=5).map(([module,v])=>({module,...v,accuracy:v.correct/v.total})).sort((a,b)=>a.accuracy-b.accuracy).slice(0,2);
  return {now,dailyNew:quota,doneToday,dueCount:due.length,dueIds:due.map(q=>q.id),freshIds,freshRemaining,coreTotal:core.length,coreLearned,weakModules};
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
  for(const [id,r] of Object.entries(value.records)){if(['__proto__','constructor','prototype'].includes(id)||!object(r)||!Array.isArray(r.attempts))throw new Error('备份题目记录无效：'+id);for(const a of r.attempts){if(!object(a)||!Number.isFinite(a.at)||typeof a.correct!=='boolean'||!choiceList(a.answers))throw new Error('备份答题记录无效：'+id);
    if(a.confidence!==undefined&&!CONFIDENCE_KEYS.has(a.confidence))throw new Error('备份把握程度无效：'+id);
    if(a.obstacles!==undefined&&(!Array.isArray(a.obstacles)||a.obstacles.some(k=>!OBSTACLE_KEYS.has(k))))throw new Error('备份障碍标记无效：'+id);
    if(a.selfEvalAt!==undefined&&!Number.isFinite(a.selfEvalAt))throw new Error('备份自评时间无效：'+id);}
    if(r.mastery!==undefined&&(!MASTERY_KEYS.has(r.mastery)||(r.masteryAt!==undefined&&!Number.isFinite(r.masteryAt))))throw new Error('备份掌握状态无效：'+id);}
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
function recalculateRecord(record, examDate){
  let streak=0;for(const a of record.attempts)streak=a.correct?streak+1:0;
  const last=record.attempts.at(-1);record.streak=streak;
  if(last){record.lastCorrect=last.correct;record.due=computeDue(last.at,last.correct,streak,examDate);}
  return record;
}
export function mergeBackup(current,incoming,{recoverActive=false}={}){
  validateBackup(incoming); const merged=structuredClone(current);
  const examDate=examDateOf(current);
  for(const [id,r] of Object.entries(incoming.records)){
    const old=merged.records[id]; if(!old){merged.records[id]=recalculateRecord(structuredClone(r),examDate);continue;}
    // FR-013：同键 attempt（at+版本+答案）先分组，组内合并自评字段（selfEvalAt 新者胜），避免“事后补的标签”被无标签副本覆盖
    const groups=new Map();
    for(const a of [...old.attempts,...r.attempts]){
      const key=a.at+'|'+a.questionVersion+'|'+JSON.stringify(a.answers);
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(a);
    }
    const attempts=[...groups.values()].map(group=>{
      const base=structuredClone(group[0]);
      let best=group[0];
      for(const a of group)if((a.selfEvalAt||0)>(best.selfEvalAt||0))best=a;
      for(const k of ['confidence','obstacles','selfEvalAt'])if(best[k]!==undefined)base[k]=structuredClone(best[k]);
      return base;
    }).sort((a,b)=>a.at-b.at);
    const latest=(r.attempts.at(-1)?.at||0)>(old.attempts.at(-1)?.at||0)?r:old;
    const mergedRecord={...latest,attempts,favorite:!!(old.favorite||r.favorite)};
    // FR-013：掌握状态按 masteryAt 新者合并（同刻保 current）
    const mSrc=(r.masteryAt||0)>(old.masteryAt||0)?r:old;
    if(mSrc.mastery){mergedRecord.mastery=mSrc.mastery;mergedRecord.masteryAt=mSrc.masteryAt;mergedRecord.masteryVersion=mSrc.masteryVersion;}
    merged.records[id]=recalculateRecord(mergedRecord,examDate);
  }
  merged.sessions=[...current.sessions,...incoming.sessions].filter((s,i,arr)=>arr.findIndex(t=>t.id===s.id)===i);
  const completed=new Set(merged.sessions.map(s=>s.id));
  if(merged.activeExam&&completed.has(merged.activeExam.id))merged.activeExam=null;
  if(incoming.activeExam&&!completed.has(incoming.activeExam.id)&&(!merged.activeExam||(recoverActive&&merged.activeExam.id===incoming.activeExam.id)))merged.activeExam=structuredClone(incoming.activeExam);
  return merged;
}
