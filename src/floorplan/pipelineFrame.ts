// The channel between the editor and a pipeline UI running in a SANDBOXED iframe (allow-scripts, no
// allow-same-origin): the page cannot reach the editor's DOM, storage or tokens — everything goes through
// postMessage, and the host answers only the calls below. Spec: docs/pipeline-ui-spec.md ("Pipeline UIs").
//
// Inside the frame (FRAME_SHIM, injected first into every pipeline page):
//   window.claude.use('db' | 'assets' | 'downloads')   the artifact-runtime API space-brief >= 0.7 already speaks
//   window.pipeline = { db, assets, downloads, emit(type, data), project }   the same, for new pipeline UIs, plus
//     read(path) / list(path) / url(path)  the project's files in R2 (paths relative to Projects/<CODE>/),
//     job(stage, args) / cancelJob(stage)  queue (or cancel) a runner stage (jobs/<STAGE>.json in the pipeline's folder),
//     write(path, content) / del(path)     write or delete one project file (Projects/<CODE>/ only),
//     openCanvas(path)                     open a project canvas in the editor, notify(message, level) a toast,
//     host { version, capabilities }       what this editor offers (check before using a newer call),
//     assets.upload(blob, { name, target: 'inputs/decks', onProgress(loaded, total) })  a user file of ANY size into
//                                          the project's inputs/ (straight to R2; rejects with { code, message } saying why)
//   localStorage                                        kept per project in R2 (storage.json), not the browser
// Host → frame messages: { key, value } a store snapshot, { tab } show a panel (window.PIPELINE_UI.tab or space-brief).

/** Runs in the frame. Plain ES5 so any pipeline page can host it. */
export const FRAME_SHIM = `(function(){
var P=parent,n=0,pend={},subs={},prog={};
function clone(o){return o==null?o:JSON.parse(JSON.stringify(o));}
function call(m,a){return new Promise(function(res,rej){var id=++n;pend[id]=[res,rej];P.postMessage({__pipe:1,id:id,m:m,a:a},'*');});}
addEventListener('message',function(e){
  if(e.source!==P)return;var d=e.data;if(!d||!d.__pipe)return;
  if(d.uprog){var cb=prog[d.uprog.pid];if(cb)try{cb(d.uprog.loaded,d.uprog.total);}catch(x){}return;}
  if(d.re){var p=pend[d.re];if(p){delete pend[d.re];if(d.err)p[1](d.err);else p[0](d.v);}return;}
  if(d.key){(subs[d.key]||[]).slice().forEach(function(cb){cb(d.value);});return;}
  if(d.tab)showTab(d.tab,0);
});
// A step's panel can be asked for before the page has started: retry until it has (up to ~60 s).
function showTab(id,k){var u=window.PIPELINE_UI,b=window.BRIEF;
  if(u&&u.tab)u.tab(id);else if(b&&b.UI&&b.S&&b.S.loaded){b.UI.tab=id;b.refresh();}
  else if(k<300)setTimeout(function(){showTab(id,k+1);},200);}
function sub(key,cb){(subs[key]=subs[key]||[]).push(cb);call('sub',{key:key});return function(){subs[key]=(subs[key]||[]).filter(function(x){return x!==cb;});};}
function dsnap(v){return {exists:v!=null,data:function(){return clone(v);}};}
var db={
  doc:function(p){var i=p.indexOf('/'),c=p.slice(0,i),id=p.slice(i+1),meta=p==='brief/meta';
    return {onSnapshot:function(cb){return sub(meta?p:c,function(v){cb(dsnap(meta?v:(v||{})[id]));});},
      get:function(){return call('get',{path:p}).then(dsnap);},
      set:function(d){return call('set',{path:p,data:d});},update:function(d){return call('update',{path:p,data:d});},
      delete:function(){return call('del',{path:p});}};},
  collection:function(c){return {onSnapshot:function(cb){return sub(c,function(v){v=v||{};cb({docs:Object.keys(v).map(function(id){return {id:id,data:function(){return clone(v[id]);}};})});});}};}
};
var assets={upload:function(b,o){var pid=++n;if(o&&typeof o.onProgress==='function')prog[pid]=o.onProgress;
  return call('upload',{blob:b,type:(o&&o.type)||b.type||'',name:(o&&o.name)||b.name||'',target:(o&&o.target)||'',pid:pid}).then(function(v){delete prog[pid];return v;},function(e){delete prog[pid];throw e;});}};
var downloads={save:function(o){return call('download',{filename:o.filename,data:o.data});}};
var ctx=window.__PIPE_CTX__||{};
window.claude={use:function(n){return Promise.resolve(n==='db'?db:n==='assets'?assets:n==='downloads'?downloads:null);}};
window.pipeline={db:db,assets:assets,downloads:downloads,project:ctx.code,id:ctx.id,dir:ctx.dir||'',emit:function(t,d){return call('emit',{type:t,data:d});},
  read:function(p){return call('read',{path:p});},list:function(p){return call('list',{path:p||''});},
  job:function(s,a){return call('job',{stage:s,args:a||{}});},cancelJob:function(s){return call('cancelJob',{stage:s});},
  write:function(p,c){return call('write',{path:p,content:typeof c==='string'?c:JSON.stringify(c,null,1)});},del:function(p){return call('del_file',{path:p});},
  openCanvas:function(p){return call('openCanvas',{path:p});},notify:function(m,l){return call('notify',{message:String(m),level:l||'info'});},
  host:ctx.host||{version:'0',capabilities:[]},url:function(p){return (ctx.projectUrl||'')+String(p).split('/').map(encodeURIComponent).join('/');},
  setTabs:function(tabs,active){var j=JSON.stringify([tabs,active]);if(j===lastTabs)return;lastTabs=j;call('tabs',{tabs:tabs,active:active});}};
// The page's own tabs go to the editor's top bar (beside its Drawings tab): a page calls pipeline.setTabs, or —
// space-brief — its tab buttons ([data-act=tab][data-id] in #top) are read here, and hidden in the page.
var lastTabs='';
function scanTabs(){var b=document.querySelectorAll('#top [data-act="tab"][data-id]');if(!b.length)return;var act=null;
  window.pipeline.setTabs(Array.prototype.map.call(b,function(x){var l=x.querySelector('.tl'),c=x.querySelector('.count');
    if(x.getAttribute('aria-selected')==='true')act=x.dataset.id;
    return {id:x.dataset.id,label:((l&&l.textContent)||x.textContent||'').trim(),count:c?Number(c.textContent)||0:0,amber:!!(c&&c.classList.contains('amber'))};}),act);}
if(ctx.hostTabs){var st=document.createElement('style');st.textContent='#top nav.tabs,#top [role=tablist]{display:none!important}';
  (document.head||document.documentElement).appendChild(st);
  addEventListener('DOMContentLoaded',function(){scanTabs();new MutationObserver(scanTabs).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-selected']});});}
var kv=ctx.kv||{};
var mem={getItem:function(k){return Object.prototype.hasOwnProperty.call(kv,k)?kv[k]:null;},
  setItem:function(k,v){kv[k]=String(v);call('kv',{k:k,v:String(v)});},removeItem:function(k){delete kv[k];call('kv',{k:k,v:null});},
  clear:function(){kv={};call('kv',{clear:true});},key:function(i){return Object.keys(kv)[i]||null;}};
Object.defineProperty(mem,'length',{get:function(){return Object.keys(kv).length;}});
try{Object.defineProperty(window,'localStorage',{value:mem,configurable:true});}catch(e){}
})();`;

/** The sandbox for every pipeline frame: scripts yes, the editor's origin no. */
export const FRAME_SANDBOX = "allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads";

/** <head> preamble: absolute <base> (the frame's origin is opaque), the context, then the shim — before the page's own scripts. */
/** What this editor offers a pipeline UI (window.pipeline.host). Bump HOST_VERSION when a call is added. */
export const HOST_VERSION = "1.0.0";
export const HOST_CAPABILITIES = ["db", "upload-any-size", "upload-progress", "read", "list", "write", "delete", "url", "job", "cancel-job", "open-canvas", "notify", "emit", "tabs", "downloads"];

export function framePreamble(base: string, ctx: { id: string; code: string; kv: Record<string, string>; hostTabs?: boolean; projectUrl?: string; dir?: string; host?: { version: string; capabilities: string[]; config?: Record<string, unknown> } }) {
  const json = JSON.stringify(ctx).replace(/</g, "\\u003c");
  return `<base href="${base}"><script>window.__PIPE_CTX__=${json};</script><script>${FRAME_SHIM}</script>`;
}

type Doc = Record<string, unknown>;
export interface Store { meta: unknown; loaded: boolean; [col: string]: unknown }

export interface FrameHostOptions {
  /** The pipeline's shared store; null for a page without one (it still gets localStorage). */
  store: Store | null;
  /** The store changed: by the user (claude = false) or by pipeline_patch. */
  onWrite: () => void;
  /** localStorage changed. */
  onKv: (kv: Record<string, string>) => void;
  kv: Record<string, string>;
  /** `target` "inputs/<kind>": a user file into the project's inputs (keeps its name); else the app's own uploads. */
  upload: (blob: Blob, type: string, name?: string, target?: string, onProgress?: (loaded: number, total: number) => void) => Promise<{ id: string; key?: string; url?: string }>;
  write?: (path: string, content: string) => Promise<{ key: string }>;
  del?: (path: string) => Promise<{ key: string }>;
  cancelJob?: (stage: string) => Promise<{ key: string }>;
  openCanvas?: (path: string) => Promise<{ opened: string }>;
  notify?: (message: string, level: string) => void;
  /** The project's files (paths relative to Projects/<CODE>/). */
  read?: (path: string) => Promise<string>;
  list?: (path: string) => Promise<string[]>;
  /** Queue a runner stage of this pipeline. */
  job?: (stage: string, args: Record<string, unknown>) => Promise<{ key: string }>;
  onEmit: (type: string, data: unknown) => void;
  /** The page's own tabs (shown in the editor's top bar) and which one it has open. */
  onTabs?: (tabs: { id: string; label: string; count: number; amber: boolean }[], active: string | null) => void;
}

/** The editor side of one frame. Only messages from that frame's window are answered. */
export function connectFrame(frame: HTMLIFrameElement, o: FrameHostOptions) {
  const subs = new Set<string>();
  const post = (msg: Record<string, unknown>) => frame.contentWindow?.postMessage({ __pipe: 1, ...msg }, "*");
  const split = (p: string) => { const i = p.indexOf("/"); return [p.slice(0, i), p.slice(i + 1)] as const; };
  const valueOf = (key: string) => (key === "brief/meta" ? o.store?.meta ?? null : (o.store?.[key] as Doc | undefined) ?? {});
  const send = (key: string) => post({ key, value: valueOf(key) });
  const need = () => { if (!o.store) throw new Error("this pipeline has no shared store"); return o.store; };
  const write = (p: string, d: Doc | null, how: "set" | "update" | "del") => {
    const s = need();
    if (p === "brief/meta") s.meta = how === "update" ? { ...((s.meta as Doc) ?? {}), ...d } : d;
    else {
      const [c, id] = split(p);
      if (!c || !id || c === "meta" || c === "loaded") throw new Error(`bad document path "${p}" (collection/id)`);
      const col = ((s[c] as Record<string, Doc>) ??= {});
      if (how === "del") delete col[id]; else col[id] = how === "update" ? { ...(col[id] ?? {}), ...d } : { ...d };
    }
    o.onWrite();
    send(p === "brief/meta" ? p : split(p)[0]);
  };
  const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
    sub: (a) => { const k = String(a.key); subs.add(k); send(k); return true; },
    get: (a) => { const p = String(a.path); if (p === "brief/meta") return o.store?.meta ?? null; const [c, id] = split(p); return (o.store?.[c] as Record<string, Doc> | undefined)?.[id] ?? null; },
    set: (a) => write(String(a.path), a.data as Doc, "set"),
    update: (a) => write(String(a.path), a.data as Doc, "update"),
    del: (a) => write(String(a.path), null, "del"),
    upload: (a) => o.upload(a.blob as Blob, String(a.type ?? ""), String(a.name ?? ""), String(a.target ?? ""),
      a.pid ? (loaded, total) => post({ uprog: { pid: a.pid, loaded, total } }) : undefined),
    write: (a) => { if (!o.write) throw new Error("this host cannot write project files"); return o.write(String(a.path ?? ""), String(a.content ?? "")); },
    del_file: (a) => { if (!o.del) throw new Error("this host cannot delete project files"); return o.del(String(a.path ?? "")); },
    cancelJob: (a) => { if (!o.cancelJob) throw new Error("this host cannot cancel runner jobs"); return o.cancelJob(String(a.stage ?? "")); },
    openCanvas: (a) => { if (!o.openCanvas) throw new Error("this host cannot open canvases"); return o.openCanvas(String(a.path ?? "")); },
    notify: (a) => { o.notify?.(String(a.message ?? ""), String(a.level ?? "info")); return true; },
    read: (a) => { if (!o.read) throw new Error("this host cannot read project files"); return o.read(String(a.path ?? "")); },
    list: (a) => { if (!o.list) throw new Error("this host cannot list project files"); return o.list(String(a.path ?? "")); },
    job: (a) => { if (!o.job) throw new Error("this host cannot queue runner jobs"); return o.job(String(a.stage ?? ""), (a.args as Record<string, unknown>) ?? {}); },
    download: (a) => {
      const data = a.data as Blob | string;
      const u = URL.createObjectURL(typeof data === "string" ? new Blob([data]) : data);
      const el = document.createElement("a"); el.href = u; el.download = String(a.filename ?? "download"); document.body.appendChild(el); el.click(); el.remove();
      setTimeout(() => URL.revokeObjectURL(u), 4000);
      return true;
    },
    kv: (a) => {
      if (a.clear) for (const k of Object.keys(o.kv)) delete o.kv[k];
      else if (a.v == null) delete o.kv[String(a.k)]; else o.kv[String(a.k)] = String(a.v);
      o.onKv(o.kv); return true;
    },
    emit: (a) => { o.onEmit(String(a.type ?? "ui"), a.data); return true; },
    tabs: (a) => {
      const list = (Array.isArray(a.tabs) ? a.tabs : []).map((t: Record<string, unknown>) => ({
        id: String(t.id ?? ""), label: String(t.label ?? t.id ?? ""), count: Number(t.count) || 0, amber: !!t.amber,
      })).filter((t) => t.id);
      o.onTabs?.(list, a.active == null ? null : String(a.active));
      return true;
    },
  };
  const onMessage = async (e: MessageEvent) => {
    if (e.source !== frame.contentWindow) return;
    const d = e.data as { __pipe?: number; id?: number; m?: string; a?: Record<string, unknown> };
    if (!d?.__pipe || !d.id || !d.m) return;
    const h = handlers[d.m];
    try {
      if (!h) throw new Error(`unknown call ${d.m}`);
      post({ re: d.id, v: await h(d.a ?? {}) });
    } catch (err) { post({ re: d.id, err: { code: (err as { reason?: string }).reason ?? "host", message: (err as Error).message } }); }
  };
  window.addEventListener("message", onMessage);
  return {
    /** Re-send every subscribed key (after Claude patched the store). */
    refresh: () => subs.forEach(send),
    tab: (id: string) => post({ tab: id }),
    dispose: () => window.removeEventListener("message", onMessage),
  };
}
