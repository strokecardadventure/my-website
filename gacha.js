// gacha.js — ready-to-drop, integrated with Firestore (points/cards)
(function(){
  // --- CONFIG
  const TOTAL_CARDS = 60;
  const PROGRESSION = [10000,20000,40000,80000,160000,320000,640000,1280000];
  const CAP_AFTER = 1500000;
  const STORAGE_KEY = 'sca_gacha_local_v1';
  const BACK_FALLBACK = 'alldata.html'; // fallback page when no referrer (adjust if needed)

  // --- DOM
  const coinsEl = document.getElementById('coins');
  const missingEl = document.getElementById('missing');
  const totalEl = document.getElementById('total');
  const gachaBtn = document.getElementById('gachaBtn');
  const costHint = document.getElementById('costHint');
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modalBody');
  const modalClose = document.getElementById('modalClose');
  const cardRow = document.getElementById('cardRow');
  const streakEl = document.getElementById('streak');
  const backBtn = document.getElementById('backBtn');

  // --- local state
  let localState = { streak: 0 };
  try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) localState = JSON.parse(raw); } catch(e){}

  // --- Firebase handles (profile.html already initialized same config)
  var auth = firebase.auth();
  var db   = firebase.firestore();

  let userUid = null;
  let remoteOwned = [];
  let currentPoints = 0;

  // --- helpers
  function fmt(n){ return (typeof n === 'number') ? n.toLocaleString() : n; }
  function getCostForStreak(streak){
    if (streak <= 0) return PROGRESSION[0];
    if (streak <= PROGRESSION.length) return PROGRESSION[streak-1];
    return CAP_AFTER;
  }
  function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

  function normalizeCardsField(raw){
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(x=>Number(x)).filter(x=>!isNaN(x));
    if (typeof raw === 'object'){
      try { return Object.values(raw).map(x=>Number(x)).filter(x=>!isNaN(x)); } catch(e){}
    }
    return [];
  }

  function missingCards(){
    const ownedSet = new Set( Array.isArray(remoteOwned) ? remoteOwned.map(x=>Number(x)) : [] );
    const miss = [];
    for (let i=0;i<TOTAL_CARDS;i++) if (!ownedSet.has(i)) miss.push(i);
    return miss;
  }

  // --- render UI
  function render(){
    if (coinsEl) coinsEl.textContent = fmt(currentPoints);
    if (missingEl) missingEl.textContent = missingCards().length;
    if (totalEl) totalEl.textContent = TOTAL_CARDS;

    const nextStreak = (localState.streak || 0) + 1;
    const cost = getCostForStreak(nextStreak);
    if (costHint) costHint.textContent = `ราคาสุ่มครั้งที่ ${nextStreak}: ${fmt(cost)} SCA`;
    if (gachaBtn) gachaBtn.textContent = `สุ่มการ์ด — ${fmt(cost)} SCA`;
    if (streakEl) streakEl.textContent = String(localState.streak || 0);

    // placeholders (show last owned up to 3)
    const lastOwned = Array.isArray(remoteOwned) ? remoteOwned.slice(-3).reverse() : [];
    const placeholders = cardRow ? cardRow.querySelectorAll('.gacha-card') : [];
    placeholders.forEach((el, idx)=>{
      if (lastOwned[idx] !== undefined) el.textContent = `#${lastOwned[idx]}`;
      else el.textContent = '?';
    });
  }

  // --- core gacha (transaction: deduct points and add card)
  async function doGacha(){
    const miss = missingCards();
    if (miss.length === 0) { alert('คุณมีการ์ดครบแล้ว!'); return; }

    const nextAttempt = (localState.streak || 0) + 1;
    const cost = getCostForStreak(nextAttempt);

    if (currentPoints < cost){ alert(`เหรียญไม่พอ (ต้องการ ${fmt(cost)} SCA)`); return; }

    gachaBtn.disabled = true;
    const got = pickRandom(miss);

    try {
      const userRef = db.collection('users').doc(userUid);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) throw new Error('User doc missing');
        const data = snap.data() || {};
        // accept multiple possible point field names
        const pointsNow = Number(data.points || data.sca || data.balance || 0);
        if (pointsNow < cost) throw new Error('Insufficient points (concurrent update)');

        const prevCards = normalizeCardsField(data.cards);
        const newCards = Array.from(new Set(prevCards.concat([got])));
        tx.update(userRef, {
          points: pointsNow - cost,
          cards: newCards
        });
      });

      // success: update streak locally
      localState.streak = nextAttempt;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(localState)); } catch(e){}

      modalBody.innerHTML = `<div style="font-weight:700">คุณได้การ์ด #${got}</div>
                             <div style="margin-top:8px;color:#666">จ่าย ${fmt(cost)} SCA · streak: ${localState.streak}</div>`;
      modal.classList.remove('hidden');

    } catch (err){
      console.error('gacha txn failed', err);
      alert('เกิดข้อผิดพลาดในการสุ่ม ลองอีกครั้ง');
    } finally {
      gachaBtn.disabled = false;
      render();
    }
  }

  // --- events
  if (modalClose) modalClose.addEventListener('click', ()=> modal.classList.add('hidden'));
  if (modal) modal.addEventListener('click', (e)=>{ if (e.target === modal) modal.classList.add('hidden'); });

  if (gachaBtn) gachaBtn.addEventListener('click', doGacha);

  if (backBtn) backBtn.addEventListener('click', ()=>{
    try {
      if (document.referrer && document.referrer.indexOf(location.host) !== -1) history.back();
      else window.location.href = BACK_FALLBACK;
    } catch(e){
      history.back();
    }
  });

  // --- Firebase auth + realtime sync (listen to user doc)
  auth.onAuthStateChanged(function(user){
    if (!user) { location.href = 'login.html'; return; }
    userUid = user.uid;

    db.collection('users').doc(userUid).onSnapshot(function(snap){
      if (!snap.exists) { currentPoints = 0; remoteOwned = []; render(); return; }
      const data = snap.data() || {};
      currentPoints = Number(data.points || data.sca || data.balance || 0);
      remoteOwned = normalizeCardsField(data.cards);
      console.log('gacha snapshot:', { uid: userUid, points: currentPoints, cardsRaw: data.cards, cardsNormalized: remoteOwned });
      render();
    }, function(err){
      console.error('gacha: snapshot error', err);
      render();
    });

    render();
  });

  // initial render
  render();

})();
