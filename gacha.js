// gacha.js — Safe Gacha: backup -> transaction (arrayUnion) -> normalize card ids
(function(){
  // Config
  const GACHA_TOTAL = 60;
  const BASE_COST = 10000;
  const COST_MULTIPLIER = 2;
  const MAX_COST = 1500000;
  const BACKUP_SUBCOL = '_backups'; // under users/{uid}/_backups/{ts}

  // DOM refs
  const $ = id => document.getElementById(id);
  const scaEl = $('scaCoins');
  const missingEl = $('missingCount');
  const totalEl = $('totalCards');
  const streakEl = $('streak');
  const gachaBtn = $('gachaBtn');
  const costHint = $('costHint');
  const modal = $('modal');
  const modalBody = $('modalBody');
  const modalClose = $('modalClose');
  const cardRow = $('cardRow');
  const backBtn = $('backBtn');

  // Firebase
  const auth = firebase.auth();
  const db = firebase.firestore();

  // Local state
  let currentUser = null;
  let currentPoints = 0;
  let ownedCards = []; // normalized "cardNN"
  let gachaStreak = 0;

  // Helpers
  function fmtNumber(n){
    if (typeof n !== 'number') return String(n);
    if (n >= 1000000) return Math.round(n/100000)/10 + 'm';
    if (n >= 1000) return Math.round(n/100)/10 + 'k';
    return String(n);
  }

  function normalizeCardID(v){
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    // already like "cardNN" (case-insensitive)
    const mCard = s.match(/^card\s*0*([0-9]+)$/i);
    if (mCard) return 'card' + Number(mCard[1]);
    // pure number like "41"
    const mNum = s.match(/^(\d+)$/);
    if (mNum) return 'card' + Number(mNum[1]);
    // contains digits
    const m = s.match(/(\d+)/);
    if (m) return 'card' + Number(m[1]);
    // fallback: return original string (but we prefer cardNN)
    return s;
  }

  function getNextCost(streak){
    let cost = BASE_COST * Math.pow(COST_MULTIPLIER, streak);
    if (cost > MAX_COST) return MAX_COST;
    return Math.round(cost);
  }

  function allCardIDs(){
    // use 1..GACHA_TOTAL as cards (card1 .. cardN)
    return Array.from({length:GACHA_TOTAL}, (_,i) => 'card' + (i+1));
  }

  function render(){
    if (scaEl) scaEl.textContent = fmtNumber(currentPoints);
    if (missingEl) missingEl.textContent = Math.max(0, GACHA_TOTAL - ownedCards.length);
    if (totalEl) totalEl.textContent = GACHA_TOTAL;
    if (streakEl) streakEl.textContent = String(gachaStreak || 0);
    const nextCost = getNextCost(gachaStreak || 0);
    if (costHint) costHint.textContent = `ราคาสุ่มครั้งที่ ${ (gachaStreak||0) + 1 }: ${fmtNumber(nextCost)} SCA`;
    if (gachaBtn) gachaBtn.textContent = `สุ่มการ์ด — ${fmtNumber(nextCost)} SCA`;

    // show last owned (up to 3)
    if (cardRow){
      const last = ownedCards.slice(-3).reverse();
      const placeholders = cardRow.querySelectorAll('.gacha-card');
      placeholders.forEach((el, idx)=>{
        if (last[idx]) el.textContent = last[idx];
        else el.textContent = '?';
      });
    }
  }

  // Listen user doc
  auth.onAuthStateChanged(user => {
    if (!user) { currentUser = null; return; }
    currentUser = user;
    const ref = db.collection('users').doc(user.uid);
    ref.onSnapshot(snap => {
      if (!snap.exists){
        currentPoints = 0; ownedCards = []; gachaStreak = 0; render(); return;
      }
      const d = snap.data() || {};
      currentPoints = Number(d.points || d.sca || d.balance || 0);
      gachaStreak = Number(d.gachaStreak || 0) || 0;

      // Normalize cards: support array, object, or numeric fields expanded
      let collected = [];
      if (Array.isArray(d.cards)) {
        collected = d.cards.map(normalizeCardID).filter(Boolean);
      } else if (d.cards && typeof d.cards === 'object') {
        // object/map -> values
        collected = Object.values(d.cards).map(normalizeCardID).filter(Boolean);
      } else {
        // fallback: inspect top-level fields that look like card entries
        Object.keys(d).forEach(k => {
          if (/^\d+$/.test(k) || /^card\d+$/i.test(k)) {
            const v = d[k];
            const nid = normalizeCardID(v !== undefined ? v : k);
            if (nid) collected.push(nid);
          }
        });
      }

      // remove duplicates and sort by numeric suffix
      const unique = Array.from(new Set(collected));
      unique.sort((a,b)=>{
        const ma = a.match(/(\d+)$/); const mb = b.match(/(\d+)$/);
        const na = ma ? Number(ma[1]) : 1e9;
        const nb = mb ? Number(mb[1]) : 1e9;
        return na - nb;
      });

      ownedCards = unique;
      render();
    }, err => {
      console.error('gacha: snapshot error', err);
      render();
    });
  });

  // Backup helper
  async function backupUserDoc(uid){
    try {
      const ref = db.collection('users').doc(uid);
      const snap = await ref.get();
      const data = snap.exists ? snap.data() : {};
      const backupRef = ref.collection(BACKUP_SUBCOL).doc(String(Date.now()));
      await backupRef.set({
        snapshot: data,
        ts: firebase.firestore.FieldValue.serverTimestamp()
      });
      return backupRef.path;
    } catch (e) {
      console.warn('backup failed', e);
      return null;
    }
  }

  // Main gacha action (safe)
  async function doGacha(){
    if (!currentUser) { alert('กรุณาเข้าสู่ระบบ'); return; }
    const uid = currentUser.uid;
    const userRef = db.collection('users').doc(uid);

    const nextCost = getNextCost(gachaStreak || 0);

    // quick local check
    if (currentPoints < nextCost){
      alert(`คะแนนไม่พอ (ต้องการ ${fmtNumber(nextCost)} SCA)`); return;
    }

    const all = allCardIDs();
    const missing = all.filter(c => !ownedCards.includes(c));
    if (missing.length === 0){
      alert('คุณมีครบทุกการ์ดแล้ว!');
      return;
    }

    // pick random missing
    const pick = missing[Math.floor(Math.random() * missing.length)];

    // backup before update (best effort)
    try {
      await backupUserDoc(uid);
    } catch(e){
      console.warn('backup threw', e);
    }

    // transaction: re-check points and update atomically inserting card via arrayUnion
    try {
      await db.runTransaction(async tx => {
        const snap = await tx.get(userRef);
        if (!snap.exists) throw new Error('User doc missing');
        const data = snap.data() || {};
        const curPoints = Number(data.points || data.sca || data.balance || 0);
        if (curPoints < nextCost) throw new Error('คะแนนไม่พอ (ขณะทำรายการ)');
        // Use arrayUnion to append if not present
        tx.update(userRef, {
          points: firebase.firestore.FieldValue.increment(-nextCost),
          cards: firebase.firestore.FieldValue.arrayUnion(pick),
          gachaStreak: firebase.firestore.FieldValue.increment(1)
        });
      });

      // success: show modal (UI will update via snapshot listener)
      if (modalBody) modalBody.innerHTML = `<div style="font-weight:700">คุณได้การ์ดใหม่: ${pick}</div><div style="margin-top:8px;color:#666">จ่าย ${fmtNumber(nextCost)} SCA</div>`;
      if (modal) modal.classList.remove('hidden');

    } catch (err) {
      console.error('gacha transaction failed', err);
      alert('ไม่สามารถสุ่มได้ในขณะนี้ ลองอีกครั้ง');
    }
  }

  // Events
  if (gachaBtn) gachaBtn.addEventListener('click', doGacha);
  if (modalClose) modalClose.addEventListener('click', ()=> modal.classList.add('hidden'));
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

  if (backBtn) backBtn.addEventListener('click', ()=>{
    try {
      if (document.referrer && document.referrer.includes(location.host)) history.back();
      else window.location.href = 'alldata.html';
    } catch(e){ history.back(); }
  });

  // initial render (safe)
  render();
})();
