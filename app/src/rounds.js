const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderRounds(target,rounds,{study,practice,focus,reviewOriginal}){
 const r=rounds[0];if(!r){target.innerHTML='<p>尚无题库版本记录。</p>';return;}
 target.innerHTML=`<section class="round-hero"><div><span class="round-kicker">VERSION ${esc(r.version)} · ${esc(r.date)}</span><h2>从知识理解走向场景判断</h2><p>依据公开产品资料编写的原创训练题，覆盖业务目标、知识治理、执行边界与验证闭环。</p></div></section>
 <div class="round-stats"><span><b>${r.coreIds.length}</b> 核心题</span><span><b>${r.revisedIds.length}</b> 本轮重写</span><span><b>${r.revisedOriginalIds.length}</b> 原题修订</span><span><b>${r.focusedPracticeIds.length}</b> 原创专项</span></div>
 <section class="reading-block"><h2>练习方式</h2><p>25 分钟短练包含 10 道单选与 5 道多选；90 分钟完整练习包含 40 道单选与 20 道多选。试卷均从核心原创题库抽取。</p><p class="round-limit">题库由 AI 编写和复核，未验证与真实考试的难度等值，不保证命中率。短练和完整练习均采用本地计分，成绩仅供学习参考。</p><button id="round-practice">进入模拟练习</button></section>
 <section class="reading-block original-review"><h2>原 400 题已逐题复核</h2><p>本次检查了原 400 题的题干、选项、答案、解析和干扰项理由：<strong>118 题修订，282 题保留</strong>。修订涵盖 46 道题干、31 道题的选项及干扰项理由、95 道解析，三类有重叠。</p><p>重点补足适用条件、把概念题改为场景判断、改善干扰项，并写清操作成功与业务完成、版本回退与数据恢复等边界。每道原题提交后可查看本次复核理由。</p><button id="round-original" class="primary">练习原题修订专项 · ${r.revisedOriginalIds.length} 题</button></section>
 <section class="reading-block"><h2>500 题怎样组成</h2><p>原 400 道已全部复核（118 修订、282 保留），另有此前重写的 100 道原仅学习题。重写题包含 60 道单选、40 道五选项多选，其中 20 道为四个正确选项。其余 458 道保留学习用途，42 道继续待修订。</p><p>100 道重写题依据课程第 3、4 章逐题核对，属于同一助手编写与复读，未经过独立审校。原 400 道本次也由同一助手复核；重点官方资料重新读取，其余沿用已有来源证据，未声称全部历史来源都再次联网验证。</p><p><a href="https://cloud.tencent.com/edu/learning/course-4742-84529-84539" target="_blank" rel="noopener">课程第 3 章：方案与搭建</a> · <a href="https://cloud.tencent.com/edu/learning/course-4742-84530-84545" target="_blank" rel="noopener">课程第 4 章：评测与优化</a></p></section>
 <section class="reading-block round-practice-list"><h2>15 道原创专项练习</h2><p>围绕知识版本与审核、评测样本覆盖、数据授权进行专项训练。以下按钮进入本地原创题，答案与解析在提交后显示。</p><button id="round-focus" class="primary">开始原创专项 · ${r.focusedPracticeIds.length} 题</button><div class="round-links">${r.focusedPracticeIds.map(id=>`<button data-round-question="${esc(id)}">练习 ${esc(id)}</button>`).join('')}</div></section>
 <section class="reading-block"><h2>版本与学习记录</h2><p>题目保留稳定 ID，并按内容哈希区分修订版本。旧作答不计入新版掌握，历史考试按创建时的题目快照计分。学习记录保存在本机，可在数据备份页面导出和合并。</p></section>`;
 target.querySelector('#round-practice').onclick=practice;
 target.querySelector('#round-focus').onclick=focus;
 target.querySelector('#round-original').onclick=reviewOriginal;
 target.querySelectorAll('[data-round-question]').forEach(b=>b.onclick=()=>study(b.dataset.roundQuestion));
}
