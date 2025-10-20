// gacha.js — เวอร์ชันแก้ไข: ไม่ลบข้อมูล, normalize สำหรับ logic, เพิ่มการ์ดเป็น "cardNN", backup ก่อน update
(function(){
  // CONFIG
  const TOTAL_CARDS = 60;
  const PROGRESSION = [10000,20000,40000,80000,160000,320000,640000,1280000];
  const CAP = 1500000;
  const STORAGE_KEY = 'sca_gacha_local_v2';
  const BACKUP_SUBCOL = '_backups';
  const BACK_FALLBACK = 'alldata.html'; // ปรับเป็นหน้าที่ต้องการ

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

  // runtime
  let userUid = null;
  let rawCards = [];      // raw values as in DB (keeps original values)
  let ownedNormalized = []; // canonical 'cardNN' for logic
  let currentPoints = 0;
  let gachaStreak = 0;

  // helpers
  function fmt(n){ return (typeof n === 'number') ? n.toLocaleString() : String(n || 0); }
  function clampCost(streakIndex){
    if (streakIndex <= 0) return PROGRESSION[0];
    if (streakIndex <= PROGRESSION.length) return PROGRESSION[streakIndex-1];
    return CAP;
  }

  function normalizeSingle(v){
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    // already cardNN (card + number)
    let m = s.match(/^card\s*0*([0-9]+)$/i);
    if (m) return 'card' + Number(m[1]);
    // pure number
    m = s.match(/^0*([0-9]+)$/);
    if (m) return 'card' + Number(m[1]);
    // contains number
    m = s.match(/([0-9]+)/);
    if (m) return 'card' + Number(m[1]);
    // fallback
    return s;
  }

  function normalizeCardsField(raw){
    // returns array of canonical 'cardNN' strings (no duplicates)
    if (!raw) return [];
    let arr = [];
    if (Array.isArray(raw)){
      arr = raw.map(normalizeSingle).filter(Boolean);
    } else if (typeof raw === 'object'){
      try {
        arr = Object.values(raw).map(normalizeSingle).filter(Boolean);
      } catch(e){ arr = []; }
    } else {
      arr = [normalizeSingle(raw)].filter(Boolean);
    }
    // unique
    return Array.from(new Set(arr));
  }

  function computeMissing(){
    // all card ids: card1..cardN
    const all = Array.from({length: TOTAL_CARDS}, (_,i) => 'card' + (i+1));
    const ownedSet = new Set(ownedNormalized);
    return all.filter(c => !ownedSet.has(c));
  }

  function render(){
    if (coinsEl) coinsEl.textContent = fmt(currentPoints);
    if (totalEl) totalEl.textContent = TOTAL_CARDS;
    if (missingEl) missingEl.textContent = computeMissing().length;
    if (streakEl) streakEl.textContent = String(gachaStreak || localState.streak || 0);

    const nextIdx = (localState.streak || 0) + 1;
    const nextCost = clampCost(nextIdx);
    if (gachaBtn) gachaBtn.textContent = `สุ่มการ์ด — ${fmt(nextCost)} SCA`;
    if (costHint) costHint.textContent = `ราคาสุ่มครั้งที่ ${nextIdx}: ${fmt(nextCost)} SCA`;

    // show last 3 ownedNormalized
    if (cardRow){
      const last = ownedNormalized.slice(-3).reverse();
      const placeholders = cardRow.querySelectorAll('.gacha-card');
      placeholders.forEach((el, idx) => {
        if (last[idx]) el.textContent = last[idx];
        else el.textContent = '?';
      });
    }
  }

  // backup doc (best effort)
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

  // pick random from array
  function pickRandom(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

  // MAIN gacha
  async function doGacha(){
    if (!userUid) { alert('กรุณาเข้าสู่ระบบ'); return; }

    const missing = computeMissing();
    if (!missing.length){ alert('คุณมีครบทุกการ์ดแล้ว'); return; }

    const nextIdx = (localState.streak || 0) + 1;
    const cost = clampCost(nextIdx);

    if (currentPoints < cost){ alert(`เหรียญไม่พอ (ต้องการ ${fmt(cost)} SCA)`); return; }

    const pick = pickRandom(missing); // pick canonical 'cardNN'

    // backup before update
    await backupUserDoc(userUid).catch(()=>{ /* ignore backup failure */ });

    // Transaction: re-verify points and arrayUnion pick
    const userRef = db.collection('users').doc(userUid);
    try {
      await db.runTransaction(async tx => {
        const snap = await tx.get(userRef);
        if (!snap.exists) throw new Error('User doc missing');
        const data = snap.data() || {};
        const curPoints = Number(data.points || data.sca || data.balance || 0);
        if (curPoints < cost) throw new Error('คะแนนไม่พอ (ขณะทำรายการ)');

        // IMPORTANT: add as "cardNN" via arrayUnion (will not remove old numeric entries)
        tx.update(userRef, {
          points: firebase.firestore.FieldValue.increment(-cost),
          cards: firebase.firestore.FieldValue.arrayUnion(pick),
          gachaStreak: firebase.firestore.FieldValue.increment(1)
        });
      });

      // update local streak (we rely on snapshot to update actual values)
      localState.streak = (localState.streak || 0) + 1;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(localState)); } catch(e){}

      // success UI
      if (modalBody) modalBody.innerHTML = `<div style="font-weight:700">คุณได้การ์ดใหม่: ${pick}</div><div style="margin-top:8px;color:#666">จ่าย ${fmt(cost)} SCA</div>`;
      if (modal) modal.classList.remove('hidden');

    } catch (err){
      console.error('gacha txn failed', err);
      alert('ไม่สามารถสุ่มได้ในขณะนี้ ลองอีกครั้ง');
    } finally {
      render();
    }
  }

  // EVENTS
  if (gachaBtn) gachaBtn.addEventListener('click', doGacha);
  if (modalClose) modalClose.addEventListener('click', ()=> modal.classList.add('hidden'));
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
  if (backBtn) backBtn.addEventListener('click', ()=> {
    try {
      if (document.referrer && document.referrer.includes(location.host)) history.back();
      else window.location.href = BACK_FALLBACK;
    } catch(e){ history.back(); }
  });

  // AUTH + SNAPSHOT
  auth.onAuthStateChanged(user => {
    if (!user) { userUid = null; render(); return; }
    userUid = user.uid;
    const userRef = db.collection('users').doc(userUid);

    // subscribe to doc
    userRef.onSnapshot(snap => {
      if (!snap.exists) { currentPoints = 0; rawCards = []; ownedNormalized = []; gachaStreak = 0; render(); return; }
      const d = snap.data() || {};

      currentPoints = Number(d.points || d.sca || d.balance || 0);
      gachaStreak = Number(d.gachaStreak || 0) || 0;

      // capture raw cards as-is (so we do NOT overwrite them)
      if (Array.isArray(d.cards)){
        rawCards = d.cards.slice();
      } else if (d.cards && typeof d.cards === 'object'){
        rawCards = Object.values(d.cards);
      } else {
        // also detect top-level numeric keys (rare)
        rawCards = [];
        Object.keys(d).forEach(k => {
          if (/^\d+$/.test(k) || /^card\d+$/i.test(k)){
            rawCards.push(d[k]);
          }
        });
        // if still empty and there is a single primitive field we might skip
      }

      // create normalized set for logic (do NOT write back)
      ownedNormalized = Array.from(new Set(rawCards.map(normalizeSingle).filter(Boolean)));

      // ensure sorted
      ownedNormalized.sort((a,b)=>{
        const ma = a.match(/(\d+)$/), mb = b.match(/(\d+)$/);
        const na = ma ? Number(ma[1]) : 1e9, nb = mb ? Number(mb[1]) : 1e9;
        return na - nb;
      });

      // update local streak from DB if present
      if (typeof d.gachaStreak === 'number') {
        gachaStreak = d.gachaStreak;
        localState.streak = gachaStreak;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(localState)); } catch(e){}
      }

      render();
      console.log('gacha snapshot:', { points: currentPoints, rawCardsPreview: rawCards.slice(0,10), ownedNormalizedLength: ownedNormalized.length });
    }, err => {
      console.error('snapshot error', err);
      render();
    });
  });

  // initial render
  render();

})();
