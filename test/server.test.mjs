import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
test('HTTP save/restart/restore with conflicts and cross-origin writes blocked',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ffxiv-test-'));
  let app=await createApp({dataDir:dir,port:0});
  const close=()=>new Promise(resolve=>{app.server.close(resolve);app.server.closeAllConnections();});
  const get=()=>fetch(app.url+'/api/state').then(r=>r.json());
  const post=(route,s,payload,extra={})=>fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':s.token,...extra},body:JSON.stringify({...payload,revision:s.revision})});
  try {
    let s=await get();assert.equal(s.tasks.length,0);
    assert.equal((await fetch(app.url+'/api/action',{method:'POST',body:'{}'})).status,403);
    assert.equal((await post('/api/action',s,{kind:'saveTask',task:{name:'불가'}},{Origin:'https://evil.example'})).status,403);
    let res=await post('/api/action',s,{kind:'saveTask',task:{name:'저장 확인'}});assert.equal(res.status,200);
    assert.equal((await post('/api/action',s,{kind:'saveTask',task:{name:'충돌'}})).status,409);
    s=await res.json();const backup=await fetch(app.url+'/api/backup').then(r=>r.json());
    await close();app=await createApp({dataDir:dir,port:0});s=await get();assert.equal(s.tasks[0].name,'저장 확인');
    res=await post('/api/action',s,{kind:'toggle',id:s.tasks[0].id});s=await res.json();assert.equal(s.history.length,1);
    const invalid=await post('/api/restore',s,{backup:{bad:true}});assert.equal(invalid.status,400);assert.equal((await get()).history.length,1);
    const restored=await post('/api/restore',s,{backup});assert.equal(restored.status,200);assert.equal((await get()).history.length,0);
    assert.ok((await readdir(path.join(dir,'backups'))).some(f=>f.endsWith('before-restore.json')));
    assert.equal(JSON.parse(await readFile(path.join(dir,'state.json'),'utf8')).tasks.length,1);
    assert.equal((await fetch(app.url+'/data/state.json')).status,404);
  } finally {await close();await rm(dir,{recursive:true,force:true});}
});
test('corrupt state fails closed without replacing the original file',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ffxiv-test-corrupt-'));
  try {await writeFile(path.join(dir,'state.json'),'broken');await assert.rejects(createApp({dataDir:dir,port:0}),/저장 파일/);assert.equal(await readFile(path.join(dir,'state.json'),'utf8'),'broken');}
  finally {await rm(dir,{recursive:true,force:true});}
});
