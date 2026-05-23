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
const LS_SID      = 'rt_sid';
const LS_SSTART   = 'rt_sstart';

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
// Compute minutes studied for a set of sessions, accounting for active session live time
function computeMinsStudied(sessions, done, timers, activeSession, now) {
  return sessions.reduce((acc, s) => {
    const isActive = activeSession?.id === s.id;
    const spentMs = (timers[s.id]?.total || 0) + (isActive ? now.getTime() - activeSession.startTime : 0);
    const spentMins = spentMs / 60000;
    const scheduled = s.end - s.start;
    if (done.includes(s.id) || isActive) {
      return acc + (spentMs > 0 ? Math.min(scheduled, spentMins) : (done.includes(s.id) ? scheduled : 0));
    }
    if (spentMs > 0) return acc + Math.min(scheduled, spentMins);
    return acc;
  }, 0);
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
function CalendarView({ schedule, state, activeSession, now, viewDs, onStart, onStop, onDone, onBlockClick, editingId }) {
  const containerRef = useRef(null);
  const today = todayDs();
  const isToday = viewDs === today;
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
    const isRunning = item.type==='study' && activeSession?.id===item.id;
    const isEditing = editingId===item.id;

    // Time-based opacity for past study sessions
    const isPast = item.type==='study' && (viewDs < today || (viewDs === today && item.end <= curMins));
    let opacity = 1;
    if (isPast && !isRunning) {
      const scheduled = item.end - item.start;
      const spentMs = state.timers[item.id]?.total || 0;
      const spentMins = spentMs / 60000;
      if (isDone) {
        // Completed — use timer ratio or assume full if no timer data
        const ratio = spentMs > 0 ? Math.min(1, spentMins / scheduled) : 1;
        opacity = 0.18 + ratio * 0.82;
      } else if (spentMs > 0) {
        // Partially done (timer used but not marked done)
        const ratio = Math.min(1, spentMins / scheduled);
        opacity = 0.18 + ratio * 0.82;
      } else {
        // Missed — barely visible
        opacity = 0.13;
      }
    }

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
          opacity,
          display:'flex',alignItems:'center',
          cursor:clickable?'pointer':'default',
          outline:isEditing?'2px solid rgba(255,255,255,0.45)':'none',
          outlineOffset:1,
          transition:'opacity 0.3s,outline 0.1s',
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
        {/* Action buttons — no skip button */}
        {item.type==='study'&&!isDone&&!isPast&&(
          <div style={{ display:'flex',gap:3,flexShrink:0,alignItems:'center' }}>
            {!isRunning?(
              <button className="cal-btn cal-btn-start" style={{ padding:'0 8px',height:26,fontSize:11 }}
                onClick={e=>{e.stopPropagation();onStart(item);}}>▶</button>
            ):(
              <>
                <button className="cal-btn cal-btn-stop" style={{ padding:'0 6px',height:26,fontSize:11 }}
                  onClick={e=>{e.stopPropagation();onStop(item);}}>■</button>
                <button className="cal-btn cal-btn-done" style={{ padding:'0 6px',height:26,fontSize:11 }}
                  onClick={e=>{e.stopPropagation();onDone(item);}}>Done</button>
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
        const urgency=Math.max(0,1-Math.min(d,14)/14);
        const barColor=d<=2?'#c04838':d<=5?'#c08828':d<=10?'#c0a040':'#888';
        return (
          <div className="exam-item" key={ex.id} style={{ flexDirection:'column',alignItems:'stretch',gap:6 }}>
            <div style={{ display:'flex',alignItems:'center',gap:10 }}>
              <div className="exam-dot" style={{ background:COLOURS[ex.subj]||'#888' }} />
              <div className="exam-info">
                <div className="exam-info-title">{ex.subj}</div>
                <div className="exam-info-paper">{ex.paper} · {ex.date} {ex.start}</div>
              </div>
              <div className={`exam-countdown${d<=3?' soon':''}`}>{d===0?'Today':d===1?'Tomorrow':`${d}d`}</div>
            </div>
            <div style={{ height:4,borderRadius:2,background:'rgba(255,255,255,0.06)',overflow:'hidden' }}>
              <div style={{ height:'100%',width:`${Math.max(3,urgency*100)}%`,borderRadius:2,background:`linear-gradient(to right,${barColor},white)`,opacity:0.85 }} />
            </div>
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

// ── LogTimeModal ──────────────────────────────────────────────────────────────
function LogTimeModal({ item, onLog, onClose }) {
  const scheduled = item.end - item.start;
  const [mins, setMins] = useState(String(scheduled));
  const m = parseInt(mins, 10);
  const valid = m >= 1 && m <= 480;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e=>e.stopPropagation()}>
        <div className="modal-title">{item.label}</div>
        <div className="modal-field">
          <label>Minutes you studied</label>
          <input
            className="modal-input"
            type="number" min="1" max="480"
            value={mins}
            onChange={e=>setMins(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&valid&&onLog(item,m)}
            autoFocus
          />
        </div>
        <div style={{ fontSize:12,color:'#666' }}>
          Scheduled {item.startFmt}–{item.endFmt} · {scheduled} min
        </div>
        <div className="modal-actions">
          <button className="modal-btn modal-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="modal-btn modal-btn-save" disabled={!valid} onClick={()=>onLog(item,m)}>
            Log &amp; Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const now   = useClock();
  const today = todayDs();

  const [viewDs, setViewDs]         = useState(clamp(today));
  const [state, setState]           = useState({
    done:[],skip:[],timers:{},vd:today,lastSeen:{},
    todos:[...DEFAULT_TODOS],
    weights:{urgency:48,recency:32,difficulty:14,alevel:6},
    schedules:{},          // persisted schedule per date-string
    activeSessionId:null,activeSessionSubj:null,activeSessionStart:null,
  });
  const [activeSession, setActive]  = useState(null);
  const [loaded, setLoaded]         = useState(false);
  const [schedule, setSchedule]     = useState([]);
  const [todaySchedule, setTodaySch]= useState([]);
  const [priorities, setPriorities] = useState([]);
  const [editingItem, setEditing]   = useState(null);
  const [logItem, setLogItem]       = useState(null);

  const stateRef      = useRef(state);
  const activeRef     = useRef(activeSession);
  const scheduleRef   = useRef([]);
  const viewDsRef     = useRef(viewDs);
  const lastFetchRef  = useRef(0);
  useEffect(()=>{ stateRef.current=state; },[state]);
  useEffect(()=>{ activeRef.current=activeSession; },[activeSession]);
  useEffect(()=>{ scheduleRef.current=schedule; },[schedule]);
  useEffect(()=>{ viewDsRef.current=viewDs; },[viewDs]);

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(()=>{
    apiGet().then(s=>{
      lastFetchRef.current=Date.now();
      s.todos = migrateTodos(s.todos);
      if (!s.schedules) s.schedules = {};
      setState(prev=>({...prev,...s}));
      if(s.vd&&s.vd>=START_DATE&&s.vd<=END_DATE) setViewDs(s.vd);
      if(s.activeSessionId&&s.activeSessionSubj){
        const lsId=localStorage.getItem(LS_SID);
        const lsStart=localStorage.getItem(LS_SSTART);
        const startTime=(lsId===s.activeSessionId&&lsStart)
          ?parseInt(lsStart,10)
          :(s.activeSessionStart||Date.now());
        setActive({id:s.activeSessionId,subj:s.activeSessionSubj,startTime});
      }
      setLoaded(true);
    }).catch(()=>setLoaded(true));
  },[]);

  // ── Save helpers ──────────────────────────────────────────────────────────
  const saveTimerRef = useRef(null);
  const save = useCallback(s=>{
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current=setTimeout(()=>apiPost(s),300);
  },[]);
  const buildSnap = useCallback(()=>{
    // Include the latest schedule so it's in the beacon save
    return {
      ...stateRef.current,
      schedules:{...stateRef.current.schedules,[viewDsRef.current]:scheduleRef.current},
    };
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
  // Periodic save when session is active
  useEffect(()=>{
    if(!activeSession) return;
    const t=setInterval(()=>apiPost(buildSnap()),5000);
    return()=>clearInterval(t);
  },[activeSession,buildSnap]);

  // ── Persist schedule whenever it changes ──────────────────────────────────
  useEffect(()=>{
    if(!loaded||!schedule.length) return;
    const ds=viewDsRef.current;
    // Update stateRef directly so buildSnap always has the latest schedule,
    // then debounce the actual server save.
    stateRef.current={
      ...stateRef.current,
      schedules:{...(stateRef.current.schedules||{}),[ds]:schedule},
    };
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current=setTimeout(()=>apiPost(stateRef.current),400);
  },[schedule,loaded]); // eslint-disable-line

  // ── Re-fetch when tab becomes visible (cross-device sync) ─────────────────
  useEffect(()=>{
    const onVisible=()=>{
      if(document.visibilityState==='hidden') return;
      if(activeRef.current) return; // don't disturb active session
      if(Date.now()-lastFetchRef.current<15000) return;
      lastFetchRef.current=Date.now();
      apiGet().then(s=>{
        if(!s.schedules) s.schedules={};
        s.todos=migrateTodos(s.todos);
        setState(prev=>({...prev,...s}));
        const ds=viewDsRef.current;
        const newVd=s.vd&&s.vd>=START_DATE&&s.vd<=END_DATE?s.vd:ds;
        if(s.vd&&s.vd>=START_DATE&&s.vd<=END_DATE) setViewDs(s.vd);
        const ws=normalizeWeights(s.weights||DEFAULT_WEIGHTS);
        const todos=migrateTodos(s.todos);
        const nm=nowMins();
        // Use saved schedule for viewed date, regenerating only future sessions
        const saved=s.schedules?.[newVd];
        if(saved?.length){
          setSchedule(resetSchedule(newVd,nm,saved,s.lastSeen||{},ws,todos));
        } else {
          setSchedule(generateSchedule(newVd,s.lastSeen||{},ws,todos));
        }
      }).catch(()=>{});
    };
    document.addEventListener('visibilitychange',onVisible);
    return()=>document.removeEventListener('visibilitychange',onVisible);
  },[]); // eslint-disable-line

  function updateState(fn) { setState(prev=>{ const next=fn(prev); save(next); return next; }); }

  // ── Schedule generation ───────────────────────────────────────────────────
  // Helper: safe cut-point that never disturbs past or ongoing sessions
  const safeCutMin = useCallback(()=>{
    const nm=nowMins();
    const active=activeRef.current;
    if(!active) return nm;
    const ongoing=scheduleRef.current.find(i=>i.id===active.id);
    return ongoing ? Math.max(nm, ongoing.end) : nm;
  },[]);

  useEffect(()=>{
    if(!loaded) return;
    const ws=normalizeWeights(stateRef.current.weights);
    const todos=stateRef.current.todos||DEFAULT_TODOS;

    if(viewDs<today){
      // Past day — show the saved (immutable) schedule
      const saved=stateRef.current.schedules?.[viewDs];
      setSchedule(saved?.length?saved:generateSchedule(viewDs,stateRef.current.lastSeen||{},ws,todos));
    } else if(viewDs===today){
      // Today — restore saved schedule and only regenerate future sessions
      const saved=stateRef.current.schedules?.[today];
      if(saved?.length){
        const cut=safeCutMin();
        setSchedule(resetSchedule(today,cut,saved,stateRef.current.lastSeen||{},ws,todos));
      } else {
        setSchedule(generateSchedule(today,stateRef.current.lastSeen||{},ws,todos));
      }
    } else {
      // Future day — generate fresh
      setSchedule(generateSchedule(viewDs,stateRef.current.lastSeen||{},ws,todos));
    }
  },[viewDs,loaded]); // eslint-disable-line

  useEffect(()=>{
    if(!loaded) return;
    const ws=normalizeWeights(stateRef.current.weights);
    const todos=stateRef.current.todos||DEFAULT_TODOS;
    const saved=stateRef.current.schedules?.[today];
    setTodaySch(saved?.length?saved:generateSchedule(today,stateRef.current.lastSeen||{},ws,todos));
  },[today,loaded]); // eslint-disable-line

  useEffect(()=>{
    setState(prev=>{ const next={...prev,vd:viewDs}; save(next); return next; });
  },[viewDs]); // eslint-disable-line

  // ── Priorities (live) ─────────────────────────────────────────────────────
  useEffect(()=>{
    const upd=()=>setPriorities(calcAllPriorities(today,nowMins(),stateRef.current.lastSeen||{},normalizeWeights(stateRef.current.weights)));
    upd(); const t=setInterval(upd,30000); return()=>clearInterval(t);
  },[today]);

  // ── Weights change → auto-reset future sessions only ─────────────────────
  const handleWeightsChange=useCallback(newW=>{
    updateState(prev=>({...prev,weights:newW}));
    const ws=normalizeWeights(newW);
    const cut=safeCutMin();
    setSchedule(prev=>resetSchedule(viewDs,cut,prev,stateRef.current.lastSeen||{},ws,stateRef.current.todos||[]));
  },[viewDs,safeCutMin]); // eslint-disable-line

  // ── Block click → open appropriate modal ─────────────────────────────────
  const handleBlockClick=useCallback(item=>{
    if (item.type==='study') setLogItem(item);
    else setEditing(item);
  },[]);

  // ── Log time for a session done without the timer ─────────────────────────
  const handleLogTime=useCallback((item,mins)=>{
    const ms=mins*60*1000;
    const newLastSeen={...stateRef.current.lastSeen,[item.subj]:toEpoch(viewDs,item.end)};
    const wasActive=activeRef.current?.id===item.id;
    if(wasActive){ localStorage.removeItem(LS_SID); localStorage.removeItem(LS_SSTART); setActive(null); }
    updateState(prev=>({...prev,
      ...(wasActive?{activeSessionId:null,activeSessionSubj:null,activeSessionStart:null}:{}),
      done:prev.done.includes(item.id)?prev.done:[...prev.done,item.id],
      timers:{...prev.timers,[item.id]:{total:ms}},
      lastSeen:newLastSeen,
    }));
    const ws=normalizeWeights(stateRef.current.weights);
    // Reset only future sessions; preserve everything up to and including this session
    const cut=Math.max(item.end,nowMins());
    setSchedule(prev=>resetSchedule(viewDs,cut,prev,newLastSeen,ws,stateRef.current.todos||[]));
    setLogItem(null);
  },[viewDs]); // eslint-disable-line

  // ── Edit study session time ───────────────────────────────────────────────
  const handleSaveSession=useCallback((id,newStart,newEnd)=>{
    const ws=normalizeWeights(stateRef.current.weights);
    setSchedule(prev=>{
      const item=prev.find(i=>i.id===id);
      const resetFrom=item?Math.min(item.start,newStart):newStart;
      const updated=prev.map(i=>i.id!==id?i:{...i,start:newStart,end:newEnd,startFmt:fmtTime(newStart),endFmt:fmtTime(newEnd),duration:newEnd-newStart});
      const cut=Math.max(resetFrom,nowMins());
      return resetSchedule(viewDs,cut,updated,stateRef.current.lastSeen||{},ws,stateRef.current.todos||[]);
    });
    setEditing(null);
  },[viewDs]);

  // ── Edit todo ─────────────────────────────────────────────────────────────
  const handleSaveTodo=useCallback(updated=>{
    const updatedTodos=(stateRef.current.todos||[]).map(t=>t.id!==updated.id?t:{...t,name:updated.name,start:updated.start,end:updated.end,days:updated.days,color:updated.color});
    updateState(prev=>({...prev,todos:updatedTodos}));
    const ws=normalizeWeights(stateRef.current.weights);
    const cut=safeCutMin();
    setSchedule(prev=>resetSchedule(viewDs,cut,prev,stateRef.current.lastSeen||{},ws,updatedTodos));
    setEditing(null);
  },[viewDs,safeCutMin]); // eslint-disable-line

  // ── Add todo ──────────────────────────────────────────────────────────────
  const handleTodoAdd=useCallback(newTodo=>{
    const todo={id:`td-${Date.now()}`,name:newTodo.name,start:newTodo.start,end:newTodo.end,days:newTodo.days,color:newTodo.color};
    const updatedTodos=[...(stateRef.current.todos||[]),todo];
    updateState(prev=>({...prev,todos:updatedTodos}));
    const ws=normalizeWeights(stateRef.current.weights);
    const cut=safeCutMin();
    setSchedule(prev=>resetSchedule(viewDs,cut,prev,stateRef.current.lastSeen||{},ws,updatedTodos));
  },[viewDs,safeCutMin]); // eslint-disable-line

  // ── Delete todo ───────────────────────────────────────────────────────────
  const handleTodoDelete=useCallback(id=>{
    const updatedTodos=(stateRef.current.todos||[]).filter(t=>t.id!==id);
    updateState(prev=>({...prev,todos:updatedTodos}));
    const ws=normalizeWeights(stateRef.current.weights);
    const cut=safeCutMin();
    setSchedule(prev=>resetSchedule(viewDs,cut,prev,stateRef.current.lastSeen||{},ws,updatedTodos));
  },[viewDs,safeCutMin]); // eslint-disable-line

  const handleTodoEditFromList=useCallback(todo=>{
    setEditing({...todo,type:'todo',label:todo.name});
  },[]);

  // ── Session actions ───────────────────────────────────────────────────────
  function handleStart(item) {
    haptic(50);
    const startTime=Date.now();
    localStorage.setItem(LS_SID,item.id);
    localStorage.setItem(LS_SSTART,String(startTime));
    setActive({id:item.id,subj:item.subj,startTime});
    updateState(prev=>({...prev,activeSessionId:item.id,activeSessionSubj:item.subj,activeSessionStart:startTime}));
  }

  function handleStop(item) {
    haptic([40,20,40]); if(!activeSession) return;
    localStorage.removeItem(LS_SID); localStorage.removeItem(LS_SSTART);
    const elapsed=Date.now()-activeSession.startTime;
    const newLastSeen={...stateRef.current.lastSeen,[item.subj]:Date.now()};
    updateState(prev=>({...prev,activeSessionId:null,activeSessionSubj:null,activeSessionStart:null,
      timers:{...prev.timers,[item.id]:{total:(prev.timers[item.id]?.total||0)+elapsed}},
      lastSeen:newLastSeen}));
    setActive(null);
    // Auto-reset future sessions based on updated lastSeen
    if(viewDs===today){
      const ws=normalizeWeights(stateRef.current.weights);
      setSchedule(prev=>resetSchedule(today,nowMins(),prev,newLastSeen,ws,stateRef.current.todos||[]));
    }
  }

  function handleDone(item) {
    haptic([40,20,40]);
    localStorage.removeItem(LS_SID); localStorage.removeItem(LS_SSTART);
    const elapsed=activeSession?.id===item.id?Date.now()-activeSession.startTime:0;
    const newLastSeen={...stateRef.current.lastSeen,[item.subj]:Date.now()};
    updateState(prev=>({...prev,activeSessionId:null,activeSessionSubj:null,activeSessionStart:null,
      done:prev.done.includes(item.id)?prev.done:[...prev.done,item.id],
      timers:elapsed>0?{...prev.timers,[item.id]:{total:(prev.timers[item.id]?.total||0)+elapsed}}:prev.timers,
      lastSeen:newLastSeen}));
    setActive(null);
    // Auto-reset future sessions
    if(viewDs===today){
      const ws=normalizeWeights(stateRef.current.weights);
      setSchedule(prev=>resetSchedule(today,nowMins(),prev,newLastSeen,ws,stateRef.current.todos||[]));
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  // For the header: use viewDs schedule for past days, today's for future
  const effSch=viewDs>today?todaySchedule:schedule;
  const displaySessions=effSch.filter(s=>s.type==='study');
  const totalMinsSched=displaySessions.reduce((a,s)=>a+(s.end-s.start),0);
  const minsStudied=computeMinsStudied(displaySessions,state.done,state.timers,activeSession,now);
  const progressPct=totalMinsSched>0?Math.min(100,(minsStudied/totalMinsSched)*100):0;
  const hrs=Math.floor(minsStudied/60);
  const minsRem=Math.floor(minsStudied%60);
  const timeStudied=hrs>0?`${hrs}h ${minsRem}m`:`${minsRem}m`;

  const examsDone=EXAMS.filter(e=>toEpoch(e.date,toMins(e.end))<now.getTime()).length;
  const clockStr=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const isViewingPast=viewDs<today;

  if(!loaded) return <div style={{ display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh',color:'#666' }}>Loading…</div>;

  return (
    <div className="app">
      {editingItem&&(
        <EditModal item={editingItem} onSaveSession={handleSaveSession} onSaveTodo={handleSaveTodo} onClose={()=>setEditing(null)} />
      )}
      {logItem&&(
        <LogTimeModal item={logItem} onLog={handleLogTime} onClose={()=>setLogItem(null)} />
      )}

      {/* Header */}
      <div className="card">
        <div className="header">
          <div className="header-left">
            <strong>{timeStudied}</strong>
            {isViewingPast?` on ${fmtDateLabel(viewDs).split(' ').slice(0,2).join(' ')}`:'studied today'}
          </div>
          <div className="header-right"><div className="clock">{clockStr}</div></div>
        </div>
        <div className="progress-section">
          <div className="progress-label">
            <span>
              {isViewingPast?`${viewDs} ·`:''} {Math.round(minsStudied)}m / {totalMinsSched}m study
            </span>
            <span>Exams: {examsDone}/{EXAMS.length}</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width:`${progressPct}%`,background:'#c08828' }} />
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width:`${(examsDone/EXAMS.length)*100}%`,background:'#2090b0' }} />
          </div>
        </div>
      </div>

      {/* Day nav */}
      <div className="card">
        <div className="day-nav">
          <button onClick={()=>setViewDs(clamp(addDays(viewDs,-1)))} disabled={viewDs<=START_DATE}>&#8249;</button>
          <div className="date-display">
            <div className="date-main">{fmtDateLabel(viewDs)}</div>
            {viewDs===today&&<div className="date-sub">Today</div>}
            {isViewingPast&&<div className="date-sub" style={{ color:'#888' }}>Past day</div>}
          </div>
          <button onClick={()=>setViewDs(clamp(addDays(viewDs,1)))} disabled={viewDs>=END_DATE}>&#8250;</button>
        </div>
      </div>

      {/* Calendar */}
      <div className="card">
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12 }}>
          <div className="section-header" style={{ margin:0 }}>Schedule</div>
        </div>
        <p className="dim-text" style={{ fontSize:11,marginBottom:8 }}>
          {isViewingPast?'Past day — tap any session to log or correct time.':'Tap a session to log time · tap a task to edit.'}
        </p>
        {schedule.length===0
          ? <p className="dim-text">No sessions scheduled.</p>
          : <CalendarView schedule={schedule} state={state} activeSession={activeSession} now={now}
              viewDs={viewDs} onStart={handleStart} onStop={handleStop} onDone={handleDone}
              onBlockClick={handleBlockClick} editingId={editingItem?.id} />
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
        <p className="dim-text" style={{ fontSize:11,marginBottom:10 }}>Adjusting a slider only changes future sessions.</p>
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

    </div>
  );
}
