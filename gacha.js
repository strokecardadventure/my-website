(function(){
  // CONFIG
  const TOTAL_CARDS = 60;
  const PROGRESSION = [10000,20000,40000,80000,160000,320000,640000,1280000];
  const CAP_AFTER = 1500000;
  const BACK_TARGET = 'allcard.html'; // ปรับได้ ถ้าต้องการลิงก์กลับไปหน้าอื่น

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
  const resetStreakBtn = document.getElementById('resetStreakBtn');
  const resetDemoBtn = document.getElementById('resetDemoBtn');
  const backBtn = document.getElementById('backBtn');

  // persistence key
  const STORAGE_KEY = 'sca_gacha_state_v2';

  // state
  let state = {
    coins: 500000,
    owned: [],
    streak: 0
  };

  // load/save
  function save(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function load(){ try{ const raw = localStorage.getItem(STORAGE_KEY); if(raw) state = JSON.parse(raw); }catch(e){} }
  load();

  // helpers
  function missingCards(){
    const missing = [];
    for(let i=0;i<TOTAL_CARDS;i++) if(!state.owned.includes(i)) missing.push(i);
    return missing;
  }

  function getCostForStreak(streak){
    if(streak <= 0) return PROGRESSION[0];
    if(streak <= PROGRESSION.length) return PROGRESSION[streak-1];
    return CAP_AFTER;
  }

  function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
  function fmt(n){ return (typeof n === 'number')? n.toLocaleString() : n; }

  // render UI
  function render(){
    coinsEl.textContent = fmt(state.coins);
    const m = missingCards().length;
    missingEl.textContent = m;
    totalEl.textContent = TOTAL_CARDS;

    const nextStreak = state.streak + 1;
    const cost = getCostForStreak(nextStreak);
    costHint.textContent = `ราคาสุ่มครั้งที่ ${nextStreak}: ${fmt(cost)} SCA`;
    gachaBtn.textContent = `สุ่มการ์ด — ${fmt(cost)} SCA`;

    streakEl.textContent = state.streak;

    const owned = state.owned.slice(-3).reverse();
    const placeholders = cardRow.querySelectorAll('.card');
    placeholders.forEach((el, idx)=>{
      if(owned[idx] !== undefined){
        el.classList.add('revealed');
        el.innerHTML = `<div class="card-front">Card #${owned[idx]}</div>`;
      } else {
        el.classList.remove('revealed');
        el.innerHTML = `<div class='q'>?</div>`;
      }
    });
  }

  // core action
  function doGacha(){
    const missing = missingCards();
    if(missing.length === 0){
      alert('คุณมีการ์ดครบแล้ว!');
      return;
    }

    const nextAttempt = state.streak + 1;
    const cost = getCostForStreak(nextAttempt);

    if(state.coins < cost){
      alert(`เหรียญไม่พอ (ต้องการ ${fmt(cost)} SCA)`);
      return;
    }

    // pay
    state.coins -= cost;

    // increment streak
    state.streak = nextAttempt;

    // grant new card
    const got = pickRandom(missing);
    state.owned.push(got);

    save();

    // show modal
    modalBody.innerHTML = `
      <div class='smalltext'>จ่าย ${fmt(cost)} SCA</div>
      <div style='margin-top:10px;font-weight:700'>คุณได้การ์ด #${got}</div>
      <div class='smalltext' style='margin-top:8px;color:var(--muted)'>streak: ${state.streak}</div>
    `;
    modal.classList.remove('hidden');

    render();
  }

  // reset functions
  function resetStreak(){
    state.streak = 0;
    save();
    render();
  }
  function resetDemo(){
    state = { coins: 500000, owned: [], streak: 0 };
    save();
    render();
  }

  // BACK button: try navigate to allcard.html, fallback to history.back()
  backBtn.addEventListener('click', ()=>{
    // ถ้าหน้า allcard.html อยู่ในโปรเจกต์ ให้เปลี่ยนเส้นทางไป
    try {
      window.location.href = BACK_TARGET;
    } catch(e){
      history.back();
    }
  });

  // listeners
  modalClose.addEventListener('click', ()=>{ modal.classList.add('hidden'); });
  modal.addEventListener('click',(e)=>{ if(e.target === modal) modal.classList.add('hidden'); });
  gachaBtn.addEventListener('click', doGacha);
  resetStreakBtn.addEventListener('click', resetStreak);
  resetDemoBtn.addEventListener('click', resetDemo);

  // Public API for integration with mission system
  window.SCA_GACHA = {
    getState: ()=> JSON.parse(JSON.stringify(state)),
    setCoins: (n)=> { state.coins = Math.max(0, Math.floor(n)); save(); render(); },
    addCoins: (n)=> { state.coins = Math.max(0, Math.floor(state.coins + n)); save(); render(); },
    setOwned: (arr)=> { state.owned = Array.from(new Set(arr.map(x=>Number(x)))).filter(x=>!isNaN(x)); save(); render(); },
    resetStreak: resetStreak,
    resetDemo: resetDemo
  };

  render();
})();
