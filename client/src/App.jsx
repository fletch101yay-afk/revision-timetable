import { useState, useEffect, useRef, useCallback } from 'react';
import { EXAMS, COLOURS } from './exams.js';
import {
  generateSchedule, resetSchedule, calcAllPriorities,
  toEpoch, toMins, addDays, fmtTime, fmtMs,
  DEFAULT_WEIGHTS, DEFAULT_TODOS,
} from './schedule.js';

const START_DATE = '2026-05-08';
const END_DATE   = '2026-06-15';
const USER_ID    = (() => {
  const urlId = new URLSearchParams(window.location.search).get('uid');
  if (urlId) { localStorage.setItem('rt_uid', urlId); return urlId; }
  let id = localStorage.getItem('rt_uid');
  if (!id) { id = Math.random().toString(36).slice(2, 12); localStorage.setItem('rt_uid', id); }
  return id;
})();
const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const PX_PER_MIN  = 1.5;
const CAL_START   = 6 * 60;
const CAL_END     = 21 * 60;
const GUTTER_W    = 52;
const TODO_COLORS = ['#a78bfa','#34d399','#fb923c','#f472b6','#60a5fa','#facc15'];

// ── helpers ───────────────────────────────────────────────────────────────────
function todayDs() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function nowMins() { const d = new Date(); return d.getHours()*60 + d.getMinutes(); }
function fmtDateLabel(ds) {
  const [y,m,d] = ds.split('-').map(Number);
  const dt = new Date(y,m-1,d);
  return `${DAY_NAMES[dt.getDay()]} ${d} ${MONTH_NAMES[m-1]} ${y}`;
}
function clamp(ds) { return ds < START_DATE ? START_DATE : ds > END_DATE ? END_DATE : ds; }
function normalizeWeights(w) {
  const u=w?.urgency??48, r=w?.recency??32, d=w?.difficulty??14, a=w?.alevel??6;
  const t=u+r+d+a; if(t===0) return DEFAULT_WEIGHTS;
  return { urgency:u/t, recency:r/t, difficulty:d/t, alevel:a/t };
}
function toTimeStr(mins) {
  return `${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
}
function fromTimeStr(str) { const [h,m]=str.split(':').map(Number); return h*60+m; }
function migrateTodos(raw) {
  if (!raw || raw.length === 0 || typeof raw[0] === 'string') return [...DEFAULT_TODOS];
  return raw.map(t => ({ ...t, days: Array.isArray(t.days) ? t.days : [] }));
}

// ── API ───────────────────────────────────────────────────────────────────────
async function apiGet() { return (await fetch(`/api/state?uid=${USER_ID}`)).json(); }
function apiPost(s) {
  fetch(`/api/state?uid=${USER_ID}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(s) }).catch(()=>{});
}

// ── hooks ─────────────────────────────────────────────────────────────────────
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t=setInterval(()=>setNow(new Date()),1000); return ()=>clearInterval(t); },[]);
  return now;
}
function haptic(p) { if(navigator.vibrate) navigator.vibrate(p); }

// ── EditModal ─────────────────────────────────────────────────────────────────
function EditModal({ item, onSaveSession, onSaveTodo, onClose }) {
  const isTodo = item.type === 'todo';
  const [name, setName]       = useState(item.name || item.label || '');
  const [startMin, setStart]  = useState(item.start);
  const [endMin, setEnd]      = useState(item.end);
  const [days, setDays]       = useState(item.days || []);
  const [color, setColor]     = useState(item.todoColor || item.color || TODO_COLORS[0]);

  const toggleDay = i => setDays(d => d.includes(i) ? d.filter(x=>x!==i) : [...d,i]);

  function save() {
    if (endMin <= startMin) return;
    if (isTodo) onSaveTodo({ ...item, name, start:startMin, end:endMin, days, color });
    else onSaveSession(item.id, startMin, endMin);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e=>e.stopPropagation()}>
        <div className="modal-title">{isTodo ? 'Edit Task' : 'Edit Session'}</div>

        {isTodo && (
          <div className="modal-field">
            <label>Name</label>
            <input className="modal-input" value={name} onChange={e=>setName(e.target.value)} />
          </div>
        )}

        <div className="modal-row-2">
          <div className="modal-field">
            <label>Start</label>
            <input type="time" className="modal-input" value={toTimeStr(startMin)} onChange={e=>setStart(fromTimeStr(e.target.value))} />
          </div>
          <div className="modal-field">
            <label>End</label>
            <input type="time" className="modal-input" value={toTimeStr(endMin)} onChange={e=>setEnd(fromTimeStr(e.target.value))} />
          </div>
        </div>

        {isTodo && (
          <>
            <div className="modal-field">
              <label>Days <span className="modal-hint">(none = every day)</span></label>
              <div className="days-picker">
                {['Su','Mo','Tu','We','Th','Fr','Sa'].map((d,i) => (
                  <button key={i} className={`day-chip${days.includes(i)?' active':''}`} onClick={()=>toggleDay(i)}>{d}</button>
                ))}
              </div>
            </div>
            <div className="modal-field">
              <label>Colour</label>
              <div className="color-picker">
                {TODO_COLORS.map(c => (
                  <button key={c} className={`color-swatch${color===c?' active':''}`}
                    style={{ background:c }} onClick={()=>setColor(c)} />
                ))}
              </div>
            </div>
          </>
        )}

        {endMin <= startMin && <div className="modal-error">End must be after start</div>}

        <div className="modal-actions">
          <button className="modal-btn modal-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="modal-btn modal-btn-save" onClick={save} disabled={endMin<=startMin}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ── CalendarView ──────────────────────────────────────────────────────────────
function CalendarView({ schedule, state, activeSession, now, viewDs, onStart, onStop, onDone, onSkip, onBlockClick, editingId }) {
  const containerRef = useRef(null);
  const isToday = viewDs === todayDs();
  const curMins = now.getHours()*60 + now.getMinutes();

  useEffect(() => {
    if (!containerRef.current) return;
    const t = isToday ? Math.max(0,(curMins-CAL_START)*PX_PER_MIN-160) : 0;
    containerRef.current.scrollTop = t;
  }, [viewDs]); // eslint-disable-line

  const totalH = (CAL_END-CAL_START)*PX_PER_MIN;

  const hourLines = [];
  for (let h=6; h<=21; h++) {
    const top=(h*60-CAL_START)*PX_PER_MIN;
    hourLines.push(
      <div key={h} style={{ position:'absolute',top,left:0,right:0,display:'flex',alignItems:'center',pointerEvents:'none' }}>
        <div style={{ width:GUTTER_W,textAlign:'right',paddingRight:8,fontSize:11,color:'#666',transform:'translateY(-50%)',lineHeight:1,flexShrink:0 }}>
          {h<21?`${String(h).padStart(2,'0')}:00`:''}
        </div>
        <div style={{ flex:1,height:1,background:'rgba(255,255,255,0.05)' }} />
      </div>
    );
  }

  const blocks = schedule.map(item => {
    const cs = Math.max(item.start, CAL_START);
    const ce = Math.min(item.end, CAL_END);
    if (ce<=cs || item.start>=CAL_END || item.end<=CAL_START) return null;

    const top=(cs-CAL_START)*PX_PER_MIN;
    const height=Math.max((ce-cs)*PX_PER_MIN,24);

    const isDone    = item.type==='study' && state.done.includes(item.id);
    const isSkipped = item.type==='study' && state.skip.includes(item.id);
    const isRunning = item.type==='study' && activeSession?.id===item.id;
    const isEditing = editingId===item.id;

    const elapsed = item.type==='study'
      ? (state.timers[item.id]?.total||0)+(isRunning?(now.getTime()-activeSession.startTime):0)
      : 0;

    const color = (item.type==='study'||item.type==='exam') ? (COLOURS[item.subj]||'#94a3b8') : (item.todoColor||'#94a3b8');
    let bg, border, textCol;
    if (isRunning) {
      bg=color; border=`2px solid ${color}`; textCol='#fff';
    } else if (item.type==='study'||item.type==='exam'||item.type==='todo') {
      bg=color+'28'; border=`1.5px solid ${color}60`; textCol=color;
    } else if (item.type==='travel') {
      bg='rgba(32,144,176,0.14)'; border='1px solid rgba(32,144,176,0.3)'; textCol='#2090b0';
    } else if (item.type==='review') {
      bg='rgba(192,136,40,0.14)'; border='1px solid rgba(192,136,40,0.3)'; textCol='#c08828';
    } else {
      bg='rgba(255,255,255,0.03)'; border='1px solid rgba(255,255,255,0.07)'; textCol='#888';
    }

    const clickable = item.type==='study'||item.type==='todo';

    return (
      <div key={item.id||`${item.type}-${item.start}`}
        onClick={clickable ? ()=>onBlockClick(item) : undefined}
        style={{
          position:'absolute',top,left:GUTTER_W+4,right:4,height,
          background:bg,border,borderRadius:8,color:textCol,
          overflow:'hidden',zIndex:isRunning?10:5,
          opacity:isDone?0.4:isSkipped?0.28:1,
          display:'flex',alignItems:'center',
          cursor:clickable?'pointer':'default',
          outline:isEditing?'2px solid rgba(255,255,255,0.45)':'none',
          outlineOffset:1,
          transition:'opacity 0.2s,outline 0.1s',
          padding:'0 6px',gap:6,
        }}
      >
        {/* Label + time on the left */}
        <div style={{ flex:1,minWidth:0,overflow:'hidden' }}>
          <div style={{ fontSize:12,fontWeight:700,lineHeight:1.3,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis' }}>
            {item.label}{item.sublabel?` · ${item.sublabel}`:''}
          </div>
          {height>=30&&(
            <div style={{ fontSize:10,opacity:0.7,marginTop:1,lineHeight:1.2,whiteSpace:'nowrap' }}>
              {item.startFmt}–{item.endFmt}{item.seat?` · Seat ${item.seat}`:''}
            </div>
          )}
          {isRunning&&elapsed>0&&height>=52&&(
            <div style={{ fontSize:12,fontWeight:700,marginTop:2,fontVariantNumeric:'tabular-nums' }}>{fmtMs(elapsed)}</div>
          )}
        </div>
        {/* Action buttons on the right */}
        {item.type==='study'&&!isDone&&!isSkipped&&(
          <div style={{ display:'flex',gap:3,flexShrink:0,alignItems:'center' }}>
            {!isRunning?(
              <>
                <button className="cal-btn cal-btn-start" style={{ padding:'0 8px',height:26,fontSize:11 }}
                  onClick={e=>{e.stopPropagation();onStart(item);}}>▶</button>
                <button className="cal-btn cal-btn-skip" style={{ padding:'0 6px',height:26,fontSize:11 }}
                  onClick={e=>{e.stopPropagation();onSkip(item.id);}}>Skip</button>
              </>
            ):(
              <>
                <button className="cal-btn cal-btn-stop" style={{ padding:'0 6px',height:26,fontSize:11 }}
                  onClick={e=>{e.stopPropagation();onStop(item);}}>■</button>
                <button className="cal-btn cal-btn-done" style={{ padding:'0 6px',height:26,fontSize:11 }}
                  onClick={e=>{e.stopPropagation();onDone(item);}}>Done</button>
                <button className="cal-btn cal-btn-skip" style={{ padding:'0 6px',height:26,fontSize:11 }}
                  onClick={e=>{e.stopPropagation();onSkip(item.id);}}>Skip</button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }).filter(Boolean);

  return (
    <div ref={containerRef} className="cal-scroll">
      <div style={{ position:'relative',height:totalH,minWidth:'100%' }}>
        {hourLines}
        {isToday&&curMins>=CAL_START&&curMins<=CAL_END&&(
          <div style={{ position:'absolute',top:(curMins-CAL_START)*PX_PER_MIN,left:0,right:0,zIndex:20,display:'flex',alignItems:'center',pointerEvents:'none' }}>
            <div style={{ width:GUTTER_W,textAlign:'right',paddingRight:6,fontSize:10,color:'#c08828',fontWeight:700,flexShrink:0 }}>{fmtTime(curMins)}</div>
            <div style={{ width:8,height:8,borderRadius:'50%',background:'#c08828',flexShrink:0 }} />
            <div style={{ flex:1,height:2,background:'#c08828',borderRadius:1 }} />
          </div>
        )}
        {blocks}
      </div>
    </div>
  );
}

// ── PriorityBars ──────────────────────────────────────────────────────────────
function PriorityBars({ priorities }) {
  if(!priorities.length) return <p className="dim-text">No upcoming exams</p>;
  const max=priorities[0].pri;
  return (
    <div className="pri-bars">
      {priorities.map(({subj,pri})=>(
        <div className="pri-row" key={subj}>
          <div className="pri-label" title={subj}>{subj}</div>
          <div className="pri-bar-bg">
            <div className="pri-bar-fill" style={{ width:`${(pri/max)*100}%`,background:COLOURS[subj]||'#888' }} />
          </div>
          <div className="pri-val">{pri}</div>
        </div>
      ))}
    </div>
  );
}

// ── PrioritySliders ───────────────────────────────────────────────────────────
const WEIGHT_KEYS=[{key:'urgency',label:'Urgency'},{key:'recency',label:'Recency'},{key:'difficulty',label:'Difficulty'},{key:'alevel',label:'A-Level'}];

function PrioritySliders({ weights, onChange }) {
  const w=weights||{urgency:48,recency:32,difficulty:14,alevel:6};
  return (
    <div className="sliders">
      {WEIGHT_KEYS.map(({key,label})=>(
        <div className="slider-row" key={key}>
          <div className="slider-label">{label}</div>
          <input type="range" min="0" max="100" value={w[key]} className="slider-input"
            onChange={e=>onChange({...w,[key]:Number(e.target.value)})} />
          <div className="slider-val">{w[key]}</div>
        </div>
      ))}
    </div>
  );
}

// ── UpcomingExams ─────────────────────────────────────────────────────────────
function UpcomingExams({ now }) {
  const ep=toEpoch(todayDs(),nowMins());
  const upcoming=EXAMS.filter(e=>toEpoch(e.date,toMins(e.start))>ep)
    .sort((a,b)=>toEpoch(a.date,toMins(a.start))-toEpoch(b.date,toMins(b.start))).slice(0,10);
  return (
    <div className="exam-list">
      {upcoming.map(ex=>{
        const d=Math.ceil((toEpoch(ex.date,toMins(ex.start))-now.getTime())/86400000);
        return (
          <div className="exam-item" key={ex.id}>
            <div className="exam-dot" style={{ background:COLOURS[ex.subj]||'#888' }} />
            <div className="exam-info">
              <div className="exam-info-title">{ex.subj}</div>
              <div className="exam-info-paper">{ex.paper} · {ex.date} {ex.start}</div>
            </div>
            <div className={`exam-countdown${d<=3?' soon':''}`}>{d===0?'Today':d===1?'Tomorrow':`${d}d`}</div>
          </div>
        );
      })}
      {!upcoming.length&&<p className="dim-text">All done!</p>}
    </div>
  );
}

// ── TodoList ──────────────────────────────────────────────────────────────────
function TodoList({ todos, onAdd, onDelete, onEdit }) {
  const [open, setOpen]       = useState(false);
  const [name, setName]       = useState('');
  const [startMin, setStart]  = useState(9*60);
  const [endMin, setEnd]      = useState(10*60);
  const [recurring, setRecur] = useState(false);
  const [days, setDays]       = useState([]);
  const [color, setColor]     = useState(TODO_COLORS[0]);

  const toggleDay = i => setDays(d=>d.includes(i)?d.filter(x=>x!==i):[...d,i]);

  function add() {
    if (!name.trim()||endMin<=startMin) return;
    onAdd({ name:name.trim(), start:startMin, end:endMin, days:recurring?days:[], color });
    setName(''); setStart(9*60); setEnd(10*60); setRecur(false); setDays([]); setOpen(false);
  }

  return (
    <div>
      {/* Existing todos */}
      <div className="todo-list">
        {todos.map(t=>(
          <div className="todo-item" key={t.id}>
            <div className="todo-dot" style={{ background:t.color||TODO_COLORS[0] }} />
            <div className="todo-info">
              <div className="todo-name">{t.name}</div>
              <div className="todo-meta">
                {toTimeStr(t.start)}–{toTimeStr(t.end)}
                {t.days?.length>0&&` · ${t.days.map(d=>['Su','Mo','Tu','We','Th','Fr','Sa'][d]).join(', ')}`}
                {(!t.days||t.days.length===0)&&' · Every day'}
              </div>
            </div>
            <button className="todo-edit-btn" onClick={()=>onEdit(t)}>Edit</button>
            <button className="todo-delete" onClick={()=>onDelete(t.id)}>×</button>
          </div>
        ))}
        {!todos.length&&<p className="dim-text" style={{ marginBottom:8 }}>No tasks yet.</p>}
      </div>

      {/* Add form */}
      <button className="add-task-btn" onClick={()=>setOpen(o=>!o)}>{open?'▲ Cancel':'+ Add Task'}</button>
      {open&&(
        <div className="add-task-form">
          <input className="modal-input" placeholder="Task name" value={name} onChange={e=>setName(e.target.value)} />
          <div className="modal-row-2">
            <div className="modal-field">
              <label>Start</label>
              <input type="time" className="modal-input" value={toTimeStr(startMin)} onChange={e=>setStart(fromTimeStr(e.target.value))} />
            </div>
            <div className="modal-field">
              <label>End</label>
              <input type="time" className="modal-input" value={toTimeStr(endMin)} onChange={e=>setEnd(fromTimeStr(e.target.value))} />
            </div>
          </div>
          <div className="modal-field">
            <label className="recur-label">
              <input type="checkbox" checked={recurring} onChange={e=>setRecur(e.target.checked)} style={{ marginRight:6 }} />
              Only on specific days
            </label>
          </div>
          {recurring&&(
            <div className="modal-field">
              <div className="days-picker">
                {['Su','Mo','Tu','We','Th','Fr','Sa'].map((d,i)=>(
                  <button key={i} className={`day-chip${days.includes(i)?' active':''}`} onClick={()=>toggleDay(i)}>{d}</button>
                ))}
              </div>
            </div>
          )}
          <div className="modal-field">
            <label>Colour</label>
            <div className="color-picker">
              {TODO_COLORS.map(c=>(
                <button key={c} className={`color-swatch${color===c?' active':''}`} style={{ background:c }} onClick={()=>setColor(c)} />
              ))}
            </div>
          </div>
          <button className="btn btn-primary" style={{ width:'100%',marginTop:4 }} onClick={add} disabled={!name.trim()||endMin<=startMin}>Add Task</button>
        </div>
      )}
    </div>
  );
}

// ── iPhone instructions ───────────────────────────────────────────────────────
function IphonePanel({ onApplyId }) {
  const [ips, setIps]       = useState([]);
  const [open, setOpen]     = useState(false);
  const [copied, setCopied] = useState('');
  const [customId, setCustomId] = useState(USER_ID);

  useEffect(() => {
    fetch('/api/ip').then(r=>r.json()).then(d=>setIps(d.addresses||[])).catch(()=>{});
  }, []);

  function copy(text, key) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key); setTimeout(() => setCopied(''), 2000);
    }).catch(() => {});
  }

  function applyId() {
    const safe = customId.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
    if (!safe || safe === USER_ID) return;
    onApplyId(safe);
  }

  const fwCmd = 'netsh advfirewall firewall add rule name="RevisionApp" dir=in action=allow protocol=TCP localport=3001';

  return (
    <div className="card">
      <button className="iphone-toggle" onClick={()=>setOpen(o=>!o)}>
        iPhone / tablet access &nbsp;{open?'▲':'▼'}
      </button>
      {open&&(
        <div className="iphone-body">

          <div className="iphone-step">
            <span className="iphone-step-num">1</span>
            <div>
              <strong>Same Wi-Fi</strong> — connect your phone to the same network as this computer.
              <br/><span style={{color:'#777',fontSize:12}}>You can only access this when on the same Wi-Fi. It won't work over mobile data or a different network.</span>
            </div>
          </div>

          <div className="iphone-step">
            <span className="iphone-step-num">2</span>
            <div>
              <strong>Open Windows Firewall</strong> — run PowerShell <em>as Administrator</em> and paste this:
              <div className="iphone-code-row">
                <code>{fwCmd}</code>
                <button className="copy-btn" onClick={()=>copy(fwCmd,'fw')}>{copied==='fw'?'✓ Copied':'Copy'}</button>
              </div>
              <span style={{color:'#777',fontSize:12}}>Right-click the Start button → "Windows PowerShell (Admin)" → paste → Enter. Only need to do this once.</span>
            </div>
          </div>

          <div className="iphone-step">
            <span className="iphone-step-num">3</span>
            <div>
              <strong>Set a short sync code</strong> — replace the random ID with something easy to type on your phone:
              <div style={{display:'flex',gap:6,marginTop:6,marginBottom:4}}>
                <input className="modal-input" style={{flex:1,height:36,fontSize:13}} value={customId} onChange={e=>setCustomId(e.target.value)} placeholder="e.g. hugo" />
                <button className="copy-btn" style={{background:customId.trim()&&customId.trim()!==USER_ID?'rgba(192,136,40,0.25)':'rgba(255,255,255,0.06)'}} onClick={applyId}>Apply</button>
              </div>
              <span style={{color:'#777',fontSize:12}}>Clicking Apply saves your data under the new code and reloads the page. Your phone must use the same code in the URL.</span>
            </div>
          </div>

          <div className="iphone-step">
            <span className="iphone-step-num">4</span>
            <div>
              <strong>Open this link on your iPhone</strong> — it includes your sync code so data is shared:
              {ips.length>0 ? ips.map(ip=>{
                const url=`http://${ip}:3001/?uid=${USER_ID}`;
                return (
                  <div key={ip} className="iphone-code-row">
                    <code>{url}</code>
                    <button className="copy-btn" onClick={()=>copy(url,ip)}>{copied===ip?'✓ Copied':'Copy'}</button>
                  </div>
                );
              }) : (
                <div className="iphone-code-row">
                  <code>http://[your-pc-ip]:3001/?uid={USER_ID}</code>
                </div>
              )}
              <span style={{color:'#777',fontSize:12}}>The <code style={{display:'inline',fontSize:11,padding:'1px 4px'}}>?uid=…</code> part is your sync code — without it, your phone won't see your computer's data.</span>
            </div>
          </div>

          <div className="iphone-step">
            <span className="iphone-step-num">5</span>
            <div>
              <strong>Bookmark it</strong> — tap Share → "Add to Home Screen" in Safari for easy access.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const now   = useClock();
  const today = todayDs();

  const [viewDs, setViewDs]         = useState(clamp(today));
  const [state, setState]           = useState({ done:[],skip:[],timers:{},vd:today,lastSeen:{},todos:[...DEFAULT_TODOS],weights:{urgency:48,recency:32,difficulty:14,alevel:6} });
  const [activeSession, setActive]  = useState(null);
  const [loaded, setLoaded]         = useState(false);
  const [schedule, setSchedule]     = useState([]);
  const [todaySchedule, setTodaySch]= useState([]);
  const [priorities, setPriorities] = useState([]);
  const [editingItem, setEditing]   = useState(null);

  const stateRef      = useRef(state);
  const activeRef     = useRef(activeSession);
  const scheduleRef   = useRef([]);
  const lastFetchRef  = useRef(0);
  useEffect(()=>{ stateRef.current=state; },[state]);
  useEffect(()=>{ activeRef.current=activeSession; },[activeSession]);
  useEffect(()=>{ scheduleRef.current=schedule; },[schedule]);

  // Load
  useEffect(()=>{
    apiGet().then(s=>{
      lastFetchRef.current=Date.now();
      s.todos = migrateTodos(s.todos);
      setState(prev=>({...prev,...s}));
      if(s.vd&&s.vd>=START_DATE&&s.vd<=END_DATE) setViewDs(s.vd);
      if(s.activeSessionId&&s.activeSessionSubj)
        setActive({id:s.activeSessionId,subj:s.activeSessionSubj,startTime:Date.now()});
      setLoaded(true);
    }).catch(()=>setLoaded(true));
  },[]);

  // Save helpers
  const saveTimerRef = useRef(null);
  const save = useCallback(s=>{
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current=setTimeout(()=>apiPost(s),300);
  },[]);
  const buildSnap = useCallback(()=>{
    const as=activeRef.current,s=stateRef.current;
    if(!as) return s;
    const elapsed=Date.now()-as.startTime;
    return{...s,timers:{...s.timers,[as.id]:{total:(s.timers[as.id]?.total||0)+elapsed}}};
  },[]);
  useEffect(()=>{
    const beacon=()=>{
      const blob=new Blob([JSON.stringify(buildSnap())],{type:'application/json'});
      navigator.sendBeacon(`/api/state?uid=${USER_ID}`,blob);
    };
    const onHide=()=>{ if(document.visibilityState==='hidden') beacon(); };
    document.addEventListener('visibilitychange',onHide);
    window.addEventListener('beforeunload',beacon);
    return()=>{ document.removeEventListener('visibilitychange',onHide); window.removeEventListener('beforeunload',beacon); };
  },[buildSnap]);
  useEffect(()=>{
    if(!activeSession) return;
    const t=setInterval(()=>{
      const elapsed=Date.now()-activeSession.startTime;
      apiPost({...stateRef.current,timers:{...stateRef.current.timers,[activeSession.id]:{total:(stateRef.current.timers[activeSession.id]?.total||0)+elapsed}}});
    },5000);
    return()=>clearInterval(t);
  },[activeSession]);

  // Re-fetch from server when tab becomes visible (phone picks up computer's data)
  useEffect(()=>{
    const onVisible=()=>{
      if(document.visibilityState==='hidden') return;
      if(activeRef.current) return;
      if(Date.now()-lastFetchRef.current<15000) return;
      lastFetchRef.current=Date.now();
      apiGet().then(s=>{
        s.todos=migrateTodos(s.todos);
        setState(prev=>({...prev,...s}));
        const newVd=s.vd&&s.vd>=START_DATE&&s.vd<=END_DATE?s.vd:viewDs;
        if(s.vd&&s.vd>=START_DATE&&s.vd<=END_DATE) setViewDs(s.vd);
        const ws=normalizeWeights(s.weights||{urgency:48,recency:32,difficulty:14,alevel:6});
        setSchedule(generateSchedule(newVd,s.lastSeen||{},ws,s.todos||DEFAULT_TODOS));
      }).catch(()=>{});
    };
    document.addEventListener('visibilitychange',onVisible);
    return()=>document.removeEventListener('visibilitychange',onVisible);
  },[]); // eslint-disable-line

  function updateState(fn) { setState(prev=>{ const next=fn(prev); save(next); return next; }); }

  // Schedule generation (stable per viewDs)
  useEffect(()=>{
    if(!loaded) return;
    const ws=normalizeWeights(stateRef.current.weights);
    const todos=stateRef.current.todos||DEFAULT_TODOS;
    setSchedule(generateSchedule(viewDs,stateRef.current.lastSeen||{},ws,todos));
  },[viewDs,loaded]);
  useEffect(()=>{
    if(!loaded) return;
    const ws=normalizeWeights(stateRef.current.weights);
    const todos=stateRef.current.todos||DEFAULT_TODOS;
    setTodaySch(generateSchedule(today,stateRef.current.lastSeen||{},ws,todos));
  },[today,loaded]);
  useEffect(()=>{
    setState(prev=>{ const next={...prev,vd:viewDs}; save(next); return next; });
  },[viewDs]); // eslint-disable-line

  // Priorities
  useEffect(()=>{
    const upd=()=>setPriorities(calcAllPriorities(today,nowMins(),stateRef.current.lastSeen||{},normalizeWeights(stateRef.current.weights)));
    upd(); const t=setInterval(upd,30000); return()=>clearInterval(t);
  },[today]);

  // Restart from now — also clears done/skip for sessions being replaced
  const handleRestart=useCallback(()=>{
    const fromMin=viewDs===todayDs()?nowMins():7*60;
    const ws=normalizeWeights(stateRef.current.weights);
    // IDs of study sessions that end after the cut (they'll be replaced by new sessions)
    const futureIds=new Set(scheduleRef.current.filter(i=>i.type==='study'&&i.end>fromMin).map(i=>i.id));
    updateState(s=>({...s,done:s.done.filter(id=>!futureIds.has(id)),skip:s.skip.filter(id=>!futureIds.has(id))}));
    setSchedule(prev=>resetSchedule(viewDs,fromMin,prev,stateRef.current.lastSeen||{},ws,stateRef.current.todos||[]));
  },[viewDs]); // eslint-disable-line

  // Weights change
  const handleWeightsChange=useCallback(newW=>{
    updateState(prev=>({...prev,weights:newW}));
    const ws=normalizeWeights(newW);
    const fromMin=viewDs===todayDs()?nowMins():7*60;
    setSchedule(prev=>resetSchedule(viewDs,fromMin,prev,stateRef.current.lastSeen||{},ws,stateRef.current.todos||[]));
  },[viewDs]); // eslint-disable-line

  // Block click → open modal
  const handleBlockClick=useCallback(item=>{
    setEditing(item);
  },[]);

  // Save edited study session (reset from min(newStart, oldStart))
  const handleSaveSession=useCallback((id,newStart,newEnd)=>{
    const ws=normalizeWeights(stateRef.current.weights);
    setSchedule(prev=>{
      const item=prev.find(i=>i.id===id);
      const resetFrom=item?Math.min(item.start,newStart):newStart;
      const updated=prev.map(i=>i.id!==id?i:{...i,start:newStart,end:newEnd,startFmt:fmtTime(newStart),endFmt:fmtTime(newEnd),duration:newEnd-newStart});
      return resetSchedule(viewDs,resetFrom,updated,stateRef.current.lastSeen||{},ws,stateRef.current.todos||[]);
    });
    setEditing(null);
  },[viewDs]);

  // Save edited todo (update todos, regenerate full schedule)
  const handleSaveTodo=useCallback(updated=>{
    const updatedTodos=(stateRef.current.todos||[]).map(t=>t.id!==updated.id?t:{...t,name:updated.name,start:updated.start,end:updated.end,days:updated.days,color:updated.color});
    updateState(prev=>({...prev,todos:updatedTodos}));
    const ws=normalizeWeights(stateRef.current.weights);
    setSchedule(generateSchedule(viewDs,stateRef.current.lastSeen||{},ws,updatedTodos));
    setEditing(null);
  },[viewDs]); // eslint-disable-line

  // Todo add
  const handleTodoAdd=useCallback(newTodo=>{
    const todo={id:`td-${Date.now()}`,name:newTodo.name,start:newTodo.start,end:newTodo.end,days:newTodo.days,color:newTodo.color};
    const updatedTodos=[...(stateRef.current.todos||[]),todo];
    updateState(prev=>({...prev,todos:updatedTodos}));
    const ws=normalizeWeights(stateRef.current.weights);
    setSchedule(generateSchedule(viewDs,stateRef.current.lastSeen||{},ws,updatedTodos));
  },[viewDs]); // eslint-disable-line

  // Todo delete
  const handleTodoDelete=useCallback(id=>{
    const updatedTodos=(stateRef.current.todos||[]).filter(t=>t.id!==id);
    updateState(prev=>({...prev,todos:updatedTodos}));
    const ws=normalizeWeights(stateRef.current.weights);
    setSchedule(generateSchedule(viewDs,stateRef.current.lastSeen||{},ws,updatedTodos));
  },[viewDs]); // eslint-disable-line

  // Todo edit from list (open modal with todo's full data)
  const handleTodoEditFromList=useCallback(todo=>{
    setEditing({...todo,type:'todo',label:todo.name});
  },[]);

  // Apply custom sync ID — copies current data to new ID then reloads
  const handleApplyId=useCallback(newId=>{
    const snap=buildSnap();
    fetch(`/api/state?uid=${newId}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snap)})
      .then(()=>{ window.location.href=`/?uid=${newId}`; })
      .catch(()=>{ window.location.href=`/?uid=${newId}`; });
  },[buildSnap]);

  // Session actions
  function handleStart(item) {
    haptic(50);
    setActive({id:item.id,subj:item.subj,startTime:Date.now()});
    updateState(prev=>({...prev,activeSessionId:item.id,activeSessionSubj:item.subj}));
  }
  function handleStop(item) {
    haptic([40,20,40]); if(!activeSession) return;
    const elapsed=Date.now()-activeSession.startTime;
    updateState(prev=>({...prev,activeSessionId:null,activeSessionSubj:null,
      timers:{...prev.timers,[item.id]:{total:(prev.timers[item.id]?.total||0)+elapsed}},
      lastSeen:{...prev.lastSeen,[item.subj]:Date.now()}}));
    setActive(null);
  }
  function handleDone(item) {
    haptic([40,20,40]);
    const elapsed=activeSession?.id===item.id?Date.now()-activeSession.startTime:0;
    updateState(prev=>({...prev,activeSessionId:null,activeSessionSubj:null,
      done:prev.done.includes(item.id)?prev.done:[...prev.done,item.id],
      timers:elapsed>0?{...prev.timers,[item.id]:{total:(prev.timers[item.id]?.total||0)+elapsed}}:prev.timers,
      lastSeen:{...prev.lastSeen,[item.subj]:Date.now()}}));
    setActive(null);
  }
  function handleSkip(id) {
    if(activeSession?.id===id) setActive(null);
    updateState(prev=>({...prev,
      activeSessionId:prev.activeSessionId===id?null:prev.activeSessionId,
      activeSessionSubj:prev.activeSessionId===id?null:prev.activeSessionSubj,
      skip:prev.skip.includes(id)?prev.skip:[...prev.skip,id]}));
  }

  // Stats
  const effSch=viewDs===today?schedule:todaySchedule;
  const todaySessions=effSch.filter(s=>s.type==='study');
  const todayDone=todaySessions.filter(s=>state.done.includes(s.id)).length;
  const examsDone=EXAMS.filter(e=>toEpoch(e.date,toMins(e.end))<now.getTime()).length;
  const clockStr=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

  if(!loaded) return <div style={{ display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh',color:'#666' }}>Loading…</div>;

  return (
    <div className="app">
      {editingItem&&(
        <EditModal item={editingItem} onSaveSession={handleSaveSession} onSaveTodo={handleSaveTodo} onClose={()=>setEditing(null)} />
      )}

      {/* Header */}
      <div className="card">
        <div className="header">
          <div className="header-left"><strong>{todayDone}</strong>revised today</div>
          <div className="header-right"><div className="clock">{clockStr}</div></div>
        </div>
        <div className="progress-section">
          <div className="progress-label">
            <span>Today: {todayDone}/{todaySessions.length} sessions</span>
            <span>Exams: {examsDone}/{EXAMS.length}</span>
          </div>
          <div className="progress-bar"><div className="progress-fill" style={{ width:todaySessions.length>0?`${(todayDone/todaySessions.length)*100}%`:'0%',background:'#c08828' }} /></div>
          <div className="progress-bar"><div className="progress-fill" style={{ width:`${(examsDone/EXAMS.length)*100}%`,background:'#2090b0' }} /></div>
        </div>
      </div>

      {/* Day nav */}
      <div className="card">
        <div className="day-nav">
          <button onClick={()=>setViewDs(clamp(addDays(viewDs,-1)))} disabled={viewDs<=START_DATE}>&#8249;</button>
          <div className="date-display">
            <div className="date-main">{fmtDateLabel(viewDs)}</div>
            {viewDs===today&&<div className="date-sub">Today</div>}
          </div>
          <button onClick={()=>setViewDs(clamp(addDays(viewDs,1)))} disabled={viewDs>=END_DATE}>&#8250;</button>
        </div>
      </div>

      {/* Calendar */}
      <div className="card">
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12 }}>
          <div className="section-header" style={{ margin:0 }}>Schedule</div>
          <button className="btn-restart" onClick={handleRestart}>↺ Reset from now</button>
        </div>
        <p className="dim-text" style={{ fontSize:11,marginBottom:8 }}>Tap a session or task to edit its time.</p>
        {schedule.length===0
          ? <p className="dim-text">No sessions scheduled.</p>
          : <CalendarView schedule={schedule} state={state} activeSession={activeSession} now={now}
              viewDs={viewDs} onStart={handleStart} onStop={handleStop} onDone={handleDone}
              onSkip={handleSkip} onBlockClick={handleBlockClick} editingId={editingItem?.id} />
        }
      </div>

      {/* Priority bars */}
      <div className="card">
        <div className="section-header">Live Priorities</div>
        <PriorityBars priorities={priorities} />
      </div>

      {/* Priority sliders */}
      <div className="card">
        <div className="section-header">Priority Weights</div>
        <p className="dim-text" style={{ fontSize:11,marginBottom:10 }}>Changing a slider resets today's future sessions.</p>
        <PrioritySliders weights={state.weights} onChange={handleWeightsChange} />
      </div>

      {/* Upcoming exams */}
      <div className="card">
        <div className="section-header">Upcoming Exams</div>
        <UpcomingExams now={now} />
      </div>

      {/* Tasks */}
      <div className="card">
        <div className="section-header">Tasks &amp; Meals</div>
        <TodoList todos={state.todos||[]} onAdd={handleTodoAdd} onDelete={handleTodoDelete} onEdit={handleTodoEditFromList} />
      </div>

      {/* iPhone */}
      <IphonePanel onApplyId={handleApplyId} />
    </div>
  );
}
