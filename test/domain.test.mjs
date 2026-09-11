import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, cleanRule, boundaries, applyAction, advance, isDone, validateBackup } from '../lib/domain.mjs';
const at = text => Date.parse(text + '+09:00');
const now = at('2026-09-11T20:00:00');
function add(state, task) { applyAction(state, {kind:'saveTask',task},now); return state.tasks.at(-1); }
test('blank start and name-only task needs no id or activation',()=>{
  const s=initialState(); assert.equal(s.tasks.length,0);
  const t=add(s,{name:'숙련자'}); assert.ok(t.id); assert.equal(t.archived,false);assert.equal(t.ruleId,null);assert.equal(t.type,'check');
});
test('daily reset: exact KST midnight regardless of host timezone',()=>{
  const r=initialState().rules[0];
  assert.equal(boundaries(r,at('2026-09-11T23:59:59')).next,'2026-09-11T15:00:00.000Z');
  assert.equal(boundaries(r,at('2026-09-12T00:00:00')).start,'2026-09-11T15:00:00.000Z');
});
test('Tuesday 17:00 weekly boundary and separate 05:00 daily',()=>{
  const [,weekly,gc]=initialState().rules;
  assert.equal(boundaries(weekly,at('2026-09-15T16:59:59')).start,'2026-09-08T08:00:00.000Z');
  assert.equal(boundaries(weekly,at('2026-09-15T17:00:00')).start,'2026-09-15T08:00:00.000Z');
  assert.equal(boundaries(gc,at('2026-09-12T01:00:00')).next,'2026-09-11T20:00:00.000Z');
});
test('monthly 31st clamps in February including leap years',()=>{
  const r=cleanRule({name:'월말',kind:'monthly',date:31,time:'17:00'});
  assert.equal(boundaries(r,at('2028-02-15T12:00:00')).next,'2028-02-29T08:00:00.000Z');
  assert.equal(boundaries(r,at('2027-02-28T17:00:00')).next,'2027-03-31T08:00:00.000Z');
});
test('interval honors future anchor and exact first boundary',()=>{
  const r=cleanRule({name:'격일',kind:'interval',days:2,anchor:'2026-09-15',time:'12:00'});
  assert.equal(boundaries(r,now).start,null);
  assert.equal(boundaries(r,at('2026-09-15T12:00:00')).next,'2026-09-17T03:00:00.000Z');
  assert.throws(()=>cleanRule({...r,anchor:'2026-02-31'}));
});
test('closed app catches up once, retaining historical completions',()=>{
  const s=initialState(),t=add(s,{name:'일일',ruleId:'daily'});
  applyAction(s,{kind:'toggle',id:t.id},now);assert.equal(s.history.length,1);
  assert.equal(advance(s,at('2026-10-05T10:00:00')),true);assert.equal(t.done,false);assert.equal(s.history.length,1);
  assert.equal(advance(s,at('2026-10-05T10:00:00')),false);
  applyAction(s,{kind:'toggle',id:t.id},at('2026-10-05T10:00:00'));assert.equal(s.history.length,2);
});
test('counter cap edits preserve quantity; completion/undo are deduplicated',()=>{
  const s=initialState(),t=add(s,{name:'석판',type:'counter',target:450,current:450,ruleId:'weekly'});
  assert.equal(s.history.length,1);
  applyAction(s,{kind:'saveTask',id:t.id,task:{...t,target:900}},now);
  assert.equal(s.tasks[0].current,450);assert.equal(isDone(s.tasks[0]),false);assert.equal(s.history.length,0);
  applyAction(s,{kind:'setCurrent',id:t.id,value:900},now);applyAction(s,{kind:'setCurrent',id:t.id,value:900},now);assert.equal(s.history.length,1);
  applyAction(s,{kind:'toggle',id:t.id},now);assert.equal(s.history.length,0);
});
test('three separate coins complete together, reset together',()=>{
  const s=initialState(),t=add(s,{name:'동전',type:'checklist',ruleId:'weekly',steps:['A','B','C'].map(name=>({name}))});
  for(const step of t.steps)applyAction(s,{kind:'step',id:t.id,stepId:step.id},now);
  assert.equal(isDone(t),true);assert.equal(s.history.length,1);
  advance(s,at('2026-09-15T17:00:00'));assert.equal(t.steps.some(s=>s.done),false);
});
test('rule edit preserves checks and rebases completion history',()=>{
  const s=initialState(),t=add(s,{name:'완료',ruleId:'daily'});applyAction(s,{kind:'toggle',id:t.id},now);
  applyAction(s,{kind:'saveRule',id:'daily',rule:{name:'새 시간',kind:'daily',time:'21:00'}},now);
  assert.equal(t.done,true);assert.equal(s.history.length,1);advance(s,now);assert.equal(t.done,true);
  applyAction(s,{kind:'toggle',id:t.id},now);assert.equal(s.history.length,0);
});
test('archive is reversible; referenced rules cannot be deleted',()=>{
  const s=initialState(),t=add(s,{name:'보관',ruleId:'daily'});
  applyAction(s,{kind:'archive',id:t.id},now);assert.equal(t.archived,true);
  assert.throws(()=>applyAction(s,{kind:'deleteRule',id:'daily'},now));
  applyAction(s,{kind:'archive',id:t.id},now);assert.equal(t.archived,false);
});
test('changing a completed task schedule moves its current completion without duplicates',()=>{
  const s=initialState(),t=add(s,{name:'숙제',ruleId:'daily'});applyAction(s,{kind:'toggle',id:t.id},now);
  applyAction(s,{kind:'saveTask',id:t.id,task:{...t,ruleId:'weekly'}},now);assert.equal(s.history.length,1);
  applyAction(s,{kind:'toggle',id:t.id},now);assert.equal(s.history.length,0);
});
test('one-time goal does not reset and backups round-trip',()=>{
  const s=initialState(),t=add(s,{name:'장기',type:'checklist',steps:[{name:'첫 단계',done:true}]});
  const backup=validateBackup(JSON.parse(JSON.stringify(s)));advance(backup,at('2030-01-01T00:00:00'));assert.equal(isDone(backup.tasks[0]),true);
  assert.equal(backup.tasks[0].steps[0].id,t.steps[0].id);assert.equal(backup.history.length,1);
});
test('bad backup, duplicate id, unsafe URL and invalid quantity rejected',()=>{
  assert.throws(()=>validateBackup({version:2}));
  const s=initialState(),t=add(s,{name:'일'});s.tasks.push({...t});assert.throws(()=>validateBackup(s));
  assert.throws(()=>add(initialState(),{name:'링크',url:'javascript:alert(1)'}));
  assert.throws(()=>add(initialState(),{name:'수량',type:'counter',target:-1}));
  assert.throws(()=>add(initialState(),{name:'수량',type:'counter',current:1.5}));
});
