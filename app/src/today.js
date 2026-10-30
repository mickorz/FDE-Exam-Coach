import {todayPlan} from './core.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// 今日任务首页（FR-006）：所有推荐均由真实作答记录推导；未完成任务不做任何自动标记
export function renderToday(target,{questions,state,manifest,MODULES,actions,save,render}){
 const now=Date.now();
 const s=state();
 const settings=s.settings||{};
 const dailyNew=Math.max(1,Number(settings.dailyNew)||30);
 const plan=todayPlan(questions,s,{now,dailyNew});
 const targetDate=settings.targetDate||'2026-11-23';
 const targetMs=new Date(targetDate+'T00:00:00').getTime();
 const daysLeft=Number.isFinite(targetMs)?Math.max(0,Math.ceil((targetMs-now)/86400000)):null;
 const pct=plan.coreTotal?Math.round(plan.coreLearned/plan.coreTotal*100):0;
 const last=(s.sessions||[]).at(-1);
 const modName=id=>MODULES.find(m=>m[0]===id)?.[1]||id;
 target.innerHTML=`
<section class="reading-block today-hero"><h2>${daysLeft!==null?`距考试还有 <strong class="countdown">${daysLeft}</strong> 天`:'尚未设置考试日期'}</h2><p class="muted">目标日期 ${esc(targetDate)} · 题库 ${esc(manifest.version)} · 可在“学习进度”页修改目标日期</p>
 <div class="metrics today-metrics">
  <div><strong>${plan.freshIds.length}<small> / ${dailyNew} 道</small></strong><span>今日新题目标${plan.freshRemaining?`（全部未做 ${plan.freshIds.length+plan.freshRemaining} 题）`:''}</span></div>
  <div><strong>${plan.dueCount}</strong><span>到期复习题</span></div>
  <div><strong>${pct}%<small> · ${plan.coreLearned}/${plan.coreTotal}</small></strong><span>核心题库完成率</span></div>
 </div>
 <div class="today-actions">
  <button id="today-new" class="primary">开始今日新题（${plan.freshIds.length} 道）</button>
  <button id="today-review">复习到期题（${plan.dueCount} 道）</button>
  ${last?`<button id="today-last">最近模拟：${esc(String(last.points))} 分 / 100 · 查看复盘</button>`:`<button id="today-exam">还没有模拟成绩，去考一场</button>`}
 </div>
 <p class="muted">今日目标可在下方调整；推荐依据：未做核心题、到期错题复习、近期正确率较低的模块。任务未完成不会被自动标记为完成。</p>
 <label class="today-quota">每日新题目标 <input id="today-daily" type="number" min="1" max="200" value="${dailyNew}"> 道</label>
</section>
${plan.weakModules.length?`<section class="reading-block"><h2>近期薄弱模块</h2>${plan.weakModules.map(m=>`<div class="progress-row"><div><b>${esc(modName(m.module))}</b><span>最近正确率 ${Math.round(m.accuracy*100)}%（${m.correct}/${m.total} 次作答）</span></div><progress value="${m.correct}" max="${m.total}"></progress></div><button class="weak-drill" data-weak-module="${esc(m.module)}">专项练习 ${esc(modName(m.module))}</button>`).join('')}</section>`:`<section class="reading-block"><h2>近期薄弱模块</h2><p class="muted">作答样本还不足（每个模块至少 5 次作答才参与评估），先完成今日新题。</p></section>`}
<section class="reading-block"><h2>今日安排建议</h2><p>${plan.dueCount?'先清到期复习，再做新题；':'暂无到期复习，直接推进新题；'}${plan.weakModules.length?`新题完成后到「${esc(modName(plan.weakModules[0].module))}」做专项训练。`:'完成后再考虑一场 15 题短练检验状态。'}</p><p class="muted">间隔复习规则：答对后 1、3、7、14、30 天再回忆；答错 10 分钟后再试。这是本软件的学习策略，不是官方考试规则。</p></section>`;
 target.querySelector('#today-new').onclick=()=>actions.startNew(plan.freshIds);
 target.querySelector('#today-review').onclick=()=>actions.startReview();
 target.querySelector(last?'#today-last':'#today-exam').onclick=()=>last?actions.openLastExam():actions.startExam();
 target.querySelector('#today-daily').onchange=e=>{
   const value=Math.max(1,Math.min(200,Number(e.target.value)||30));
   state().settings={...state().settings,dailyNew:value};
   save();render();
 };
 target.querySelectorAll('[data-weak-module]').forEach(b=>b.onclick=()=>actions.startModule(b.dataset.weakModule));
}
