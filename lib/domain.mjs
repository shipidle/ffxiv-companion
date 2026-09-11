import { randomUUID } from 'node:crypto';

const DAY = 86400000;
const KST = 9 * 3600000;
export const MAX_VALUE = 1000000000;
export function initialState() {
  return { version: 1, revision: 0, tasks: [], history: [], rules: [
    { id: 'daily', name: '매일 자정', kind: 'daily', time: '00:00' },
    { id: 'weekly', name: '매주 화요일', kind: 'weekly', day: 2, time: '17:00' },
    { id: 'gc', name: '매일 오전 5시', kind: 'daily', time: '05:00' }
  ] };
}
function fail(message) { throw new Error(message); }
function str(value, max = 120) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function number(value, fallback = 0) {
  if (value === '' || value == null) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_VALUE) fail('수량은 0부터 1,000,000,000까지의 정수로 입력해 주세요.');
  return n;
}
export function cleanRule(input, id = randomUUID()) {
  const name = str(input.name);
  if (!name) fail('반복 규칙 이름을 입력해 주세요.');
  if (!['daily', 'weekly', 'monthly', 'interval'].includes(input.kind)) fail('반복 주기를 선택해 주세요.');
  const time = input.time || '00:00';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail('시간을 확인해 주세요.');
  const rule = { id, name, kind: input.kind, time };
  if (rule.kind === 'weekly') { rule.day = number(input.day, 2); if (rule.day > 6) fail('요일을 확인해 주세요.'); }
  if (rule.kind === 'monthly') { rule.date = number(input.date, 1); if (rule.date < 1 || rule.date > 31) fail('날짜는 1~31일로 입력해 주세요.'); }
  if (rule.kind === 'interval') {
    rule.days = number(input.days, 2);
    rule.anchor = str(input.anchor, 10);
    const parsed = new Date(rule.anchor + 'T00:00:00Z');
    if (!rule.days || rule.days > 365 || !/^\d{4}-\d{2}-\d{2}$/.test(rule.anchor) || !Number.isFinite(+parsed) || parsed.toISOString().slice(0,10) !== rule.anchor) fail('간격(1~365일)과 시작일을 확인해 주세요.');
  }
  return rule;
}
// Fixed Asia/Seoul calendar. No dependency on the PC's local time zone.
export function boundaries(rule, now = Date.now()) {
  if (!rule) return { start: null, next: null };
  const local = new Date(now + KST);
  const [h, m] = rule.time.split(':').map(Number);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m) - KST;
  let start, next;
  if (rule.kind === 'daily') {
    start = midnight > now ? midnight - DAY : midnight; next = start + DAY;
  } else if (rule.kind === 'weekly') {
    start = midnight - ((local.getUTCDay() - rule.day + 7) % 7) * DAY;
    if (start > now) start -= 7 * DAY;
    next = start + 7 * DAY;
  } else if (rule.kind === 'monthly') {
    const at = (delta) => {
      const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + delta, 1));
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), Math.min(rule.date, last), h, m) - KST;
    };
    start = at(0); if (start > now) { start = at(-1); next = at(0); } else next = at(1);
  } else {
    const base = Date.parse(rule.anchor + 'T' + rule.time + ':00+09:00');
    const span = rule.days * DAY;
    if (now < base) { start = null; next = base; }
    else { start = base + Math.floor((now - base) / span) * span; next = start + span; }
  }
  return { start: start == null ? null : new Date(start).toISOString(), next: new Date(next).toISOString() };
}
export function progress(task) {
  if (task.type === 'checklist') return { current: task.steps.filter(s => s.done).length, target: task.steps.length };
  if (task.type === 'counter') return { current: task.current, target: task.target };
  return { current: task.done ? 1 : 0, target: 1 };
}
export function isDone(task) { const p = progress(task); return p.target > 0 && p.current >= p.target; }
export function cleanTask(input, rules, previous = null, now = Date.now()) {
  const name = str(input.name); if (!name) fail('이름을 입력해 주세요.');
  const type = input.type || 'check';
  if (!['check', 'counter', 'checklist'].includes(type)) fail('진행 방식을 선택해 주세요.');
  const ruleId = input.ruleId || null;
  if (ruleId && !rules.some(r => r.id === ruleId)) fail('반복 규칙을 다시 선택해 주세요.');
  const task = { id: previous?.id || randomUUID(), name, type, ruleId, category: str(input.category || '기타', 40),
    pinned: input.pinned === true, archived: previous?.archived || false, notes: str(input.notes, 5000),
    url: str(input.url, 2000), current: number(input.current), target: number(input.target, 1),
    done: input.done === true, steps: [], createdAt: previous?.createdAt || new Date(now).toISOString(),
    cycle: previous?.cycle ?? boundaries(rules.find(r => r.id === ruleId), now).start };
  if (task.url && !/^https?:\/\//i.test(task.url)) fail('링크는 https:// 또는 http:// 주소로 입력해 주세요.');
  if (type === 'counter' && task.target < 1) fail('목표 수량은 1 이상이어야 해요.');
  if (type === 'checklist') {
    if (!Array.isArray(input.steps) || !input.steps.length || input.steps.length > 100) fail('세부 항목을 1~100개 입력해 주세요.');
    const oldSteps = new Map((previous?.steps || []).map(s => [s.id, s]));
    const used = new Set();
    task.steps = input.steps.map(s => {
      const name = str(s.name); if (!name) fail('빈 세부 항목은 지워 주세요.');
      let id = oldSteps.has(s.id) ? s.id : randomUUID();
      if (used.has(id)) id = randomUUID(); used.add(id);
      return { id, name, done: s.done === true };
    });
  }
  if (previous && previous.ruleId !== ruleId) task.cycle = boundaries(rules.find(r => r.id === ruleId), now).start;
  return task;
}
function historyKey(task) { return task.id + ':' + (task.cycle || 'once'); }
export function recordChange(state, task, now = Date.now()) {
  const key = historyKey(task);
  const existing = state.history.find(h => h.key === key);
  if (isDone(task)) {
    if (!existing) state.history.unshift({ key, taskId: task.id, name: task.name, at: new Date(now).toISOString(), cycle: task.cycle, ...progress(task) });
  } else state.history = state.history.filter(h => h.key !== key);
}
export function advance(state, now = Date.now()) {
  let changed = false;
  for (const task of state.tasks) {
    const rule = state.rules.find(r => r.id === task.ruleId);
    if (!rule) continue;
    const { start } = boundaries(rule, now);
    if (start && (!task.cycle || start > task.cycle)) {
      task.done = false; task.current = 0; task.steps.forEach(s => { s.done = false; });
      task.cycle = start; changed = true;
    }
  }
  return changed;
}
export function viewState(state, now = Date.now()) {
  return { ...state, serverTime: new Date(now).toISOString(), tasks: state.tasks.map(task => ({ ...task,
    completed: isDone(task), progress: progress(task), nextReset: boundaries(state.rules.find(r => r.id === task.ruleId), now).next })) };
}
export function applyAction(state, action, now = Date.now()) {
  const { kind } = action;
  if (kind === 'saveTask') {
    const index = state.tasks.findIndex(t => t.id === action.id);
    if (action.id && index < 0) fail('항목을 찾을 수 없어요.');
    const previous = index >= 0 ? state.tasks[index] : null;
    const task = cleanTask(action.task || {}, state.rules, previous, now);
    if (previous && previous.ruleId !== task.ruleId) {
      state.history = state.history.filter(h => h.key !== historyKey(previous));
    }
    if (index >= 0) state.tasks[index] = task; else state.tasks.push(task);
    recordChange(state, task, now);
  } else if (['toggle', 'setCurrent', 'step', 'archive', 'pin'].includes(kind)) {
    const task = state.tasks.find(t => t.id === action.id); if (!task) fail('항목을 찾을 수 없어요.');
    if (kind === 'toggle') {
      const done = !isDone(task);
      if (task.type === 'counter') task.current = done ? task.target : 0;
      else if (task.type === 'checklist') task.steps.forEach(s => { s.done = done; });
      else task.done = done;
    } else if (kind === 'setCurrent') { if (task.type !== 'counter') fail('수량 항목이 아니에요.'); task.current = number(action.value); }
    else if (kind === 'step') { const step = task.steps.find(s => s.id === action.stepId); if (!step) fail('단계를 찾을 수 없어요.'); step.done = !step.done; }
    else if (kind === 'archive') task.archived = !task.archived;
    else task.pinned = !task.pinned;
    if (['toggle','setCurrent','step'].includes(kind)) recordChange(state, task, now);
  } else if (kind === 'saveRule') {
    const index = state.rules.findIndex(r => r.id === action.id);
    if (action.id && index < 0) fail('규칙을 찾을 수 없어요.');
    const rule = cleanRule(action.rule || {}, action.id || randomUUID());
    if (index >= 0) state.rules[index] = rule; else state.rules.push(rule);
    // Editing a schedule preserves this cycle's checks and rebases the next reset.
    for (const t of state.tasks.filter(t => t.ruleId === rule.id)) {
      const oldKey = historyKey(t); t.cycle = boundaries(rule, now).start;
      const entry = state.history.find(h => h.key === oldKey);
      if (entry) { entry.key = historyKey(t); entry.cycle = t.cycle; }
    }
  } else if (kind === 'deleteRule') {
    if (state.tasks.some(t => t.ruleId === action.id)) fail('사용 중인 규칙이에요. 콘텐츠의 반복 규칙을 먼저 바꿔 주세요.');
    state.rules = state.rules.filter(r => r.id !== action.id);
  } else fail('알 수 없는 요청이에요.');
  return state;
}

export function validateBackup(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.tasks) || !Array.isArray(data.rules) || !Array.isArray(data.history)) fail('이 앱에서 내보낸 백업 파일을 선택해 주세요.');
  if (data.tasks.length > 10000 || data.rules.length > 1000 || data.history.length > 100000) fail('백업 파일이 너무 커요.');
  const ids = new Set();
  function id(value) { if (typeof value !== 'string' || !value || value.length > 120 || ids.has(value)) fail('백업의 ID가 올바르지 않아요.'); ids.add(value); return value; }
  const rules = data.rules.map(r => cleanRule(r, id(r.id)));
  const tasks = data.tasks.map(t => {
    id(t.id);
    const cleaned = cleanTask(t, rules, t);
    if (t.cycle !== null && (typeof t.cycle !== 'string' || !Number.isFinite(Date.parse(t.cycle)))) fail('백업의 주기 값이 올바르지 않아요.');
    cleaned.cycle = t.cycle; cleaned.archived = t.archived === true;
    return cleaned;
  });
  const keys = new Set();
  const history = data.history.map(h => {
    if (!h || typeof h.key !== 'string' || keys.has(h.key) || !Number.isFinite(Date.parse(h.at))) fail('완료 기록이 올바르지 않아요.');
    keys.add(h.key);
    return { key: str(h.key, 300), taskId: str(h.taskId), name: str(h.name), at: new Date(h.at).toISOString(), cycle: h.cycle || null, current: number(h.current), target: number(h.target, 1) };
  });
  return { version: 1, revision: 0, tasks, rules, history };
}
