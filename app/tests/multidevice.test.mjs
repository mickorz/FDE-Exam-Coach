import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {recordAnswer} from '../src/core.js';
const empty=()=>({schemaVersion:1,revision:0,records:{},sessions:[],activeExam:null,settings:{}});

function stubFetch(handler){
  globalThis.fetch=async(url,opts)=>{
    const body=opts?.body?JSON.parse(opts.body):null;
    return await handler(url,opts?.method||'GET',body);
  };
}
const okStorage=()=>{globalThis.localStorage={setItem(){},getItem(){return null},removeItem(){}}};

test('多端并发保存：409 后自动与服务器最新记录合并并重试成功（FR-011-03）',async()=>{
  const local=empty();local.revision=5;
  recordAnswer(local,{id:'q1',answer:['A']},['A'],1000,'chapter');
  const serverState=empty();serverState.revision=6;
  recordAnswer(serverState,{id:'q2',answer:['B']},['B'],2000,'review');
  const puts=[];
  stubFetch(async(url,method,body)=>{
    if(method==='PUT'){
      puts.push(body);
      if(puts.length===1)return {ok:false,status:409,json:async()=>({error:'另一窗口已更新记录。请先导出当前记录，再刷新合并。'})};
      assert.equal(body.revision,6,'重试必须携带服务器最新 revision');
      return {ok:true,status:200,json:async()=>({revision:7})};
    }
    return {ok:true,status:200,json:async()=>serverState};
  });
  okStorage();
  const s=new Store();s.state=local;
  await s.save();
  assert.equal(puts.length,2,'自动合并后恰好重试一次');
  assert.equal(s.state.revision,7);
  assert(s.state.records.q1,'本地作答保留');
  assert(s.state.records.q2,'服务器作答合并进来');
  assert.equal(s.failed,false);
});

test('合并重试仍失败时保留原错误提示，不静默丢数据',async()=>{
  const local=empty();local.revision=5;
  const serverState=empty();serverState.revision=6;
  stubFetch(async(url,method)=>{
    if(method==='PUT')return {ok:false,status:409,json:async()=>({error:'另一窗口已更新记录。请先导出当前记录，再刷新合并。'})};
    return {ok:true,status:200,json:async()=>serverState};
  });
  okStorage();
  const s=new Store();s.state=local;
  await s.save();
  assert.equal(s.failed,true);
  assert(s.state.records,'状态不被破坏');
});

test('无冲突时单次保存，行为与原版一致',async()=>{
  const local=empty();local.revision=3;
  let puts=0;
  stubFetch(async(url,method)=>{
    if(method==='PUT'){puts++;return {ok:true,status:200,json:async()=>({revision:4})};}
    throw new Error('无冲突时不应读取服务器状态');
  });
  okStorage();
  const s=new Store();s.state=local;
  await s.save();
  assert.equal(puts,1);
  assert.equal(s.state.revision,4);
  assert.equal(s.failed,false);
});
