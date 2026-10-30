import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=await fs.realpath(path.resolve(fileURLToPath(new URL('..',import.meta.url))));
const out=path.resolve(process.env.FDE_QA_OUT||path.join(root,'.test-artifacts'));await fs.mkdir(out,{recursive:true});
const temp=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'fde-round1-')));
const port=Number(process.env.FDE_TEST_PORT||8881);
assert(Number.isInteger(port)&&port>0&&port<=65535&&port!==8765,'FDE_TEST_PORT 必须是独立测试端口，不能使用日常学习端口 8765');
const url=`http://127.0.0.1:${port}`;
const proc=spawn('python3',['server.py','--port',String(port),'--data-dir',temp],{cwd:root,stdio:'ignore'});
let browser;const checks=[];const errors=[];
try{
 let ready=false;
 for(let i=0;i<50;i++){
  if(proc.exitCode!==null)throw new Error('隔离测试服务未启动；请检查 FDE_TEST_PORT 是否被占用');
  let health;
  try{const response=await fetch(url+'/api/health');if(response.ok)health=await response.json();}catch{}
  if(health){assert.equal(health.root,root,'测试端口属于其他项目');assert.equal(health.dataPath,path.join(temp,'progress.json'),'测试端口未使用本次隔离数据目录');ready=true;break;}
  await new Promise(r=>setTimeout(r,100));
 }
 assert(ready,'隔离测试服务未启动');
 browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE_PATH?{executablePath:process.env.CHROME_EXECUTABLE_PATH}:{}),args:['--no-first-run','--no-default-browser-check']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(url);await page.locator('#stem').waitFor();assert((await page.title()).includes('FDE'));assert.equal(new URL(page.url()).origin,url);assert.equal(await page.locator('#pool').inputValue(),'core');assert((await page.locator('.question-meta').textContent()).includes('/ 500'));checks.push('页面身份正确，首屏非空，默认核心500题');
 await page.locator('#pool').selectOption('original');assert((await page.locator('.question-meta').textContent()).includes('/ 400'));
 await page.locator('#pool').selectOption('original-revised');assert((await page.locator('.question-meta').textContent()).includes('/ 118'));
 await page.locator('#search').fill('FDE-M3-166');assert((await page.locator('#stem').textContent()).includes('反思轮数设为0'));assert.equal(await page.locator('.recheck-note').count(),0);
 await page.locator('input[value=C]').check();await page.locator('#submit').click();assert(await page.getByRole('heading',{name:'回答正确',exact:true}).isVisible());assert((await page.locator('.recheck-note').textContent()).includes('修订'));await page.getByText('已保存到本机',{exact:true}).waitFor();
 await page.screenshot({path:path.join(out,'原400题修订专项.png'),fullPage:false});
 await page.locator('[data-page=rounds]').click();assert(await page.locator('.original-review').isVisible());await page.locator('#round-original').click();assert.equal(await page.locator('#pool').inputValue(),'original-revised');assert((await page.locator('.question-meta').textContent()).includes('/ 118'));checks.push('原400/修订118筛选、修订内容实际作答与提交后复核理由、校准页专项入口');
 await page.locator('#pool').selectOption('revised');assert((await page.locator('.question-meta').textContent()).includes('/ 100'));
 const bank=await (await fetch(url+'/data/questions.json')).json();const round=(await (await fetch(url+'/data/rounds.json')).json()).rounds[0];
 const q=bank.find(q=>round.revisedIds.includes(q.id)&&q.answer.includes('E')&&q.answer.length===4);
 await page.locator('#search').fill(q.id);assert.equal(await page.locator('input[name=answer]').count(),5);
 await page.locator('#stem').focus();await page.keyboard.press('e');assert(await page.locator('input[value=E]').isChecked());for(const k of q.answer)await page.locator(`input[name=answer][value=${k}]`).check();
 await page.locator('#submit').click();assert(await page.getByRole('heading',{name:'回答正确',exact:true}).isVisible());await page.getByText('已保存到本机',{exact:true}).waitFor();
 await page.screenshot({path:path.join(out,'五选项练习.png'),fullPage:false});checks.push('本轮100题筛选、E快捷键、四答案提交与解析');
 await page.locator('[data-page=rounds]').click();assert.equal(await page.locator('.round-practice-list [data-round-question]').count(),15);assert.equal(await page.locator('.round-score,.round-mistakes,.round-observations').count(),0);
 const beforeFocus=await (await fetch(url+'/api/state')).json();
 await page.locator('#round-focus').click();assert.equal(await page.locator('#pool').inputValue(),'weak');assert((await page.locator('.question-meta').textContent()).includes('/ 15'));
 const focused=[];for(let i=0;i<15;i++){focused.push((await page.locator('.topic').textContent()).match(/FDE-M\d-\d+/)[0]);if(i<14)await page.locator('#next').click();}
 assert.deepEqual(focused.sort(),[...round.focusedPracticeIds].sort());
 assert.deepEqual((await (await fetch(url+'/api/state')).json()).records,beforeFocus.records);checks.push('15道原创专项映射精确匹配，浏览训练说明不新增作答历史');
 await page.locator('[data-page=rounds]').click();await page.screenshot({path:path.join(out,'第一轮校准-桌面.png'),fullPage:false});
 await page.locator('.round-practice-list').screenshot({path:path.join(out,'原创专项训练.png')});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'第一轮校准-手机.png'),fullPage:false});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.locator('.round-practice-list [data-round-question]').first().click();await page.locator('#stem').waitFor();assert.equal(await page.locator('#pool').inputValue(),'all');checks.push('15道原创专项跳转、手机390px无横向溢出');
 await page.setViewportSize({width:1440,height:1000});await page.locator('[data-page=exam]').click();await page.locator('#start-short').click();await page.locator('#timer').waitFor();await page.getByText('已保存到本机',{exact:true}).waitFor();
 let state=await (await fetch(url+'/api/state')).json();assert.equal(state.activeExam.mode,'short');assert.equal(state.activeExam.ids.length,15);assert.equal(state.activeExam.deadline-state.activeExam.startedAt,1500000);
 const first=state.activeExam.snapshot[0];for(const k of first.answer)await page.locator(`input[value=${k}]`).check();await page.getByText('已保存到本机',{exact:true}).waitFor();
 await page.reload();await page.locator('#timer').waitFor();assert(await page.locator(`input[value=${first.answer[0]}]`).isChecked());await page.locator('[data-page=rounds]').click();assert(await page.locator('#timer').isVisible());assert.equal(await page.locator('.explanation').count(),0);
 await page.screenshot({path:path.join(out,'短卷练习.png'),fullPage:false});checks.push('短卷10+5与25分钟、刷新续答、考试中校准入口受限且无解析');
 await page.locator('[data-page=backup]').click();const dl=page.waitForEvent('download');await page.locator('#export').click();const backup=path.join(temp,'short.json');await(await dl).saveAs(backup);const exported=JSON.parse(await fs.readFile(backup));assert(exported.records[q.id].attempts[0].answers.includes('E'));
 const pre=page.waitForEvent('download');await page.locator('#import-file').setInputFiles(backup);await(await pre).saveAs(path.join(temp,'pre.json'));await page.getByText('已合并学习备份',{exact:true}).waitFor();await page.getByText('已保存到本机',{exact:true}).waitFor();
 await page.locator('[data-page=exam]').click();page.once('dialog',d=>d.accept());await page.locator('#finish').click();await page.locator('.result-summary').waitFor();assert((await page.locator('.score').textContent()).includes('6'));await page.getByText('已保存到本机',{exact:true}).waitFor();
 state=await(await fetch(url+'/api/state')).json();assert.equal(state.sessions[0].mode,'short');assert.equal(state.sessions[0].points,6);assert.equal(state.activeExam,null);assert.equal(state.records[q.id].attempts.filter(a=>a.correct).length,1);
 await page.locator('.result-row summary').first().click();assert.equal(await page.locator('.result-row').first().locator('li').count(),4);checks.push('五选项记录与短卷备份实际导入导出，交卷6分，复盘展示完整选项');
 await page.reload();await page.locator('[data-page=exam]').click();assert((await page.locator('.history-row').textContent()).includes('15题短练'));checks.push('历史短卷标签刷新后保留');
 assert.deepEqual(errors,[]);checks.push('无JavaScript/控制台错误、无框架错误遮罩');
 await fs.writeFile(path.join(out,'浏览器验收.json'),JSON.stringify({url,viewports:['1440x1000','390x844'],browser:'Chromium / Playwright',checks,errors,userData:'isolated temporary data directory'},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
}finally{if(browser)await browser.close();proc.kill('SIGTERM');}
