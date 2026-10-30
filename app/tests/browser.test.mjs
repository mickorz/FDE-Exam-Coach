import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
const runtime=process.env.PLAYWRIGHT_MODULE||'playwright';
const {chromium}=await import(runtime);
const root=await fs.realpath(path.resolve(fileURLToPath(new URL('..',import.meta.url))));
const out=path.resolve(process.env.FDE_QA_OUT||path.join(root,'.test-artifacts'));await fs.mkdir(out,{recursive:true});
const temp=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'fde-e2e-')));
const port=Number(process.env.FDE_TEST_PORT||8877);
assert(Number.isInteger(port)&&port>0&&port<=65535&&port!==8765,'FDE_TEST_PORT 必须是独立测试端口，不能使用日常学习端口 8765');
const url=`http://127.0.0.1:${port}`;
let proc;
async function start(){
 proc=spawn('python3',['server.py','--port',String(port),'--data-dir',temp],{cwd:root,stdio:'ignore'});
 for(let i=0;i<50;i++){
  if(proc.exitCode!==null)throw new Error('隔离测试服务未启动；请检查 FDE_TEST_PORT 是否被占用');
  let health;
  try{const response=await fetch(url+'/api/health');if(response.ok)health=await response.json();}catch{}
  if(health){assert.equal(health.root,root,'测试端口属于其他项目');assert.equal(health.dataPath,path.join(temp,'progress.json'),'测试端口未使用本次隔离数据目录');return;}
  await new Promise(r=>setTimeout(r,100));
 }
 throw new Error('隔离测试服务未启动');
}
const results=[];
let browser;
try{
await start();
browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE_PATH?{executablePath:process.env.CHROME_EXECUTABLE_PATH}:{}),args:['--no-first-run','--no-default-browser-check']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];const requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
await page.goto(url);await page.locator('#stem').waitFor();
const bank=await (await fetch(url+'/data/questions.json')).json();assert(bank.length>0);
const quality=await (await fetch(url+'/data/quality.json')).json();const qualityById=new Map(quality.questions.map(q=>[q.id,q]));const available=bank.filter(q=>qualityById.get(q.id).examUse!=='hold');const first=available[0];assert((await page.locator('.question-card .version-note').textContent()).includes('提交后查看'));assert(!(await page.locator('.question-card .version-note').textContent()).includes(qualityById.get(first.id).rationale));results.push('答题前不泄露审计理由中的正确答案');
await page.locator(`input[name=answer][value=${first.answer[0]}]`).check();
await page.locator('#submit').click();await page.locator('.explanation').waitFor();
await page.locator('#favorite').click();await page.getByText('已保存到本机',{exact:true}).waitFor();
await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
await page.reload();await page.locator('#stem').waitFor();
await page.locator('[data-page=favorites]').click();assert.equal(await page.locator('#favorite').getAttribute('aria-pressed'),'true');
results.push('答题/解析/收藏/刷新持久化通过');
await page.locator('#search').fill('不存在的检索词QA');assert(await page.getByText('没有匹配的题目',{exact:true}).isVisible());
await page.locator('#search').fill(first.id);await page.locator('#stem').waitFor();results.push('搜索及空结果通过');
await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);results.push('390px移动端无横向溢出');
await page.setViewportSize({width:1440,height:1000});
const wrongQuestion=available[1],wrongChoice=Object.keys(wrongQuestion.options).find(k=>!wrongQuestion.answer.includes(k));
await page.locator('[data-page=study]').click();await page.locator('#search').fill(wrongQuestion.id);await page.locator(`input[name=answer][value=${wrongChoice}]`).check();await page.locator('#submit').click();await page.getByText('已保存到本机',{exact:true}).waitFor();await page.locator('[data-page=wrong]').click();await page.locator('#search').fill(wrongQuestion.id);assert((await page.locator('#stem').textContent()).includes(wrongQuestion.stem));await page.locator('[data-page=progress]').click();assert((await page.locator('.metrics').textContent()).includes('累计作答次数'));results.push('真实答错进入错题本、学习进度计数通过');
await page.locator('[data-page=backup]').click();
const dlPromise=page.waitForEvent('download');await page.locator('#export').click();const dl=await dlPromise;const backup=path.join(temp,'backup.json');await dl.saveAs(backup);
const exported=JSON.parse(await fs.readFile(backup,'utf8'));assert(exported.records[first.id].favorite);
const before=exported.records[first.id].attempts.length;const held=bank.find(q=>qualityById.get(q.id).examUse==='hold');assert(held);exported.records[held.id]={attempts:[],favorite:true};await fs.writeFile(backup,JSON.stringify(exported));
const preImport=page.waitForEvent('download');await page.locator('#import-file').setInputFiles(backup);await (await preImport).saveAs(path.join(temp,'pre-import.json'));await page.getByText('已合并学习备份',{exact:true}).waitFor();
await page.getByText('已保存到本机',{exact:true}).waitFor();
const merged=await (await fetch(url+'/api/state')).json();assert.equal(merged.records[first.id].attempts.length,before);results.push('实际导出/导入合并/去重通过');
const twicePromise=page.waitForEvent('download');await page.locator('#import-file').setInputFiles(backup);await (await twicePromise).saveAs(path.join(temp,'before-second-import.json'));await page.getByText('已保存到本机',{exact:true}).waitFor();const twice=await (await fetch(url+'/api/state')).json();assert.equal(twice.records[first.id].attempts.length,before);assert.equal(twice.records[wrongQuestion.id].attempts.length,1);results.push('同一备份实际重复导入两次，历史未重复');
await page.locator('[data-page=favorites]').click();await page.locator('#search').fill(held.id);assert(await page.locator('#submit').isDisabled());assert.equal(await page.locator('input[name=answer]:not([disabled])').count(),0);await page.locator('[data-page=study]').click();await page.locator('#search').fill(held.id);assert(await page.getByText('没有匹配的题目',{exact:true}).isVisible());await page.locator('[data-page=backup]').click();results.push('待修订题保留历史收藏但禁答，普通学习不显示');
const malformed=path.join(temp,'bad.json');await fs.writeFile(malformed,'{"schemaVersion":2}');await page.locator('#import-file').setInputFiles(malformed);await page.getByText('不是受支持的学习备份',{exact:true}).waitFor();results.push('损坏备份拒绝通过');
await page.locator('[data-page=exam]').click();await page.locator('#start-exam').click();await page.locator('#timer').waitFor();
let state=await (await fetch(url+'/api/state')).json();await page.waitForTimeout(150);state=await (await fetch(url+'/api/state')).json();
assert.equal(state.activeExam.ids.length,60);assert(state.activeExam.snapshot.every(q=>q.quality.examUse==='eligible'));results.push('新组卷只使用深度审计eligible题，排除学习题和待核题');assert.equal(state.activeExam.snapshot.filter(q=>q.type==='single').length,40);
const beforeFinished=structuredClone(state);
const corruptSnapshot=path.join(temp,'bad-snapshot.json');await fs.writeFile(corruptSnapshot,JSON.stringify({...state,activeExam:{...state.activeExam,snapshot:{broken:true}}}));
await page.locator('[data-page=backup]').click();await page.locator('#import-file').setInputFiles(corruptSnapshot);await page.getByText('备份题目快照无效',{exact:true}).waitFor();await page.locator('[data-page=exam]').click();
results.push('损坏考试快照在写盘前被拒绝');
const examFirst=state.activeExam.snapshot[0];
const recoveryState=structuredClone(state);recoveryState.activeExam.answers[examFirst.id]=examFirst.answer;await page.evaluate(value=>localStorage.setItem('fde-study-recovery-v1',JSON.stringify(value)),recoveryState);await page.reload();await page.locator('#recovery-link').waitFor();await page.locator('#recovery-link').click();await page.locator('#recover').click();await page.getByText('已恢复浏览器应急副本',{exact:true}).waitFor();await page.locator('[data-page=exam]').click();assert(await page.locator(`input[name=answer][value=${examFirst.answer[0]}]`).isChecked());results.push('启动识别隔离应急副本、同场考试答案实际恢复通过');
for(const answer of examFirst.answer)await page.locator(`input[name=answer][value=${answer}]`).check();
await page.getByText('已保存到本机',{exact:true}).waitFor();
assert.equal(await page.locator('.explanation').count(),0);
await page.locator('[data-page=study]').click();assert(await page.locator('#timer').isVisible());
await page.reload();await page.locator('#timer').waitFor();assert(await page.locator(`input[name=answer][value=${examFirst.answer[0]}]`).isChecked());
results.push('40+20组卷/隐藏答案/防误入练习/刷新续答通过');
await page.screenshot({path:path.join(out,'exam.png'),fullPage:true});
// Controlled clock expiry in isolated test storage, then a real server restart.
proc.kill('SIGTERM');await new Promise(r=>proc.once('exit',r));
state=JSON.parse(await fs.readFile(path.join(temp,'progress.json'),'utf8'));state.activeExam.deadline=Date.now()-1;await fs.writeFile(path.join(temp,'progress.json'),JSON.stringify(state));
await start();await page.reload();await page.getByText('超时自动提交',{exact:false}).waitFor();await page.getByText('已保存到本机',{exact:true}).waitFor();
const finished=await (await fetch(url+'/api/state')).json();assert.equal(finished.activeExam,null);assert.equal(finished.sessions.length,1);assert.equal(finished.sessions[0].points,1.5);
results.push('真实服务重启后自动交卷/1.5分计分/历史保存通过');
assert(finished.records[first.id].favorite);assert(finished.records[wrongQuestion.id].attempts.length>=1);assert(finished.records[wrongQuestion.id].attempts[0].correct===false);
await page.locator('[data-page=wrong]').click();await page.locator('#search').fill(wrongQuestion.id);if(!finished.records[wrongQuestion.id].lastCorrect)assert((await page.locator('#stem').textContent()).includes(wrongQuestion.stem));else assert(await page.getByText('没有匹配的题目',{exact:true}).isVisible());await page.locator('[data-page=favorites]').click();await page.locator('#search').fill(first.id);assert.equal(await page.locator('#favorite').getAttribute('aria-pressed'),'true');await page.locator('[data-page=progress]').click();const afterProgress=await page.locator('.metrics').textContent();assert(afterProgress.includes('62'));results.push('真实进程重启后错题/收藏/累计进度62次均保留');
await page.locator('[data-page=backup]').click();const oldExam=path.join(temp,'old-exam.json');await fs.writeFile(oldExam,JSON.stringify(beforeFinished));const oldImport=page.waitForEvent('download');await page.locator('#import-file').setInputFiles(oldExam);await (await oldImport).saveAs(path.join(temp,'before-old-import.json'));await page.getByText('已保存到本机',{exact:true}).waitFor();const afterOld=await (await fetch(url+'/api/state')).json();assert.equal(afterOld.activeExam,null);assert.equal(afterOld.sessions.length,1);assert.equal(afterOld.records[examFirst.id].attempts.length,finished.records[examFirst.id].attempts.length);results.push('交卷前旧备份合并不会复活或重复计分');
const forbidden=await fetch(url+'/api/state',{method:'PUT',headers:{'Content-Type':'application/json','Origin':'https://invalid.example','X-FDE-Client':'offline-study'},body:JSON.stringify(finished)});assert.equal(forbidden.status,403);
const conflict=await fetch(url+'/api/state',{method:'PUT',headers:{'Content-Type':'application/json','X-FDE-Client':'offline-study'},body:JSON.stringify({...finished,revision:0})});assert.equal(conflict.status,409);results.push('跨站写入阻断/并发旧版本409保护通过');
assert.deepEqual(errors,[]);results.push('浏览器无未捕获JS异常');assert(requests.every(u=>u.startsWith(url+'/')));results.push('所有学习路径请求仅到本机，无外部API请求');
await fs.writeFile(path.join(out,'browser-results.json'),JSON.stringify({at:new Date().toISOString(),bankSize:bank.length,qualitySha256:createHash('sha256').update(await fs.readFile(path.join(root,'data/quality.json'))).digest('hex'),bankSha256:createHash('sha256').update(await fs.readFile(path.join(root,'data/questions.json'))).digest('hex'),results},null,2));console.log(JSON.stringify({passed:results.length,results,artifacts:out},null,2));
}finally{if(browser)await browser.close();proc?.kill('SIGTERM');}
