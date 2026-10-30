import {MODULES,isCorrect,currentRecord,recordAnswer,makeExam,gradeExam,validateBackup,mergeBackup,ERROR_TYPES,wrongStatus,examModuleStats,shuffle} from './core.js';
import {Store} from './store.js';
import {renderRounds} from './rounds.js';
import {renderToday} from './today.js';
const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = selector => document.querySelector(selector);
const store=new Store();
let rounds=[],pool='core',questions=[],manifest={},byId=new Map(),page='today',module='all',query='',index=0,answers=[],submitted=false,selectedList=[],examResult=null,statusFilter='active',randomIds=null,todayNewIds=[];
const nav=[['today','今日任务'],['study','章节学习'],['review','间隔复习'],['wrong','错题本'],['favorites','收藏'],['exam','模拟考试'],['progress','学习进度'],['backup','数据备份'],['rounds','题库版本']];
const subtitle={today:'根据真实作答记录安排今天的学习。',rounds:'原创题库组成、内容复核与专项练习。',study:'按官方考试大纲分章节学习，逐步掌握核心知识点。',review:'到期再回忆一次，让知识留得更久。',wrong:'从答错过的题目开始，修正理解。',favorites:'把值得再读的题目留在这里。',exam:'25 分钟短练 / 90 分钟完整练习',progress:'看见覆盖情况，安排下一次学习。',backup:'题库和学习记录保存在本机，不需要账号。'};
const icon = n => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${['M3 4h7l2 2 2-2h7v15h-7l-2 2-2-2H3z M12 6v15','M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9 M12 7v5l3 2','M7 5H4v16h16V5h-3 M8 3h8v4H8z M8 12h8 M8 16h5','m12 3 3 6 6 1-4.5 4.5 1 6.5-5.5-3-5.5 3 1-6.5L3 10l6-1z','M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5','M4 21V11h4v10 M10 21V6h4v15 M16 21V3h4v18','M4 5h16v15H4z M8 5V2h8v3 M8 10h8 M8 15h8'][n%7]}"/></svg>`;
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),4000);}
function state(){return store.state;}
function record(q){return currentRecord(state(),q);}
function save(){store.save();}
function scoringText(){return '本地练习计分：单选 1.5 分、多选 2 分，70 分为参考线；练习成绩不能预测正式考试成绩。';}
function inPool(q){
 const coreIds=rounds[0]?.coreIds||[];
 if(pool==='all')return true;
 if(pool==='unseen')return !state().records[q.id]?.attempts?.length;
 if(pool==='today')return todayNewIds.includes(q.id);
 if(pool==='original')return rounds[0]?.recheckedOriginalIds.includes(q.id);
 if(pool==='original-revised')return rounds[0]?.revisedOriginalIds.includes(q.id);
 if(pool==='weak')return rounds[0]?.focusedPracticeIds.includes(q.id);
 if(pool==='revised')return rounds[0]?.revisedIds.includes(q.id);
 return coreIds.includes(q.id);
}
function poolOptions(){
 const base=[['core','核心 500 题'],['original','原 400 题 · 已逐题复核'],['original-revised','原题修订专项 118 题'],['revised','本轮重写 100 题'],['weak','原创专项 15 题'],['all','全部可学习题'],['unseen','未做题'],['random','随机练习'],['today','今日新题']];
 return base.map(([v,l])=>`<option value="${v}" ${pool===v?'selected':''}>${l}</option>`).join('');
}
function filtered(){
 if(pool==='random'){ // 随机练习：缓存洗牌顺序，章节与搜索筛选仍生效
   if(!randomIds)randomIds=shuffle(questions.filter(q=>q.quality?.examUse!=='hold').map(q=>q.id));
   return randomIds.map(id=>byId.get(id)).filter(q=>{const r=record(q);return (module==='all'||q.module===module)&&(!query||[q.stem,q.topic,q.id,...Object.values(q.options)].join(' ').toLowerCase().includes(query.toLowerCase()))&&(page!=='favorites'||r.favorite)&&(page!=='review'||r.due&&r.due<=Date.now());});
 }
 return questions.filter(q=>{
  const r=record(q);const ws=page==='wrong'?wrongStatus(state(),q):null;
  return (!['study','review'].includes(page)||inPool(q))
   &&(!['study','review'].includes(page)||q.quality?.examUse!=='hold')
   &&(module==='all'||q.module===module)
   &&(!query||[q.stem,q.topic,q.id,...Object.values(q.options)].join(' ').toLowerCase().includes(query.toLowerCase()))
   &&(page!=='wrong'||ws&&(statusFilter==='active'?ws==='待复习'||ws==='复习中':!statusFilter||ws===statusFilter))
   &&(page!=='favorites'||r.favorite)
   &&(page!=='review'||r.due&&r.due<=Date.now());
 });
}
// 当前页面对应的练习模式标记（FR-002）
function studyMode(){
 if(page==='wrong')return 'wrong';
 if(page==='favorites')return 'favorite';
 if(page==='review')return 'review';
 if(pool==='random')return 'random';
 if(pool==='unseen'||pool==='today')return 'unseen';
 return 'chapter';
}
function render(){
 const due=questions.filter(q=>record(q).due<=Date.now()).length;
 $('#app').innerHTML=`<div class="shell"><aside class="sidebar"><a class="brand" href="#study">FDE 备考</a><nav aria-label="主导航">${nav.map(([id,label],n)=>`<button class="nav-button ${page===id?'active':''}" data-page="${id}" ${page===id?'aria-current="page"':''}>${icon(n)}<span>${label}</span>${id==='review'&&due?`<small>${due}</small>`:''}</button>`).join('')}</nav><div class="side-footer"><span class="local-dot"></span>本地离线学习<br><span id="save-status">已保存到本机</span><small>题库 ${esc(manifest.version)}<br>保留 ${questions.length} 题 · 可组卷 ${questions.filter(q=>q.quality?.examUse==='eligible').length} 题</small></div></aside><main id="main"><header><h1>${nav.find(x=>x[0]===page)?.[1]}</h1><p>${subtitle[page]}</p></header>${store.recoverySnapshot?'<div class="recovery-notice" role="status">发现与磁盘不同的浏览器应急副本，已另外保留。<button id="recovery-link">查看并恢复</button></div>':''}<div class="recovery-notice">原创题库：核心 500 题 · 原 400 题已复核、修订 118 题 · 另重写 100 题 · 提供 15 道原创专项练习。<a href="/evidence.html" target="_blank">查看题库版本与质量分级</a></div><div id="content"></div><footer>依据官方资料编写的原创模拟题，非官方真题，不保证押中。<br><a href="https://cloud.tencent.com/document/product/658/137832" target="_blank" rel="noopener noreferrer">官方考试指南</a> · 来源核实 ${esc(manifest.verifiedAt)}</footer></main><aside class="outline"><h2>考试模块与官方占比</h2>${MODULES.map(([id,name,weight],i)=>`<button class="module-row ${module===id?'active':''}" data-module="${id}"><span class="module-number">${i+1}</span><span>${name}</span><b>${weight}%</b></button>`).join('')}<p class="muted">占比用于学习覆盖规划；随机模拟组卷尽量按比例分配，实际考试题目分布以官方为准。</p><details class="version-note"><summary>考纲与产品版本差异</summary><p>2026-09-10 考纲含 Schema；产品文档标记其于 2026-08-27 下架，存量用户仍可使用。新版长期记忆以记忆库和终端用户隔离，勿沿用旧版应用级隔离结论。</p><a href="https://cloud.tencent.com/document/product/1759/123555" target="_blank" rel="noopener">查看 Schema 说明</a><br><a href="https://cloud.tencent.com/document/product/1759/138162" target="_blank" rel="noopener">查看新版长期记忆</a></details></aside></div>`;
 if($('#recovery-link'))$('#recovery-link').onclick=()=>navigate('backup');
 document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>navigate(b.dataset.page));
 document.querySelectorAll('[data-module]').forEach(b=>b.onclick=()=>{if(state().activeExam){toast('模拟考试进行中，请先交卷再进入章节学习');return;}module=b.dataset.module;page='study';index=0;resetQuestion();render();});
 if(['study','review','wrong','favorites'].includes(page))renderStudy();
 if(page==='today')renderToday($('#content'),{questions,state,manifest,MODULES,actions:todayActions,save,render:()=>render()});
 if(page==='rounds')renderRounds($('#content'),rounds,{reviewOriginal:()=>{pool='original-revised';module='all';query='';page='study';index=0;resetQuestion();render();},study:(id)=>{pool='all';module='all';query=id;page='study';index=0;resetQuestion();render();},practice:()=>{page='exam';render();},focus:()=>{pool='weak';module='all';query='';page='study';index=0;resetQuestion();render();}});
 if(page==='exam')renderExam();if(page==='progress')renderProgress();if(page==='backup')renderBackup();
 if(store.pending)store.onStatus('正在保存…');
 if(store.failed)store.onStatus('磁盘保存失败，请导出备份',true);
}
function navigate(next){if(state().activeExam&&['today','study','review','wrong','favorites','rounds'].includes(next)){toast('模拟考试进行中，请先交卷再查看练习与解析');return;}page=next;index=0;resetQuestion();examResult=null;statusFilter='active';render();}
function resetQuestion(){answers=[];submitted=false;}
function renderStudy(){
 selectedList=filtered();index=Math.min(index,Math.max(0,selectedList.length-1));
 $('#content').innerHTML=`<div class="filters">${['study','review'].includes(page)?`<label class="sr-only" for="pool">训练范围</label><select id="pool">${poolOptions()}</select>`:''}<label class="sr-only" for="module">考纲模块</label><select id="module"><option value="all">全部章节</option>${MODULES.map(([id,name])=>`<option value="${id}" ${module===id?'selected':''}>${name}</option>`).join('')}</select><label class="sr-only" for="search">搜索题目或考点</label><input id="search" type="search" placeholder="搜索题目或考点" value="${esc(query)}">${page==='wrong'?`<label class="sr-only" for="wstatus">错题状态</label><select id="wstatus"><option value="active" ${statusFilter==='active'?'selected':''}>待纠正</option><option value="待复习" ${statusFilter==='待复习'?'selected':''}>待复习</option><option value="复习中" ${statusFilter==='复习中'?'selected':''}>复习中</option><option value="暂时掌握" ${statusFilter==='暂时掌握'?'selected':''}>暂时掌握</option><option value="已掌握" ${statusFilter==='已掌握'?'selected':''}>已掌握</option><option value="" ${!statusFilter?'selected':''}>全部错题</option></select>`:''}</div><div id="question"></div>`;
 if($('#pool'))$('#pool').onchange=e=>{pool=e.target.value;randomIds=null;index=0;resetQuestion();render();};
 if($('#wstatus'))$('#wstatus').onchange=e=>{statusFilter=e.target.value;index=0;renderStudy();};
 $('#module').onchange=e=>{module=e.target.value;index=0;resetQuestion();render();};
 $('#search').oninput=e=>{query=e.target.value;index=0;resetQuestion();selectedList=filtered();renderStudyQuestion();};
 renderStudyQuestion();
}
function renderStudyQuestion(){
 if(!selectedList.length){$('#question').innerHTML=`<div class="empty"><h2>${page==='review'?'当前没有到期题目':page==='wrong'?'当前没有待纠正错题':'没有匹配的题目'}</h2><p>${questions.length?'可以切换章节或清空搜索。':'题库正在审校，只有通过独立审校的题目才会在此发布。'}</p>${page==='review'?'<p>复习安排：答对后 1、3、7、14、30 天；答错 10 分钟后再试。</p>':''}</div>`;return;}
 renderQuestion(selectedList[index],index,selectedList.length,false);
}
function renderQuestion(q,position,total,exam){
 const r=record(q);const held=!exam&&q.quality?.examUse==='hold';const ws=!exam?wrongStatus(state(),q):null;const locked=(submitted&&!exam)||held;
 $('#question').innerHTML=`<section class="question-card" aria-labelledby="stem"><div class="question-meta"><span>${q.type==='single'?'单选':'多选'} · ${esc(q.difficulty)}${ws?` · 错题状态：${ws}`:''}</span><span>${position+1} / ${total}</span></div><p class="topic">${esc(q.topic)} <span>${esc(q.id)}</span></p>${!exam&&q.quality?`<p class="version-note">${q.quality.examUse==='eligible'?'可用于自编模拟练习（难度未校准）':q.quality.examUse==='hold'?'待修订：暂停作答与计分，历史保留':'仅供知识学习：不纳入模拟计分'} · ${submitted||held?esc(q.quality.rationale):'详细审计依据提交后查看。'}</p>`:''}<h2 id="stem" tabindex="-1">${esc(q.stem)}</h2><fieldset><legend class="sr-only">${q.type==='single'?'选择一个答案':'选择所有正确答案'}</legend>${Object.entries(q.options).map(([key,text])=>`<label class="option ${answers.includes(key)?'selected':''} ${locked&&!held&&q.answer.includes(key)?'correct':''} ${locked&&answers.includes(key)&&!q.answer.includes(key)?'incorrect':''}"><input type="${q.type==='single'?'radio':'checkbox'}" name="answer" value="${esc(key)}" ${answers.includes(key)?'checked':''} ${locked?'disabled':''}><b>${esc(key)}</b><span>${esc(text)}</span></label>`).join('')}</fieldset><div class="question-actions">${exam?'':`<button id="submit" class="primary" ${locked?'disabled':''}>${held?'待修订':locked?'已提交':'提交答案'}</button>`}<button id="prev" ${position===0?'disabled':''}>上一题</button><button id="next" ${position===total-1?'disabled':''}>下一题</button><button id="favorite" aria-pressed="${!!r.favorite}">${r.favorite?'已收藏':'收藏'}</button></div><p class="keyboard-hint">A–${Object.keys(q.options).at(-1)} 选择 · ${exam?'自动保存':'Enter 提交'} · → 下一题${q.type==='multiple'?' · 多选须全部选对':''}</p></section>${locked&&!held?explanation(q):''}`;
 document.querySelectorAll('input[name="answer"]').forEach(input=>input.onchange=()=>{
   answers=q.type==='single'?[input.value]:[...document.querySelectorAll('input[name="answer"]:checked')].map(i=>i.value);
   if(exam){state().activeExam.answers[q.id]=[...answers];save();updateExamMap();}
   document.querySelectorAll('.option').forEach(o=>o.classList.toggle('selected',o.querySelector('input').checked));
 });
 if(!exam)$('#submit').onclick=()=>{if(!answers.length){toast('请先选择答案');return;}recordAnswer(state(),q,answers,Date.now(),studyMode());submitted=true;save();renderQuestion(q,position,total,false);};
 $('#favorite').onclick=()=>{const item=state().records[q.id]||{attempts:[],streak:0};item.favorite=!item.favorite;state().records[q.id]=item;save();$('#favorite').textContent=item.favorite?'已收藏':'收藏';$('#favorite').setAttribute('aria-pressed',String(item.favorite));};
 const move=delta=>{resetQuestion();if(exam){state().activeExam.index+=delta;save();renderExam();}else{index+=delta;renderStudyQuestion();}$('#stem')?.focus();};
 $('#prev').onclick=()=>move(-1);$('#next').onclick=()=>move(1);
 document.querySelectorAll('.error-type').forEach(b=>b.onclick=()=>{const item=state().records[q.id]||{attempts:[],streak:0};item.errorType=b.dataset.errorType;state().records[q.id]=item;save();renderQuestion(q,position,total,false);});
 const aiBtn=$('#ai-ask');if(aiBtn)aiBtn.onclick=()=>askAI(q,answers);
}
function explanation(q){return `<section class="explanation"><h2>${isCorrect(answers,q.answer)?'回答正确':'再理解一次'}</h2><p class="answer-line">正确答案：<strong>${esc(q.answer.join('、'))}</strong></p><p>${esc(q.explanation)}</p><details><summary>干扰项为什么不对</summary>${Object.entries(q.distractors).map(([key,text])=>`<p><b>${esc(key)}：</b>${esc(text)}</p>`).join('')}</details><div class="sources"><h3>官方依据</h3>${q.sources.map(s=>`<div><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} · ${esc(s.section)}</a><p>${esc(s.fact)}</p><small>核实 ${esc(s.verifiedAt)} · ${esc(s.version)}</small></div>`).join('')}</div>${q.review?.recheck?`<p class="recheck-note"><b>原400题复核 · ${esc(q.review.recheck.action)}：</b>${esc(q.review.recheck.finding)}</p>`:''}${!isCorrect(answers,q.answer)?`<div class="error-types"><b>记录错因（可选，可修改）：</b>${(()=>{const current=record(q).errorType||'';return ERROR_TYPES.map(([k,label])=>`<button class="error-type ${current===k?'active':''}" data-error-type="${k}">${label}</button>`).join('');})()}</div>`:''}<section class="ai-panel"><div class="ai-head"><b>AI 讲解</b><small>结合题目、标准答案与官方来源生成；不修改原始答案</small><button id="ai-ask">生成 AI 讲解</button></div><div id="ai-output" class="ai-output"></div></section><small class="muted">审校：${esc(q.review?.reviewer||'待核')} · 题目 ${esc(q.id)}</small></section>`;}
function renderExam(){
 const exam=state().activeExam;
 if(exam){
   if(exam.deadline<=Date.now()){finishExam(true);return;}
   const q=exam.snapshot?.find(q=>q.id===exam.ids[exam.index])||byId.get(exam.ids[exam.index]);if(!q){$('#content').innerHTML='<div class="empty">当前题库缺少试卷题目，请恢复创建试卷时的题库版本。请先导出备份保留本次考试。</div>';return;}
   answers=exam.answers[q.id]||[];
   $('#content').innerHTML=`<div class="exam-bar"><span>剩余 <strong id="timer"></strong></span><button id="finish" class="primary">交卷</button></div><div id="question"></div><section class="exam-map"><h2>答题卡</h2><div id="exam-map-buttons"></div><p class="muted">切换页面或关闭窗口不会暂停计时；超过截止时间后，下次打开自动交卷。</p></section>`;
   renderQuestion(q,exam.index,exam.ids.length,true);updateExamMap();tick();
   $('#finish').onclick=()=>{const missing=exam.ids.filter(id=>!exam.answers[id]?.length).length;if(confirm(`还有 ${missing} 题未答。确认交卷？`))finishExam(false);};return;
 }
 if(examResult){renderResult(examResult);return;}
 $('#content').innerHTML=`<section class="exam-intro"><h2>15 题场景短练</h2><p>25 分钟 · 10 单选 + 5 多选。从核心池抽取原创题，练习场景判断和作答节奏。</p><p>本地训练计分：单选 6 分、多选 8 分，满分 100，漏选或错选不得分。计分用于本地练习。</p><button id="start-short" class="primary">开始 25 分钟短练</button></section><section class="exam-intro"><h2>60 题完整练习</h2><div class="exam-facts"><div><strong>90</strong><span>分钟</span></div><div><strong>40 + 20</strong><span>单选 / 多选</span></div><div><strong>100</strong><span>满分</span></div></div><p>${scoringText()}</p><p>多选错选、漏选均不得分。考试中不显示答案和解析；交卷后逐题复盘。仅从核心可组卷题中抽取，包含已逐题复核的原 400 题与此前课程核对的 100 题；不是官方模拟卷复刻。</p><p>倒计时与已选答案自动保存，刷新或重启后可继续。时间到自动交卷。</p><button id="start-exam" class="primary">开始 90 分钟模拟</button></section><section class="history"><h2>历史模拟</h2>${state().sessions.length?state().sessions.slice().reverse().map(s=>`<button class="history-row" data-result="${esc(s.id)}"><span>${new Date(s.finishedAt).toLocaleString('zh-CN')} · ${s.mode==='short'?'15题短练':'60题完整练习'}</span><b>${s.points} / 100 分</b><span>查看复盘 →</span></button>`).join(''):'<p class="muted">完成第一场考试后，成绩会保存在这里。</p>'}</section>`;
 const start=mode=>{try{state().activeExam=makeExam(questions.filter(q=>rounds[0]?.coreIds.includes(q.id)),Date.now(),Math.random,mode);state().activeExam.bankVersion=manifest.version;save();renderExam();}catch(e){toast(e.message);}};
 $('#start-exam').onclick=()=>start('full');$('#start-short').onclick=()=>start('short');
 document.querySelectorAll('[data-result]').forEach(b=>b.onclick=()=>{examResult=state().sessions.find(s=>s.id===b.dataset.result);renderResult(examResult);});
}
function updateExamMap(){const exam=state().activeExam;if(!exam||!$('#exam-map-buttons'))return;$('#exam-map-buttons').innerHTML=exam.ids.map((id,i)=>`<button class="${exam.answers[id]?.length?'answered':''} ${i===exam.index?'current':''}" data-jump="${i}" aria-label="第 ${i+1} 题${exam.answers[id]?.length?'，已答':'，未答'}">${i+1}</button>`).join('');document.querySelectorAll('[data-jump]').forEach(b=>b.onclick=()=>{exam.index=Number(b.dataset.jump);save();renderExam();$('#stem')?.focus();});}
function tick(){const exam=state()?.activeExam;if(!exam)return;const remaining=Math.max(0,Math.ceil((exam.deadline-Date.now())/1000));if($('#timer'))$('#timer').textContent=`${Math.floor(remaining/60).toString().padStart(2,'0')}:${(remaining%60).toString().padStart(2,'0')}`;if(remaining===0)finishExam(true);}
function finishExam(auto){const exam=state().activeExam;if(!exam)return;try{const result=gradeExam(exam,byId);result.autoSubmitted=auto;for(const row of result.results)recordAnswer(state(),row.question||byId.get(row.id),row.answers,Date.now(),'exam');state().sessions.push(result);state().activeExam=null;examResult=result;save();if(page==='exam')renderResult(result);toast(auto?'时间已到，试卷已自动提交':'模拟考试已保存');}catch(e){toast(e.message);}}
function renderResult(result){
 const stats=examModuleStats(result,byId);const modName=id=>MODULES.find(m=>m[0]===id)?.[1]||id;
 $('#content').innerHTML=`<section class="result-summary"><h2>${result.points>=70?'达到 70 分参考线':'继续查漏补缺'}</h2><p class="score">${result.points}<small> / 100 分</small></p><p class="muted">自编练习成绩不能预测正式考试成绩。${result.bankVersion!==manifest.version?'这场历史试卷使用旧题库快照，可能含已降级题，分数仅保留作历史记录。':''}</p><p>答对 ${result.correct} / ${result.total} 题${result.autoSubmitted?' · 超时自动提交':''}</p><p class="muted">${result.mode==='short'?'本地短练：单选6分、多选8分；70分为练习参考线。':scoringText()}</p><button id="back-exams">返回模拟考试</button></section>${stats.modules.length?`<section class="reading-block"><h2>模块正误统计</h2>${stats.modules.map(m=>`<div class="progress-row"><div><b>${esc(modName(m.module))}</b><span>${m.correct} / ${m.total}</span></div><progress value="${m.correct}" max="${m.total}">${m.correct}</progress></div>`).join('')}${stats.missing?`<p class="muted">${stats.missing} 题在当前题库中缺失，未计入统计。</p>`:''}</section>`:''}<h2>逐题复盘</h2>${result.results.map((r,i)=>{const q=r.question||byId.get(r.id);return q?`<details class="result-row"><summary><span class="${r.correct?'success':'error'}">${r.correct?'正确':'错误'}</span> ${i+1}. ${esc(q.stem)}</summary><p>你的答案：${esc(r.answers.join('、')||'未作答')}；正确答案：${esc(q.answer.join('、'))}</p><ul>${Object.entries(q.options).map(([k,v])=>`<li><b>${esc(k)}</b> ${esc(v)}</li>`).join('')}</ul><p>${esc(q.explanation)}</p>${q.sources.map(s=>`<p><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)} · ${esc(s.section)}</a></p>`).join('')}</details>`:`<p>${esc(r.id)}：该题在当前题库中不可用，历史答案保留。</p>`;}).join('')}`;$('#back-exams').onclick=()=>{examResult=null;renderExam();};
}
function renderProgress(){
 const activeQuestions=questions.filter(q=>q.quality?.examUse!=='hold');const learned=activeQuestions.filter(q=>record(q).attempts.length),correct=learned.filter(q=>record(q).lastCorrect),attempts=Object.values(state().records).flatMap(r=>r.attempts);
 $('#content').innerHTML=`<div class="metrics"><div><strong>${learned.length}<small> / ${activeQuestions.length}</small></strong><span>已学习题目</span></div><div><strong>${learned.length?Math.round(correct.length/learned.length*100):0}%</strong><span>最近作答正确率</span></div><div><strong>${attempts.length}</strong><span>累计作答次数</span></div></div><section class="progress-table"><h2>章节覆盖</h2>${MODULES.map(([id,name])=>{const qs=activeQuestions.filter(q=>q.module===id),done=qs.filter(q=>record(q).attempts.length).length;return `<div class="progress-row"><div><b>${name}</b><span>${done} / ${qs.length}</span></div><progress value="${done}" max="${Math.max(1,qs.length)}">${done}</progress></div>`;}).join('')}</section><section class="reading-block"><h2>复习节奏</h2><p>答对后间隔 1、3、7、14、30 天再复习；答错后 10 分钟再回忆。该安排是本软件的学习策略，不是腾讯官方考试规则。</p><p>错题本显示最近一次答错的题。答对后退出待纠正列表，完整历史仍保留在本机。题目内容版本变化后，旧作答不计入新版掌握；待修订题暂停学习与组卷。</p><p>考试目标日期：<label><input id="target-date" type="date" value="${esc(state().settings?.targetDate||'')}"></label></p></section>`;
 $('#target-date').onchange=e=>{state().settings={...state().settings,targetDate:e.target.value};save();};
}
function download(filename,data){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function renderBackup(){
 $('#content').innerHTML=`<section class="reading-block"><h2>保留你的学习历史</h2><p>答题、收藏、复习时间和模拟试卷会自动写入 <code>local-data/progress.json</code>。题库升级按稳定题目 ID 关联，不会清空已有记录。浏览器还保留一份应急副本。</p><div class="backup-actions"><button id="export" class="primary">导出学习备份</button><label class="file-button" for="import-file">导入并合并备份</label><input id="import-file" class="sr-only" type="file" accept="application/json,.json"><button id="recover">恢复浏览器应急副本</button></div><p class="muted">导入会合并作答历史和收藏，重复记录去重；当前进行中的试卷优先保留。导入前自动下载当前记录快照。恢复应急副本时，同一场未交卷考试采用应急答案；会同时下载磁盘快照与应急原件。</p></section><section class="reading-block"><h2>题库与来源</h2><p>发布版本 ${esc(manifest.version)}；保留 ${questions.length} 题，分级结果见<a href="/evidence.html" target="_blank">题库版本与质量分级</a>。待修订题不进入普通学习与新组卷；历史记录保留。</p>${(manifest.notes||[]).map(n=>`<p>${esc(n)}</p>`).join('')}<button id="export-bank">导出当前题库</button><p>仅本机访问；学习时不访问云端。打开官方来源链接需要联网。</p></section>`;
 $('#export').onclick=()=>download('FDE-学习备份-'+new Date().toISOString().slice(0,10)+'.json',state());
 $('#export-bank').onclick=()=>download('FDE-原创模拟题-'+manifest.version+'.json',{manifest,questions});
 const merge=value=>{validateBackup(value);download('FDE-导入前快照-'+Date.now()+'.json',state());store.state=mergeBackup(state(),value);save();toast('已合并学习备份');};
 $('#import-file').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>20_000_000)throw new Error('文件超过20MB，请检查备份');merge(JSON.parse(await file.text()));}catch(error){toast(error.message);}finally{e.target.value='';}};
 $('#recover').onclick=async()=>{try{const backup=store.recovery();if(!backup)throw new Error('没有可用的浏览器副本');validateBackup(backup);download('FDE-恢复前磁盘快照-'+Date.now()+'.json',state());download('FDE-浏览器应急原件-'+Date.now()+'.json',backup);store.state=mergeBackup(state(),backup,{recoverActive:true});await store.save();if(!store.failed){store.clearRecovery();render();toast('已恢复浏览器应急副本');}}catch(e){toast(e.message);}};
}
// AI 讲解（FR-005）：调用本地服务，任何失败都不阻塞刷题
function renderAIOutput(data){
 const ex=data.explanation||{};
 const para=(title,value)=>value?`<h4>${title}</h4><p>${esc(String(value))}</p>`:'';
 const list=(title,value)=>Array.isArray(value)&&value.length?`<h4>${title}</h4><ul>${value.map(i=>`<li>${esc(String(i))}</li>`).join('')}</ul>`:'';
 return `${data.cached?'<small class="muted">本次结果来自缓存</small>':''}
  ${ex.agrees_with_official===false?'<p class="ai-conflict">待复核：AI 讲解与题目标准答案存在分歧。请以标准答案和官方来源为准。</p>':''}
  ${para('正确答案解释',ex.correct_explanation)}
  ${para('你的答案为什么不符合标准答案',ex.why_user_wrong)}
  ${list('核心知识点',ex.key_points)}
  ${list('易混淆概念',ex.confusable)}
  ${list('建议复习',ex.review_suggestions)}
  ${list('争议与不确定点',ex.uncertain_points)}
  <small class="muted">模型 ${esc(data.model||'')} · 提示词 ${esc(data.prompt_version||'')} · ${data.cached?'缓存于':'生成于'} ${new Date(data.created_at||Date.now()).toLocaleString('zh-CN')}</small>`;
}
async function askAI(q,userAnswers){
 const out=$('#ai-output');if(!out)return;
 const btn=$('#ai-ask');btn.disabled=true;
 out.innerHTML='<p class="muted">AI 讲解生成中，请稍候…</p>';
 try{
  const res=await fetch('/api/ai/explain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({questionId:q.id,answers:userAnswers})});
  const data=await res.json();
  if(!res.ok)throw new Error(data.error||'AI 讲解失败');
  out.innerHTML=renderAIOutput(data);
 }catch(error){out.innerHTML='';toast('AI 讲解不可用：'+error.message+'（不影响继续刷题）');}
 finally{btn.disabled=false;}
}
// 今日任务页动作（FR-006）
const todayActions={
 startNew(ids){if(!ids.length){toast('今日新题目标已完成，可在章节学习选择未做题继续');return;}todayNewIds=ids;randomIds=null;pool='today';module='all';query='';page='study';index=0;resetQuestion();render();},
 startReview(){page='review';index=0;resetQuestion();render();},
 startModule(id){module=id;pool='core';query='';page='study';index=0;resetQuestion();render();},
 startExam(){page='exam';index=0;resetQuestion();render();},
 openLastExam(){const s=[...state().sessions].at(-1);if(!s)return;examResult=s;page='exam';render();}
};
store.onStatus=(message,error=false)=>{const el=$('#save-status');if(el){el.textContent=message;el.classList.toggle('error',error);}};
document.addEventListener('keydown',e=>{
 const active=document.activeElement;
 if(active?.tagName==='TEXTAREA'||active?.tagName==='SELECT'||active?.tagName==='INPUT'&&!['radio','checkbox'].includes(active.type)||e.ctrlKey||e.metaKey||e.altKey)return;
 const input=document.querySelector(`input[name="answer"][value="${e.key.toUpperCase()}"]`);if(input&&!input.disabled){input.click();e.preventDefault();}
 if(e.key==='Enter'&&active?.tagName!=='BUTTON'&&$('#submit')&&!$('#submit').disabled){$('#submit').click();e.preventDefault();}
 if(e.key==='ArrowRight'&&$('#next')&&!$('#next').disabled){$('#next').click();e.preventDefault();}
});
window.addEventListener('beforeunload',e=>{if(store.failed||store.pending){e.preventDefault();e.returnValue='';}});
async function init(){try{
 const responses=await Promise.all([fetch('/data/questions.json'),fetch('/data/manifest.json'),fetch('/data/quality.json'),fetch('/data/rounds.json')]);
 rounds=(await responses[3].json()).rounds;questions=await responses[0].json();manifest=await responses[1].json();const quality=await responses[2].json();const audit=new Map(quality.questions.map(q=>[q.id,q]));questions=questions.map(q=>({...q,quality:audit.get(q.id)||{examUse:'hold',rationale:'缺少本轮质量记录'}}));questions=questions.filter(q=>q.review?.status==='approved');byId=new Map(questions.map(q=>[q.id,q]));
 await store.load();if(state().activeExam)page='exam';render();tick();setInterval(tick,1000);
 }catch(error){$('#app').innerHTML=`<main class="fatal"><h1>暂时无法加载本地学习软件</h1><p>${esc(error.message)}</p><p>请从“启动备考.command”启动；如果是记录文件损坏，请先备份 local-data 目录。</p><button onclick="location.reload()">重试</button></main>`;}}
init();
