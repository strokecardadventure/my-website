// gacha.js — ปรับให้รีเซ็ต placeholders, ไม่โชว์ประวัติการ์ด, TOTAL_CARDS=30
(function(){
  // CONFIG
  const TOTAL_CARDS = 30;
  const PROGRESSION = [10000,20000,40000,80000,160000,320000,640000,1280000];
  const CAP = 1500000;
  const STORAGE_KEY = 'sca_gacha_local_v3';
  const BACKUP_SUBCOL = '_backups';
  const BACK_FALLBACK = 'alldata.html';

  // DOM refs
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
  try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) localState = JSON.parse(raw); } catch(e){}

  // firebase
  const auth = firebase.auth();
  const db = firebase.firestore();

  // runtime
  let userUid = null;
  let rawCards = [];
  let ownedNormalized = [];
  let currentPoints = 0;
  let gachaStreak = 0;

  // helpers
  function fmt(n){ return (typeof n === 'number') ? n.toLocaleString() : String(n || 0); }
  function clampCost(idx){
    if (idx <= 0) return PROGRESSION[0];
    if (idx <= PROGRESSION.length) return PROGRESSION[idx-1];
    return CAP;
  }

  function normalizeSingle(v){
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    let m = s.match(/^card\s*0*([0-9]+)$/i);
    if (m) return 'card' + Number(m[1]);
    m = s.match(/^0*([0-9]+)$/);
    if (m) return 'card' + Number(m[1]);
    m = s.match(/([0-9]+)/);
    if (m) return 'card' + Number(m[1]);
    return null;
  }
  function normalizeCardsField(raw){
    if (!raw) return [];
    let arr = [];
    if (Array.isArray(raw)) arr = raw.map(normalizeSingle).filter(Boolean);
    else if (typeof raw === 'object') {
      try { arr = Object.values(raw).map(normalizeSingle).filter(Boolean); } catch(e){ arr = []; }
    } else {
      const v = normalizeSingle(raw);
      if (v) arr = [v];
    }
    const seen = new Set(); const out = [];
    arr.forEach(s=>{
      const m = s.match(/(\d+)$/);
      if (!m) return;
      const n = Number(m[1]);
      if (n >= 1 && n <= TOTAL_CARDS && !seen.has(s)){ seen.add(s); out.push(s); }
    });
    out.sort((a,b)=> Number(a.match(/(\d+)$/)[1]) - Number(b.match(/(\d+)$/)[1]));
    return out;
  }

  // remove likely legacy overlays / debug nodes
  function removeLegacyOverlays(){
    const ids = ['gachaHistory','historyOverlay','gacha-big-history','gacha-history'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    // classes
    ['big-history','card-history-overlay','history-overlay','gacha-history'].forEach(cls=>{
      document.querySelectorAll('.' + cls).forEach(e=>{
        if (e && e.parentNode) e.parentNode.removeChild(e);
      });
    });
    // Also remove any stray large text nodes directly under cardRow
    if (cardRow){
      Array.from(cardRow.childNodes).forEach(node => {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0){
          node.textContent = '';
        }
      });
    }
  }

  // rebuild cardRow placeholders (ensures only three cards and no stray overlay)
  function resetPlaceholders(){
    if (!cardRow) return;
    // clear everything then create exactly 3 placeholders
    cardRow.innerHTML = '';
    for (let i=0;i<3;i++){
      const d = document.createElement('div');
      d.className = 'gacha-card';
      d.textContent = '?';
      // ensure styles not overridden inline
      d.style.fontSize = '';
      d.style.whiteSpace = 'normal';
      cardRow.appendChild(d);
    }
  }

  function computeMissingCount(){
    return Math.max(TOTAL_CARDS - ownedNormalized.length, 0);
  }

  function render(){
    // remove any legacy/debug overlays first
    removeLegacyOverlays();
    // ensure placeholders are fresh
    resetPlaceholders();

    if (coinsEl) coinsEl.textContent = fmt(currentPoints);
    if (totalEl) totalEl.textContent = TOTAL_CARDS;
    if (missingEl) missingEl.textContent = computeMissingCount();
    if (streakEl) streakEl.textContent = String(gachaStreak || localState.streak || 0);

    const nextIdx = (localState.streak || 0) + 1;
    const nextCost = clampCost(nextIdx);
    if (gachaBtn) gachaBtn.textContent = `สุ่มการ์ด — ${fmt(nextCost)} SCA`;
    if (costHint) costHint.textContent = `ราคาสุ่มครั้งที่ ${nextIdx}: ${fmt(nextCost)} SCA`;

    // placeholders already set to '?', keep them that way
  }

  // backup snapshot (best effort)
  async function backupUserDoc(uid){
    try {
      const ref = db.collection('users').doc(uid);
      const snap = await ref.get();
      const data = snap.exists ? snap.data() : {};
      const backupRef = ref.collection(BACKUP_SUBCOL).doc(String(Date.now()));
      await backupRef.set({ snapshot: data, ts: firebase.firestore.FieldValue.serverTimestamp() });
      return backupRef.path;
    } catch(e){
      console.warn('backup failed', e);
      return null;
    }
  }

  function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

  // main gacha action (adds canonical 'cardNN' via arrayUnion)
  async function doGacha(){
    if (!userUid) { alert('กรุณาเข้าสู่ระบบ'); return; }

    const all = Array.from({length: TOTAL_CARDS}, (_,i)=>'card'+(i+1));
    const missing = all.filter(c=> !ownedNormalized.includes(c));
    if (missing.length === 0){ alert('คุณมีครบทุกการ์ดแล้ว'); return; }

    const nextIdx = (localState.streak || 0) + 1;
    const cost = clampCost(nextIdx);
    if (currentPoints < cost){ alert(`เหรียญไม่พอ (ต้องการ ${fmt(cost)} SCA)`); return; }

    const pick = pickRandom(missing);

    // backup
    await backupUserDoc(userUid).catch(()=>{});

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

      localState.streak = (localState.streak || 0) + 1;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(localState)); } catch(e){}

      if (modalBody) modalBody.innerHTML = `<div style="font-weight:700">สุ่มสำเร็จ!</div><div style="margin-top:8px;color:#666">จ่าย ${fmt(cost)} SCA</div>`;
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

  // firebase auth + realtime
  auth.onAuthStateChanged(user => {
    // remove any old overlays immediately
    removeLegacyOverlays();
    // rebuild placeholders
    resetPlaceholders();

    if (!user) { userUid = null; currentPoints = 0; ownedNormalized = []; gachaStreak = 0; render(); return; }
    userUid = user.uid;
    const ref = db.collection('users').doc(userUid);
    ref.onSnapshot(snap => {
      if (!snap.exists) { currentPoints = 0; rawCards = []; ownedNormalized = []; gachaStreak = 0; render(); return; }
      const d = snap.data() || {};
      currentPoints = Number(d.points || d.sca || d.balance || 0);
      gachaStreak = Number(d.gachaStreak || 0) || (localState.streak || 0);

      // capture raw cards (no rewrite)
      if (Array.isArray(d.cards)) rawCards = d.cards.slice();
      else if (d.cards && typeof d.cards === 'object') rawCards = Object.values(d.cards);
      else {
        rawCards = [];
        Object.keys(d).forEach(k => {
          if (/^\d+$/.test(k) || /^card\d+$/i.test(k)) rawCards.push(d[k]);
        });
      }

      ownedNormalized = normalizeCardsField(rawCards);

      if (typeof d.gachaStreak === 'number'){
        gachaStreak = d.gachaStreak;
        localState.streak = gachaStreak;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(localState)); } catch(e){}
      }

      removeLegacyOverlays();
      render();
    }, err => {
      console.error('snapshot error', err);
      render();
    });
  });

  // init
  removeLegacyOverlays();
  resetPlaceholders();
  render();

})();
