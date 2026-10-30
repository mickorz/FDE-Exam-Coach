import {validateBackup} from './core.js';
const KEY='fde-study-recovery-v1',ARCHIVE='fde-study-unmerged-v1';
export class Store {
  constructor(){this.state=null;this.queue=Promise.resolve();this.onStatus=()=>{};this.failed=false;this.pending=0;this.recoverySnapshot=null;}
  async load(){const response=await fetch('/api/state');if(!response.ok)throw new Error((await response.json()).error);this.state=validateBackup(await response.json());try{const archived=JSON.parse(localStorage.getItem(ARCHIVE)||'null'),cached=JSON.parse(localStorage.getItem(KEY)||'null');const candidate=archived||(cached&&cached.revision>=this.state.revision?cached:null);if(candidate&&JSON.stringify(candidate)!==JSON.stringify(this.state)){validateBackup(candidate);this.recoverySnapshot=candidate;try{localStorage.setItem(ARCHIVE,JSON.stringify(candidate));}catch{}}}catch{}return this.state;}
  cache(){try{localStorage.setItem(KEY,JSON.stringify(this.state));return true;}catch{return false;}}
  save(){
    this.cache();this.pending++;this.onStatus('正在保存…');
    this.queue=this.queue.then(async()=>{
      const snapshot=structuredClone(this.state);
      const res=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json','X-FDE-Client':'offline-study'},body:JSON.stringify(snapshot)});
      const payload=await res.json();if(!res.ok)throw new Error(payload.error);
      this.state.revision=payload.revision;this.failed=false;
      this.cached=this.cache();
    }).catch(error=>{this.failed=true;this.onStatus(error.message+' · 请导出备份',true);}).finally(()=>{this.pending--;if(this.pending)this.onStatus('正在保存…');else if(!this.failed)this.onStatus(this.cached?'已保存到本机':'已保存到本机；浏览器应急副本空间不足',false);});
    return this.queue;
  }
  clearRecovery(){this.recoverySnapshot=null;try{localStorage.removeItem(ARCHIVE);}catch{}}
  recovery(){if(this.recoverySnapshot)return this.recoverySnapshot;try{return JSON.parse(localStorage.getItem(KEY)||'null');}catch{return null;}}
}
