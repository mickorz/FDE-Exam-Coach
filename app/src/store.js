import {validateBackup,mergeBackup} from './core.js';
const KEY='fde-study-recovery-v1',ARCHIVE='fde-study-unmerged-v1';
export class Store {
  constructor(){this.state=null;this.queue=Promise.resolve();this.onStatus=()=>{};this.failed=false;this.pending=0;this.recoverySnapshot=null;}
  async load(){const response=await fetch('/api/state');if(!response.ok)throw new Error((await response.json()).error);this.state=validateBackup(await response.json());try{const archived=JSON.parse(localStorage.getItem(ARCHIVE)||'null'),cached=JSON.parse(localStorage.getItem(KEY)||'null');const candidate=archived||(cached&&cached.revision>=this.state.revision?cached:null);if(candidate&&JSON.stringify(candidate)!==JSON.stringify(this.state)){validateBackup(candidate);this.recoverySnapshot=candidate;try{localStorage.setItem(ARCHIVE,JSON.stringify(candidate));}catch{}}}catch{}return this.state;}
  cache(){try{localStorage.setItem(KEY,JSON.stringify(this.state));return true;}catch{return false;}}
  async _put(snapshot){
    const res=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json','X-FDE-Client':'offline-study'},body:JSON.stringify(snapshot)});
    let payload={};try{payload=await res.json();}catch{}
    return {res,payload};
  }
  save(){
    this.cache();this.pending++;this.onStatus('正在保存…');
    this.queue=this.queue.then(async()=>{
      let snapshot=structuredClone(this.state);
      let attempt=await this._put(snapshot);
      if(attempt.res.status===409){
        // 多端并发保存（FR-011-03）冲突规则：以服务器最新记录为基，合并本地增量后重试一次。
        // 合并语义：作答记录并集去重、历史考试按 id 去重、进行中考试以服务器已保存版本为准。
        const latest=validateBackup(await (await fetch('/api/state')).json());
        this.state=mergeBackup(latest,snapshot);
        this.onStatus('已合并其他设备的修改…');
        attempt=await this._put(structuredClone(this.state));
      }
      if(!attempt.res.ok)throw new Error(attempt.payload.error||'保存失败');
      this.state.revision=attempt.payload.revision;this.failed=false;
      this.cached=this.cache();
    }).catch(error=>{this.failed=true;this.onStatus(error.message+' · 请导出备份',true);}).finally(()=>{this.pending--;if(this.pending)this.onStatus('正在保存…');else if(!this.failed)this.onStatus(this.cached?'已保存到本机':'已保存到本机；浏览器应急副本空间不足',false);});
    return this.queue;
  }
  clearRecovery(){this.recoverySnapshot=null;try{localStorage.removeItem(ARCHIVE);}catch{}}
  recovery(){if(this.recoverySnapshot)return this.recoverySnapshot;try{return JSON.parse(localStorage.getItem(KEY)||'null');}catch{return null;}}
}
