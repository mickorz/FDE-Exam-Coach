import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
const empty=()=>({schemaVersion:1,revision:0,records:{},sessions:[],activeExam:null,settings:{}});
test('浏览器缓存失败不会误报磁盘写入失败',async()=>{
 globalThis.localStorage={setItem(){throw new Error('quota');}};globalThis.fetch=async()=>({ok:true,json:async()=>({revision:1})});
 const s=new Store();s.state=empty();const messages=[];s.onStatus=(m,e)=>messages.push([m,e]);await s.save();assert.equal(s.failed,false);assert.equal(s.pending,0);assert(messages.at(-1)[0].includes('已保存到本机'));assert.equal(messages.at(-1)[1],false);
});
test('旧快照落盘时不显示全部已保存，直到最后排队写入结束',async()=>{
 globalThis.localStorage={setItem(){}};const callbacks=[];globalThis.fetch=()=>new Promise(resolve=>callbacks.push(resolve));
 const s=new Store();s.state=empty();const messages=[];s.onStatus=m=>messages.push(m);s.save();await new Promise(r=>setImmediate(r));s.state.settings.x='new';const latest=s.save();callbacks.shift()({ok:true,json:async()=>({revision:1})});await new Promise(r=>setImmediate(r));assert.equal(s.pending,1);assert.equal(messages.at(-1),'正在保存…');callbacks.shift()({ok:true,json:async()=>({revision:2})});await latest;assert.equal(s.pending,0);assert.equal(messages.at(-1),'已保存到本机');
});
test('启动发现新应急副本时先隔离保留，后续保存不覆盖待恢复原件',async()=>{
 const disk=empty(),cache=empty();cache.settings.targetDate='2026-10-20';const values=new Map([['fde-study-recovery-v1',JSON.stringify(cache)]]);globalThis.localStorage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};globalThis.fetch=async()=>({ok:true,json:async()=>disk});const s=new Store();await s.load();assert.equal(s.recovery().settings.targetDate,'2026-10-20');s.state.settings.targetDate='2026-11-01';s.cache();assert.equal(s.recovery().settings.targetDate,'2026-10-20');assert.equal(JSON.parse(values.get('fde-study-unmerged-v1')).settings.targetDate,'2026-10-20');
});
