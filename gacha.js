// gacha.js — integrates with your Firebase users doc (uses 'points' as SCA coins and 'cards' array)
(function(){
  // config: progression
  const TOTAL_CARDS = 60;
  const PROGRESSION = [10000,20000,40000,80000,160000,320000,640000,1280000];
  const CAP_AFTER = 1500000;

  // DOM
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

  // local state (streak kept locally per session)
  const STORAGE_KEY = 'sca_gacha_local_v1';
  let localState = { streak: 0 };
  try { const raw = localStorage.getItem(STORAGE_KEY); if(raw) localState = JSON.parse(raw); } catch(e){}

  // firebase handles (profile.html has already initialized firebase)
  var auth = firebase.auth();
  var db   = firebase.firestore();

  let userUid = null;
  let remoteOwned = []; // authoritative cards array from Firestore
  let currentPoints = 0;

  function fmt(n){ return (typeof n === 'number') ? n.toLocaleString() : n; }

  function getCostForStreak(streak){
    if (streak <= 0) return PROGRESSION[0];
    if (streak <= PROGRESSION.length) return PROGRESSION[streak-1];
    return CAP_AFTER;
  }

  function missingCards(){
    const ownedSet = new Set(Array.isArray(remoteOwned) ? remoteOwned.map(x=>Number(x)) : []);
    const miss = [];
    for(let i=0;i<TOTAL_CARDS;i++){
      if (!ownedSet.has(i)) miss.push(i);
    }
    return miss;
  }

  function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

  function render(){
    coinsEl.textContent = fmt(currentPoints);
    const miss = missingCards();
    missingEl.textContent = miss.length;
    totalEl.textContent = TOTAL_CARDS;

    const nextStreak = (localState.streak || 0) + 1;
    const cost = getCostForStreak(nextStreak);
    costHint.textContent = `ราคาสุ่มครั้งที่ ${nextStreak}: ${fmt(cost)} SCA`;
    gachaBtn.textContent = `สุ่มการ์ด — ${fmt(cost)} SCA`;
    streakEl.textContent = String(localState.streak || 0);

    // update placeholders: show last owned
    const lastOwned = Array.isArray(remoteOwned) ? remoteOwned.slice(-3).reverse() : [];
    const placeholders = cardRow.querySelectorAll('.gacha-card');
    placeholders.forEach((el, idx)=>{
      if (lastOwned[idx] !== undefined) el.textContent = `#${lastOwned[idx]}`;
      else el.textContent = '?';
    });
  }

  // perform gacha: deduct points and write new card to DB
  async function doGacha(){
    const miss = missingCards();
    if (miss.length === 0){ alert('คุณมีการ์ดครบแล้ว!'); return; }

    const nextAttempt = (localState.streak || 0) + 1;
    const cost = getCostForStreak(nextAttempt);

    if (currentPoints < cost){ alert(`เหรียญไม่พอ (ต้องการ ${fmt(cost)} SCA)`); return; }

    // optimistic: disable button to avoid double-click
    gachaBtn.disabled = true;

    // choose random missing card
    const got = pickRandom(miss);

    try {
      // Transaction: deduct points and push new card id
      const userRef = db.collection('users').doc(userUid);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) throw new Error('User doc missing');
        const data = snap.data() || {};
        const pointsNow = Number(data.points || 0);
        if (pointsNow < cost) throw new Error('Insufficient points (concurrent update)');
        // update: decrement points and append card if not present
        const newCards = Array.isArray(data.cards) ? Array.from(new Set(data.cards)) : [];
        if (!newCards.includes(got)) newCards.push(got);
        tx.update(userRef, {
          points: pointsNow - cost,
          cards: newCards
        });
      });

      // if success, bump local streak and local UI (remote listener will update currentPoints & remoteOwned)
      localState.streak = nextAttempt;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(localState)); } catch(e){}

      modalBody.innerHTML = `<div style="font-weight:700">คุณได้การ์ด #${got}</div><div style="margin-top:8px;color:#666">จ่าย ${fmt(cost)} SCA · streak: ${localState.streak}</div>`;
      modal.classList.remove('hidden');

    } catch (err) {
      console.error('gacha txn failed', err);
      alert('เกิดข้อผิดพลาดในการสุ่ม ลองอีกครั้ง');
    } finally {
      gachaBtn.disabled = false;
      render(); // ensure UI consistent
    }
  }

  // modal close
  if (modalClose) modalClose.addEventListener('click', ()=> modal.classList.add('hidden'));
  if (modal) modal.addEventListener('click', (e)=>{ if (e.target === modal) modal.classList.add('hidden'); });

  // back button behavior (like profile)
  if (backBtn) backBtn.addEventListener('click', ()=> { try{ window.location.href = 'allcard.html'; } catch(e){ history.back(); } });

  // gacha click
  if (gachaBtn) gachaBtn.addEventListener('click', doGacha);

  // firebase auth + realtime sync (mirror profile.js approach)
  auth.onAuthStateChanged(function(user){
    if (!user){ location.href = "login.html"; return; }
    userUid = user.uid;

    // subscribe to user's doc
    db.collection('users').doc(userUid).onSnapshot(function(snap){
      if (!snap.exists) return;
      const d = snap.data() || {};
      currentPoints = Number(d.points || 0);
      remoteOwned = Array.isArray(d.cards) ? d.cards : [];
      // render
      render();
    }, function(err){
      console.error('gacha: user snapshot failed', err);
      // still render with local values if any
      render();
    });

    // initial render
    render();
  });

  // initial
  render();

})();
