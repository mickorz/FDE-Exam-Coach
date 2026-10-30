import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {makeExam} from '../src/core.js';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const load=p=>JSON.parse(readFileSync(join(root,p),'utf-8'));
const questions=load('data/questions.json');
const quality=load('data/quality.json');
const manifest=load('data/manifest.json');
const rounds=load('data/rounds.json');

test('题库题量与唯一 ID 与源项目一致（FR-001）',()=>{
  assert.equal(questions.length,1000);
  assert.equal(new Set(questions.map(q=>q.id)).size,1000,'重复导入不允许产生重复题目');
  assert.equal(manifest.totalAuthored,1000);
});

test('题目结构完整：选项、答案、解析、来源、质量字段保留',()=>{
  for(const q of questions){
    assert(q.id&&q.stem&&q.topic&&q.explanation,`题目字段缺失：${q.id}`);
    assert(['single','multiple'].includes(q.type),`题目类型异常：${q.id}`);
    const keys=Object.keys(q.options).sort().join('');
    assert(['ABCD','ABCDE'].includes(keys),`选项键异常：${q.id}`);
    for(const a of q.answer)assert(Object.hasOwn(q.options,a),`答案不在选项中：${q.id}`);
    assert(q.sources.length>=1,`缺少官方来源：${q.id}`);
    assert(q.review?.contentHash,`缺少内容哈希：${q.id}`);
  }
});

test('质量分级与官方清单一致：500 可组卷 / 458 仅学习 / 42 待修订',()=>{
  const audit=new Map(quality.questions.map(x=>[x.id,x.examUse]));
  assert.equal(audit.size,1000);
  const counts={eligible:0,learning_only:0,hold:0};
  for(const q of questions){const use=audit.get(q.id)||'hold';counts[use]++;q.quality={examUse:use};}
  assert.deepEqual(counts,manifest.qualityCounts);
  assert.deepEqual(counts,{eligible:500,learning_only:458,hold:42});
});

test('42 道待修订题不进入组卷与默认练习范围（FR-001）',()=>{
  const audit=new Map(quality.questions.map(x=>[x.id,x.examUse]));
  for(const mode of ['full','short']){
    const exam=makeExam(questions.map(q=>({...q,quality:{examUse:audit.get(q.id)||'hold'}})),1000,()=>0.42,mode);
    assert(exam.snapshot.every(q=>q.quality.examUse==='eligible'),`${mode} 组卷混入了非可组卷题`);
  }
  const coreIds=new Set(rounds.rounds[0].coreIds);
  for(const q of questions)if(audit.get(q.id)==='hold')assert(!coreIds.has(q.id),`待修订题进入核心池：${q.id}`);
});

test('与源项目 thirdparties/FDE_Learning 逐字节一致，答案与分级无意外变化',()=>{
  const src=join(root,'..','thirdparties','FDE_Learning','data');
  if(!existsSync(src))return; // 源项目被移除时跳过比对，结构校验仍然生效
  for(const name of ['questions.json','quality.json','manifest.json','rounds.json']){
    assert.equal(readFileSync(join(root,'data',name)).toString('utf-8'),readFileSync(join(src,name)).toString('utf-8'),`${name} 与源项目不一致`);
  }
});
