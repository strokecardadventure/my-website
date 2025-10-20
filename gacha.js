// gacha.js — ปรับ: TOTAL_CARDS=30, แสดง ? แทนค่าที่ไม่ถูกต้อง, ไม่ลบข้อมูลเดิม
(function(){
  // CONFIG (แก้ตรงนี้ให้เป็น 30 ตามคำขอ)
  const TOTAL_CARDS = 30;
  const PROGRESSION = [10000,20000,40000,80000,160000,320000,640000,1280000];
  const CAP = 1500000;
  const STORAGE_KEY = 'sca_gacha_local_v3';
  const BACKUP_SUBCOL = '_backups';
  const BACK_FALLBACK = 'alldata.html';

  // DOM
  const $ = id => document.getElementById(id);
  const coinsEl = $('coins');
  const missingEl = $('missing');
  const totalEl = $('total');
  const gachaBtn = $('gachaBtn');
  const costHint = $('costHint');
  const modal = $('modal');
  const modalBody = $('modalBody');
  const modalClose = $('modalClose');
  const cardRow = $('cardRow');
  const streakEl = $('streak');
  const backBtn = $('backBtn');

  // local
  let localState = { streak: 0 };
  try { const raw = localStorage.getItem(STORAGE_KEY); if(raw) localState = JSON.parse(raw); } catch(e){}

  // firebase
  const auth = firebase.auth();
  const db = firebase.firestore();

  // runtime state
  let userUid = null;
  let rawCards = [];         // original values from DB (kept intact)
  let ownedNormalized = [];  // normalized 'cardNN' used for logic
  let currentPoints = 0;
  let gachaStreak = 0;

  // helpers
  function fmt(n){ return (typeof n === 'number') ? n.toLocaleString() : String(n || 0); }
  function clampCost(streakIndex){
    if (streakIndex <= 0) return PROGRESSION[0];
    if (streakIndex <= PROGRESSION.length) return PROGRESSION[streakIndex-1];
    return CAP;
  }

  // Normalize single value -> 'cardNN' OR null if nothing numeric
  function normalizeSingle(v){
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    // match "cardNN" (case-insensitive)
    let m = s.match(/^card\s*0*([0-9]+)$/i);
    if (m) return 'card' + Number(m[1]);
    // pure number
    m = s.match(/^0*([0-9]+)$/);
    if (m) return 'card' + Number(m[1]);
    // contains digits - take the first numeric group
    m = s.match(/([0-9]+)/);
    if (m) return 'card' + Number(m[1]);
    // no digit -> not a card
    return null;
  }

  // Build canonical set of owned cards (only cardNN, unique, and within 1..TOTAL_CARDS)
  function normalizeCardsField(raw){
    if (!raw) return [];
    let arr = [];
    if (Array.isArray(raw)){
      arr = raw.map(normalizeSingle).filter(Boolean);
    } else if (typeof raw === 'object'){
      try {
        arr = Object.values(raw).map(normalizeSingle).filter(Boolean);
      } catch(e){ arr = []; }
    } else {
      const x = normalizeSingle(raw);
      if (x) arr = [x];
    }
    // ensure numbers within range 1..TOTAL_CARDS and unique
    const seen = new Set();
    const out = [];
    arr.forEach(s => {
      const m = s.match(/(\d+)$/);
      if (!m) return;
      const n = Number(m[1]);
      if (n >= 1 && n <= TOTAL_CARDS && !seen.has(s)){
        seen.add(s);
        out.push(s);
      }
    });
    // sort by numeric suffix
    out.sort((a,b)=> {
      const na = Number((a.match(/(\d+)$/)||[])[1]||0);
      const nb = Number((b.match(/(\d+)$/)||[])[1]||0);
      return na - nb;
    });
    return out;
  }

  // compute missing canonical list
  function computeMissing(){
    const all = Array.from({length: TOTAL_CARDS}, (_,i) => 'card' + (i+1));
    const ownedSet = new Set(ownedNormalized);
    return all.filter(c => !ownedSet.has(c));
  }

  // render UI
  function render(){
    if (coinsEl) coinsEl.textContent = fmt(currentPoints);
    if (totalEl) totalEl.textContent = TOTAL_CARDS;
    if (missingEl) missingEl.textContent = computeMissing().length;
    if (streakEl) streakEl.textContent = String(gachaStreak || localState.streak || 0);

    const nextIdx = (localState.streak || 0) + 1;
    const nextCost = clampCost(nextIdx);
    if (gachaBtn) gachaBtn.textContent = `สุ่มการ์ด — ${fmt(nextCost)} SCA`;
    if (costHint) costHint.textContent = `ราคาสุ่มครั้งที่ ${nextIdx}: ${fmt(nextCost)} SCA`;

    // show last 3 ownedNormalized — if not available, show '?'
    if (cardRow){
      const last = ownedNormalized.slice(-3).reverse(); // newest first
      const placeholders = cardRow.querySelectorAll('.gacha-card');
      placeholders.forEach((el, idx)=>{
        const v = last[idx];
        // only display when v matches "cardNN" exactly
        if (typeof v === 'string' && /^card\d+$/.test(v)) {
          el.textContent = v;
        } else {
          el.textContent = '?';
        }
      });
    }
  }

  // backup (best effort)
  async function backupUserDoc(uid){
    try {
      const ref = db.collection('users').doc(uid);
      const snap = await ref.get();
      const data = snap.exists ? snap.data() : {};
      const backupRef = ref.collection(BACKUP_SUBCOL).doc(String(Date.now()));
      await backupRef.set({ snapshot: data, ts: firebase.firestore.FieldValue.serverTimestamp() });
      console.log('backup saved to', backupRef.path);
      return backupRef.path;
    } catch (e) {
      console.warn('backup failed', e);
      return null;
    }
  }

  function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

  // main action
  async function doGacha(){
    if (!userUid) { alert('กรุณาเข้าสู่ระบบ'); return; }
    const missing = computeMissing();
    if (missing.length === 0){ alert('คุณมีครบทุกการ์ดแล้ว'); return; }

    const nextIdx = (localState.streak || 0) + 1;
    const cost = clampCost(nextIdx);
    if (currentPoints < cost){ alert(`เหรียญไม่พอ (ต้องการ ${fmt(cost)} SCA)`); return; }

    const pick = pickRandom(missing); // canonical 'cardNN'

    // backup
    await backupUserDoc(userUid).catch(()=>{});

    // transaction: check points and arrayUnion the canonical card
    const userRef = db.collection('users').doc(userUid);
    try {
      await db.runTransaction(async tx => {
        const snap = await tx.get(userRef);
        if (!snap.exists) throw new Error('User doc missing');
        const d = snap.data() || {};
        const curPoints = Number(d.points || d.sca || d.balance || 0);
        if (curPoints < cost) throw new Error('คะแนนไม่พอ (ขณะทำรายการ)');

        tx.update(userRef, {
          points: firebase.firestore.FieldValue.increment(-cost),
          cards: firebase.firestore.FieldValue.arrayUnion(pick),
          gachaStreak: firebase.firestore.FieldValue.increment(1)
        });
      });

      // update local streak
      localState.streak = (localState.streak || 0) + 1;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(localState)); } catch(e){}

      if (modalBody) modalBody.innerHTML = `<div style="font-weight:700">คุณได้การ์ดใหม่: ${pick}</div><div style="margin-top:8px;color:#666">จ่าย ${fmt(cost)} SCA</div>`;
      if (modal) modal.classList.remove('hidden');

    } catch (err){
      console.error('gacha txn failed', err);
      alert('ไม่สามารถสุ่มได้ในขณะนี้ ลองอีกครั้ง');
    } finally {
      render();
    }
  }

  // events
  if (gachaBtn) gachaBtn.addEventListener('click', doGacha);
  if (modalClose) modalClose.addEventListener('click', ()=> modal.classList.add('hidden'));
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
  if (backBtn) backBtn.addEventListener('click', ()=> {
    try {
      if (document.referrer && document.referrer.includes(location.host)) history.back();
      else window.location.href = BACK_FALLBACK;
    } catch(e){ history.back(); }
  });

  // auth + snapshot
  auth.onAuthStateChanged(user => {
    if (!user) { userUid = null; render(); return; }
    userUid = user.uid;
    const ref = db.collection('users').doc(userUid);
    ref.onSnapshot(snap => {
      if (!snap.exists){
        currentPoints = 0; rawCards = []; ownedNormalized = []; gachaStreak = 0; render(); return;
      }
      const d = snap.data() || {};
      currentPoints = Number(d.points || d.sca || d.balance || 0);
      gachaStreak = Number(d.gachaStreak || 0) || localState.streak || 0;

      // capture raw values (do not overwrite DB)
      if (Array.isArray(d.cards)) rawCards = d.cards.slice();
      else if (d.cards && typeof d.cards === 'object') rawCards = Object.values(d.cards);
      else {
        // detect numeric keys (legacy)
        rawCards = [];
        Object.keys(d).forEach(k => {
          if (/^\d+$/.test(k) || /^card\d+$/i.test(k)) rawCards.push(d[k]);
        });
      }

      // build normalized canonical set for logic
      ownedNormalized = normalizeCardsField(rawCards);

      // if DB provides gachaStreak, sync localState
      if (typeof d.gachaStreak === 'number') {
        gachaStreak = d.gachaStreak;
        localState.streak = gachaStreak;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(localState)); } catch(e){}
      }

      render();
      console.log('gacha snapshot:', { points: currentPoints, rawCount: rawCards.length, ownedNormalized });
    }, err => {
      console.error('snapshot error', err);
      render();
    });
  });

  render();

})();
