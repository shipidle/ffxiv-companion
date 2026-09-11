const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = value => Number(value).toLocaleString('ko-KR');
const date = (value, time = false) => new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'short',...(time ? {hour:'2-digit',minute:'2-digit',hour12:false} : {})}).format(new Date(value));
let state, page = 'dashboard', filter = 'all', search = '', mode = localStorage.getItem('ffxiv-view') || 'list';
let editingId = null, detailId = null, ruleId = null, pending = false, stepDraft = [], toastTimer, completedExpanded = false;
const templates = {
  daily: { name:'', type:'check', ruleId:'daily', category:'일일' },
  currency: { name:'알라그 석판', type:'counter', target:900, current:0, ruleId:'weekly', category:'재화' },
  coins: { name:'연합 레이드 동전', type:'checklist', ruleId:'weekly', category:'레이드', steps:['첫 번째 레이드 동전','두 번째 레이드 동전','세 번째 레이드 동전'].map(name => ({name,done:false})) }
};
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500); }
async function request(url, options) {
  const res = await fetch(url, options); const body = await res.json();
  if (!res.ok) { const e = new Error(body.error || '요청을 처리할 수 없어요.'); e.status = res.status; throw e; }
  return body;
}
async function refresh() {
  try { const fresh = await request('/api/state'); const changed = !state || fresh.revision !== state.revision; state = fresh; $('#save-status').textContent = '저장됨'; $('#date-label').textContent = date(state.serverTime); if (changed) { render(); if (detailId && $('#detail').open) renderDetail(); } }
  catch { $('#save-status').textContent = '연결 끊김'; if (!state) $('#screen').innerHTML = '<div class="empty"><h1>앱에 연결하지 못했어요</h1><p>실행 아이콘으로 다시 열어 주세요.</p><button class="soft" data-refresh>다시 연결</button></div>'; }
}
async function mutate(action, message = '') {
  if (pending) return false;
  pending = true; document.body.classList.add('saving'); $('#save-status').textContent = '저장 중…';
  try { state = await request('/api/action', { method:'POST', headers:{'Content-Type':'application/json','X-App-Token':state.token}, body:JSON.stringify({...action, revision:state.revision}) }); render(); if (detailId && $('#detail').open) renderDetail(); if (message) toast(message); $('#save-status').textContent = '저장됨'; return true; }
  catch(e) { if (e.status === 409) await refresh(); toast(e.message); throw e; }
  finally { pending = false; document.body.classList.remove('saving'); }
}
function ruleLabel(rule) {
  if (!rule) return '반복 없음';
  const day = ['일','월','화','수','목','금','토'];
  const prefix = {daily:'매일',weekly:`매주 ${day[rule.day]}`,monthly:`매월 ${rule.date}일`,interval:`${rule.days}일마다`}[rule.kind];
  return `${prefix} ${rule.time}`;
}
function taskSubtitle(t) {
  const rule = state.rules.find(r => r.id === t.ruleId);
  return [t.category !== '기타' ? t.category : '', rule ? ruleLabel(rule) : '장기 목표'].filter(Boolean).join(' · ');
}
function heading(title, subtitle, right = '') { return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${right}</div>`; }
function taskRow(t) {
  const p = t.progress, percent = Math.min(100, Math.round(p.current / p.target * 100)) || 0;
  return `<article class="task ${t.completed?'done':''}" data-task="${esc(t.id)}">
    <button class="check-button ${t.completed?'checked':''}" data-toggle="${esc(t.id)}" aria-label="${esc(t.name)} ${t.completed?'완료 취소':'완료'}" aria-pressed="${t.completed}">${t.completed?'✓':''}</button>
    <button class="task-name" data-detail="${esc(t.id)}"><strong>${t.pinned?'<span class="pin-mark" aria-label="고정됨">◆</span> ':''}${esc(t.name)}</strong><small>${esc(taskSubtitle(t))}</small></button>
    ${t.type==='counter' ? `<div class="counter-control"><input type="number" aria-label="${esc(t.name)} 현재 수량" min="0" max="1000000000" step="1" value="${t.current}" data-current="${esc(t.id)}"><span>/ ${fmt(t.target)}</span><button class="mini-button" data-plus="${esc(t.id)}" aria-label="${esc(t.name)} 수량 1 추가">＋</button></div>` : t.type==='checklist' ? `<button class="progress-pill" data-detail="${esc(t.id)}">${p.current} / ${p.target} <span>항목</span></button>` : ''}
    <button class="more-button" data-detail="${esc(t.id)}" aria-label="${esc(t.name)} 상세 보기">···</button>
    ${t.type!=='check'?`<div class="task-progress"><span style="width:${percent}%"></span></div>`:''}
  </article>`;
}
function section(title, list, label = '') {
  if (!list.length) return '';
  return `<section class="task-section"><div class="section-heading"><h2>${title}<span>${list.length}</span></h2><small>${label}</small></div><div class="task-list ${mode==='cards'?'cards':''}">${list.map(taskRow).join('')}</div></section>`;
}
function emptyStart() {
  return `<section class="welcome"><div class="welcome-art"><img src="/icon.svg" alt=""></div><span class="eyebrow">A LITTLE LESS, A LITTLE LIGHTER</span><h2>할 일은 가볍게.<br>모험은 내 속도로.</h2><p>오늘 챙길 콘텐츠 하나부터 시작해 볼까요?<br>이름만 적으면 바로 체크할 수 있어요.</p><button class="primary" data-new>＋ 첫 콘텐츠 추가</button></section><section class="starter-section"><div class="section-heading"><h2>이렇게 시작해도 좋아요</h2><small>선택한 예시를 수정해서 추가해요</small></div><div class="starter-grid"><button data-template="daily"><span class="template-icon">☀</span><strong>매일 하는 숙제</strong><small>하루 한 번, 간단한 체크</small><b>＋</b></button><button data-template="currency"><span class="template-icon">◇</span><strong>주간 석판 모으기</strong><small>900개 목표 · 상한 변경 가능</small><b>＋</b></button><button data-template="coins"><span class="template-icon">◈</span><strong>레이드 동전 3종</strong><small>각각 체크하고 한눈에 확인</small><b>＋</b></button></div></section>`;
}
function toolbar() {
  const filters = [['all','전체'],['daily','일일'],['weekly','주간'],['once','장기 목표']];
  return `<div class="content-toolbar"><div class="filters" aria-label="콘텐츠 필터">${filters.map(([v,l])=>`<button data-filter="${v}" class="${filter===v?'selected':''}" aria-pressed="${filter===v}">${l}</button>`).join('')}${page==='contents'?`<button data-filter="archived" class="${filter==='archived'?'selected':''}">보관함</button>`:''}</div><div class="view-tools"><input type="search" id="search" aria-label="콘텐츠 검색" placeholder="콘텐츠 찾기" value="${esc(search)}"><div class="segmented"><button data-mode="list" class="${mode==='list'?'selected':''}" aria-label="목록 보기">☰</button><button data-mode="cards" class="${mode==='cards'?'selected':''}" aria-label="카드 보기">▦</button></div></div></div>`;
}
function filteredTasks() {
  return state.tasks.filter(t => (filter==='archived' ? t.archived : !t.archived) && t.name.toLowerCase().includes(search.toLowerCase()) &&
    (['all','archived'].includes(filter) || (filter==='once' ? !t.ruleId : state.rules.find(r=>r.id===t.ruleId)?.kind === filter)))
    .sort((a,b) => Number(b.pinned)-Number(a.pinned));
}
function renderTaskList() {
  const items = filteredTasks(), done = items.filter(t=>t.completed), todo = items.filter(t=>!t.completed);
  if (filter==='archived') return items.length ? `<div class="task-list">${items.map(t=>`<article class="archive-row"><div><strong>${esc(t.name)}</strong><small>${esc(taskSubtitle(t))}</small></div><button class="soft" data-archive="${esc(t.id)}">다시 꺼내기</button></article>`).join('')}</div>` : '<div class="empty-small">보관한 콘텐츠가 없어요.</div>';
  if (!items.length) return '<div class="empty-small">해당하는 콘텐츠가 없어요.</div>';
  let html = '';
  if (page==='contents') html = section('진행 중',todo);
  else {
    html += section('고정한 할 일', todo.filter(t=>t.pinned));
    const rest = todo.filter(t=>!t.pinned);
    html += section('오늘 챙기기', rest.filter(t=>state.rules.find(r=>r.id===t.ruleId)?.kind==='daily'));
    html += section('이번 주와 반복 할 일', rest.filter(t=>t.ruleId && state.rules.find(r=>r.id===t.ruleId)?.kind!=='daily'));
    html += section('천천히 이루는 목표', rest.filter(t=>!t.ruleId));
  }
  if (!todo.length) html += '<div class="all-done"><span>✓</span><h2>챙길 일을 모두 마쳤어요</h2><p>이제 편하게 모험을 즐겨요.</p></div>';
  if (done.length) html += `<details class="completed-list" ${completedExpanded?'open':''}><summary>완료한 콘텐츠 <b>${done.length}</b></summary><div class="task-list ${mode==='cards'?'cards':''}">${done.map(taskRow).join('')}</div></details>`;
  return html;
}
function render() {
  if (!state) return;
  $$('nav button').forEach(b=>{b.classList.toggle('active',b.dataset.page===page); b.setAttribute('aria-current',b.dataset.page===page?'page':'false');});
  $('#date-label').textContent = date(state.serverTime);
  if (page==='dashboard' || page==='contents') {
    const active = state.tasks.filter(t=>!t.archived), done = active.filter(t=>t.completed).length;
    const ratio = active.length ? Math.round(done/active.length*100) : 0;
    let html = heading(page==='dashboard'?'오늘 할 일':'전체 콘텐츠', page==='dashboard'?'한 번에 하나씩, 오늘의 모험을 정리해요.':'필요한 콘텐츠만 꺼내 두고, 나머지는 보관해요.');
    if (!state.tasks.length) html += emptyStart();
    else {
      if (page==='dashboard') html += `<section class="summary-banner"><div><span class="eyebrow">YOUR PACE, YOUR ADVENTURE</span><h2>${done ? `${done}개 완료했어요` : '오늘도 가볍게 시작해요'}</h2><p>${active.length-done}개의 할 일이 남아 있어요</p></div><div class="completion-ring" style="--progress:${ratio}%"><span><b>${done}</b><small>/ ${active.length}</small></span></div></section>`;
      html += toolbar() + `<div id="task-results">${renderTaskList()}</div>`;
    }
    $('#screen').innerHTML = html;
  } else if (page==='history') {
    $('#screen').innerHTML = heading('완료 기록','하나씩 쌓이는 나의 모험. 완료를 취소하면 해당 기록도 취소돼요.') + (state.history.length ? `<div class="history-list">${state.history.map(h=>`<article><span class="history-check">✓</span><div><strong>${esc(h.name)}</strong><small>${esc(date(h.at,true))}</small></div><span>${h.target>1?`${fmt(h.current)} / ${fmt(h.target)}`:'완료'}</span></article>`).join('')}</div>` : '<div class="empty-small">아직 완료 기록이 없어요.<br>콘텐츠를 완료하면 자동으로 남겨 둘게요.</div>');
  } else renderSettings();
}
function renderSettings() {
  $('#screen').innerHTML = heading('반복과 설정','체크 초기화는 한국 시간 기준. 꺼둔 사이 지난 시간도 다음 실행에 반영해요.') + `<section class="settings-block"><div class="section-heading"><h2>나의 반복 규칙</h2><button class="soft" data-new-rule>＋ 규칙 추가</button></div><div class="rule-list">${state.rules.map(r=>`<article><span class="rule-icon">↻</span><div><strong>${esc(r.name)}</strong><small>${esc(ruleLabel(r))}${r.kind==='interval'?` · ${esc(r.anchor)}부터`:''}</small></div><span class="usage">${state.tasks.filter(t=>t.ruleId===r.id).length}개 사용</span><button class="ghost" data-edit-rule="${esc(r.id)}">수정</button>${state.tasks.some(t=>t.ruleId===r.id)?'':`<button class="ghost muted" data-delete-rule="${esc(r.id)}">삭제</button>`}</article>`).join('')}</div></section><section class="settings-block"><h2>데이터 보관</h2><p>체크할 때마다 이 PC에 저장돼요. 파일로 내보내 두면 나중에 그대로 복원할 수 있어요.</p><div class="button-row"><a class="button soft" href="/api/backup" download>↓ 백업 내보내기</a><label class="button ghost file-button">↑ 백업 복원<input id="restore-file" type="file" accept=".json,application/json"></label></div><p class="field-hint">실행할 때 자동 백업도 남겨요. Google 시트와는 별도로 저장돼요.</p></section><section class="settings-block"><h2>앱 종료</h2><p>창을 닫아도 저장 프로그램은 실행 중이에요. 완전히 종료하려면 아래 버튼을 눌러 주세요.</p><button class="ghost" id="shutdown">앱 완전히 종료</button></section>`;
}
function navigate(next) { page = ['dashboard','contents','history','settings'].includes(next) ? next : 'dashboard'; filter = 'all'; search = ''; render(); }
function showEditor(source = {}, id = null) {
  editingId = id; $('#detail').close(); detailId = null;
  const f = $('#task-form'); f.reset(); $('#task-error').textContent = ''; $('#extra-fields').open = false;
  $('#editor-title').textContent = id ? '콘텐츠 수정' : '새 콘텐츠';
  f.elements.ruleId.innerHTML = '<option value="">반복 없음 · 장기 목표</option>' + state.rules.map(r=>`<option value="${esc(r.id)}">${esc(r.name)} · ${esc(ruleLabel(r))}</option>`).join('');
  for (const key of ['name','type','ruleId','category','notes','url','current','target']) if (source[key] != null) f.elements[key].value = source[key];
  f.elements.pinned.checked = source.pinned === true;
  stepDraft = structuredClone(source.steps || []); renderStepEditor(); updateType();
  $('#editor').showModal(); f.elements.name.focus();
}
function updateType() { const type = $('#task-form').elements.type.value; $('#counter-fields').hidden = type!=='counter'; $('#checklist-fields').hidden = type!=='checklist'; }
function renderStepEditor() { $('#step-editor').innerHTML = stepDraft.map((s,i)=>`<div class="step-edit-row"><input aria-label="세부 항목 ${i+1}" data-step-name="${i}" value="${esc(s.name)}" maxlength="120" placeholder="예: 첫 번째 레이드 동전"><button type="button" class="icon-button" data-remove-step="${i}" aria-label="세부 항목 ${i+1} 제거">×</button></div>`).join(''); }
function renderDetail() {
  const t = state.tasks.find(t=>t.id===detailId); if (!t) return;
  const percent = Math.min(100,Math.round(t.progress.current/t.progress.target*100)) || 0;
  $('#detail-content').innerHTML = `<div class="dialog-heading"><div><span class="eyebrow">CONTENT DETAILS</span><h2>${esc(t.name)}</h2></div><button class="icon-button" data-close aria-label="창 닫기">×</button></div><div class="detail-tags"><span>${esc(t.category)}</span><span>${esc(ruleLabel(state.rules.find(r=>r.id===t.ruleId)))}</span></div>
    <div class="detail-progress"><strong>${t.completed?'완료했어요':t.type==='check'?'아직 진행 중이에요':`${fmt(t.progress.current)} / ${fmt(t.progress.target)}`}</strong><span>${percent}%</span></div><div class="bar"><span style="width:${percent}%"></span></div>
    ${t.type==='counter'?`<label>현재 수량<input type="number" min="0" max="1000000000" step="1" data-current="${esc(t.id)}" value="${t.current}"></label>`:''}
    ${t.type==='checklist'?`<div class="detail-steps">${t.steps.map(s=>`<button class="step-item ${s.done?'done':''}" data-step-task="${esc(t.id)}" data-step-id="${esc(s.id)}" aria-pressed="${s.done}"><span class="step-check">${s.done?'✓':''}</span><span>${esc(s.name)}</span></button>`).join('')}</div>`:''}
    <button class="${t.completed?'soft':'primary'} wide" data-toggle="${esc(t.id)}">${t.completed?'완료 취소':t.type==='checklist'?'모두 완료':'완료로 표시'}</button>
    ${t.nextReset?`<p class="reset-note">↻ 다음 초기화 · ${esc(date(t.nextReset,true))}</p>`:''}
    ${t.notes?`<section class="detail-note"><h3>메모</h3><p>${esc(t.notes)}</p></section>`:''}${t.url?`<a class="resource-link" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">관련 링크 열기 ↗</a>`:''}
    <footer class="detail-footer"><button class="ghost" data-archive="${esc(t.id)}">${t.archived?'다시 꺼내기':'보관하기'}</button><div><button class="ghost" data-pin="${esc(t.id)}">${t.pinned?'고정 해제':'상단 고정'}</button><button class="primary" data-edit="${esc(t.id)}">수정</button></div></footer>`;
}
function showDetail(id) { detailId = id; renderDetail(); $('#detail').showModal(); }
function showRule(id = null) {
  ruleId = id; const f = $('#rule-form'); f.reset(); $('#rule-error').textContent = '';
  const r = state.rules.find(r=>r.id===id); if(r) for (const [k,v] of Object.entries(r)) if (f.elements[k]) f.elements[k].value = v;
  if (!r) f.elements.day.value = '2'; $('#rule-title').textContent = id?'반복 규칙 수정':'반복 규칙 추가';
  updateRuleFields(); $('#rule-editor').showModal(); f.elements.name.focus();
}
function updateRuleFields() { const kind = $('#rule-form').elements.kind.value; $('#rule-day').hidden=kind!=='weekly'; $('#rule-date').hidden=kind!=='monthly'; $('#rule-interval').hidden=kind!=='interval'; }
function confirmAction(title,message) {
  return new Promise(resolve=>{ $('#confirm-title').textContent=title; $('#confirm-message').textContent=message; const d=$('#confirm-dialog');
    const finish=value=>{d.close(); $('#confirm-yes').onclick=null; $('#confirm-no').onclick=null; d.oncancel=null; resolve(value);};
    $('#confirm-yes').onclick=()=>finish(true); $('#confirm-no').onclick=()=>finish(false); d.oncancel=e=>{e.preventDefault();finish(false);}; d.showModal();
  });
}
document.addEventListener('click', async e=>{
  const b=e.target.closest('button, [data-template]'); if(!b || pending) return;
  try {
    if (b.matches('[data-close]')) { b.closest('dialog').close(); if(b.closest('dialog').id==='detail') detailId=null; }
    else if (b.dataset.page) { location.hash=b.dataset.page; navigate(b.dataset.page); }
    else if (b.id==='add-task' || b.hasAttribute('data-new')) showEditor();
    else if (b.dataset.template) showEditor(templates[b.dataset.template]);
    else if (b.dataset.detail) showDetail(b.dataset.detail);
    else if (b.dataset.edit) showEditor(state.tasks.find(t=>t.id===b.dataset.edit),b.dataset.edit);
    else if (b.dataset.toggle) await mutate({kind:'toggle',id:b.dataset.toggle});
    else if (b.dataset.plus) { const t=state.tasks.find(t=>t.id===b.dataset.plus); await mutate({kind:'setCurrent',id:t.id,value:t.current+1}); }
    else if (b.dataset.stepTask) await mutate({kind:'step',id:b.dataset.stepTask,stepId:b.dataset.stepId});
    else if (b.dataset.pin) await mutate({kind:'pin',id:b.dataset.pin});
    else if (b.dataset.archive) { await mutate({kind:'archive',id:b.dataset.archive},'보관 상태를 변경했어요.'); $('#detail').close(); detailId=null; }
    else if (b.dataset.filter) {filter=b.dataset.filter;render();}
    else if (b.dataset.mode) {mode=b.dataset.mode;localStorage.setItem('ffxiv-view',mode);render();}
    else if (b.id==='add-step') {stepDraft.push({name:'',done:false});renderStepEditor();$$('#step-editor input').at(-1)?.focus();}
    else if (b.hasAttribute('data-remove-step')) {stepDraft.splice(Number(b.dataset.removeStep),1);renderStepEditor();}
    else if (b.hasAttribute('data-new-rule')) showRule();
    else if (b.dataset.editRule) showRule(b.dataset.editRule);
    else if (b.dataset.deleteRule) {if(await confirmAction('반복 규칙 삭제','사용하지 않는 이 규칙을 삭제할까요?')) await mutate({kind:'deleteRule',id:b.dataset.deleteRule});}
    else if (b.hasAttribute('data-refresh')) await refresh();
    else if (b.id==='shutdown' && await confirmAction('앱을 종료할까요?','기록은 이미 저장돼 있어요. 다음에 실행 아이콘으로 다시 열 수 있어요.')) {
      await request('/api/shutdown',{method:'POST',headers:{'X-App-Token':state.token}}); clearInterval(poller);
      $('#save-status').textContent='종료됨'; $('#add-task').disabled=true; $('#screen').innerHTML='<div class="empty"><h1>안전하게 종료했어요</h1><p>이 창을 닫아도 돼요. 다음 모험에서 만나요.</p></div>';
    }
  } catch { /* mutate already displays the error and leaves the form open */ }
});
document.addEventListener('contextmenu',e=>{const task=e.target.closest('[data-task]'); if(task && !e.target.matches('input')){e.preventDefault();showDetail(task.dataset.task);}});
document.addEventListener('toggle',e=>{if(e.target.matches('.completed-list') && e.target.isConnected)completedExpanded=e.target.open;},true);
document.addEventListener('keydown',e=>{if(e.key==='Enter' && e.target.matches('[data-current]')){e.preventDefault();e.target.blur();}});
document.addEventListener('input',e=>{
  if(e.target.id==='search'){search=e.target.value;$('#task-results').innerHTML=renderTaskList();}
  if(e.target.hasAttribute('data-step-name')) stepDraft[Number(e.target.dataset.stepName)].name=e.target.value;
});
document.addEventListener('change', async e=>{
  if(e.target.name==='type') updateType();
  if(e.target.name==='kind') updateRuleFields();
  if(e.target.dataset.current){try { if(!e.target.reportValidity() || e.target.value==='') {render();return;} await mutate({kind:'setCurrent',id:e.target.dataset.current,value:e.target.value}); } catch {} }
  if(e.target.id==='restore-file') {
    const file=e.target.files[0]; if(!file)return;
    try {
      if(file.size>8*1024*1024) throw new Error('8MB 이하의 백업을 선택해 주세요.');
      const backup=JSON.parse(await file.text());
      if(!await confirmAction('백업으로 복원할까요?','현재 목록을 선택한 백업으로 교체해요. 현재 데이터는 복원 전 자동 백업으로 남겨요.')) return;
      state=await request('/api/restore',{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':state.token},body:JSON.stringify({backup,revision:state.revision})});render();toast('백업을 복원했어요.');
    } catch(err){toast(err.message);} finally {e.target.value='';}
  }
});
$('#task-form').addEventListener('submit',async e=>{
  e.preventDefault(); const f=e.target; const task=Object.fromEntries(new FormData(f)); task.pinned=f.elements.pinned.checked;task.steps=stepDraft;
  task.done=editingId ? state.tasks.find(t=>t.id===editingId)?.done : false;
  try {if(await mutate({kind:'saveTask',id:editingId,task},editingId?'수정했어요.':'콘텐츠를 추가했어요.'))$('#editor').close();} catch(err){$('#task-error').textContent=err.message;}
});
$('#rule-form').addEventListener('submit',async e=>{e.preventDefault();try {if(await mutate({kind:'saveRule',id:ruleId,rule:Object.fromEntries(new FormData(e.target))},'반복 규칙을 저장했어요.'))$('#rule-editor').close();}catch(err){$('#rule-error').textContent=err.message;}});
window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));
window.addEventListener('focus',()=>{if(!pending && !document.querySelector('dialog[open]'))refresh();});
page = ['dashboard','contents','history','settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard';
await refresh();
const poller=setInterval(()=>{if(!pending && !document.hidden && !document.querySelector('dialog[open]') && !document.activeElement?.matches('input,textarea,select'))refresh();},30000);
