(function(){
  /**
   * Gacha with escalating price per consecutive attempt.
   * Price progression (per attempt index, 1-based):
   * 1: 10,000
   * 2: 20,000
   * 3: 40,000
   * 4: 80,000
   * 5: 160,000
   * 6: 320,000
   * 7: 640,000
   * 8: 1,280,000
   * 9+: cap at 1,500,000
   *
   * Behavior:
   * - Each time user clicks "สุ่มการ์ด" the streak counter increments (attempts in a row).
   * - Cost for the current click = progression[streak] (with cap).
   * - API: window.SCA_GACHA.resetStreak() available to reset streak.
   * - Guaranteed-new mode (only pick from missing cards).
   */

  // CONFIG
  const TOTAL_CARDS = 60;   // total in collection
  const PROGRESSION = [10000,20000,40000,80000,160000,320000,640000,1280000]; // 1..8
  const CAP_AFTER = 1500000; // 9th and beyond cost cap

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

  // persistence key
  const STORAGE_KEY = 'sca_gacha_state_v2';

  // state
  let state = {
    coins: 500000,     // demo starting coins (adjust as you like)
    owned: [],         // owned card ids
    streak: 0          // consecutive gacha clicks counter (1-based)
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

  // render UI
  function render(){
    coinsEl.textContent = state.coins;
    const m = missingCards().length;
    missingEl.textContent = m;
    totalEl.textContent = TOTAL_CARDS;

    const nextStreak = state.streak + 1; // cost for the next click
    const cost = getCostForStreak(nextStreak);
    costHint.textContent = `ราคาสุ่มครั้งที่ ${nextStreak}: ${cost.toLocaleString()} SCA`;
    gachaBtn.textContent = `สุ่มการ์ด — ${cost.toLocaleString()} SCA`;

    streakEl.textContent = state.streak;

    // show up to 3 recently owned as revealed
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
      alert(`เหรียญไม่พอ (ต้องการ ${cost.toLocaleString()} SCA)`);
      return;
    }

    // pay
    state.coins -= cost;

    // increment streak (this is the Nth attempt)
    state.streak = nextAttempt;

    // grant new card (guaranteed new)
    const got = pickRandom(missing);
    state.owned.push(got);

    save();

    // show modal
    modalBody.innerHTML = `
      <div class='smalltext'>จ่าย ${cost.toLocaleString()} SCA</div>
      <div style='margin-top:10px;font-weight:700'>คุณได้การ์ด #${got}</div>
      <div class='smalltext' style='margin-top:8px;color:var(--muted)'>ครั้งที่สุ่มติดต่อกัน (streak): ${state.streak}</div>
    `;
    modal.classList.remove('hidden');

    render();
  }

  // reset streak manually
  function resetStreak(){
    state.streak = 0;
    save();
    render();
  }

  // reset demo (coins + owned + streak)
  function resetDemo(){
    state = { coins: 500000, owned: [], streak: 0 };
    save();
    render();
  }

  // event listeners
  modalClose.addEventListener('click', ()=>{ modal.classList.add('hidden'); });
  modal.addEventListener('click',(e)=>{ if(e.target === modal) modal.classList.add('hidden'); });
  gachaBtn.addEventListener('click', doGacha);
  resetStreakBtn.addEventListener('click', resetStreak);
  resetDemoBtn.addEventListener('click', resetDemo);

  // public API for integration (mission system can call setCoins/addCoins/setOwned)
  window.SCA_GACHA = {
    getState: ()=> JSON.parse(JSON.stringify(state)),
    setCoins: (n)=> { state.coins = Math.max(0, Math.floor(n)); save(); render(); },
    addCoins: (n)=> { state.coins = Math.max(0, Math.floor(state.coins + n)); save(); render(); },
    setOwned: (arr)=> { state.owned = Array.from(new Set(arr.map(x=>Number(x)))).filter(x=>!isNaN(x)); save(); render(); },
    resetStreak: resetStreak,
    resetDemo: resetDemo
  };

  // initial render
  render();

})();
