// ========== card.js (no reset + self-heal) — FULL, with passive SCA support ==========

const byId = (id) => document.getElementById(id);
const TOTAL_CARDS = 30;

/* ---------- Firebase handles are from global page: auth, db (compat) ----------
   Assumes firebase, firebase.auth(), firebase.firestore() loaded globally.
*/

/* ---------- Small toast fallback ---------- */
function toast(msg){
  const t = document.getElementById('toast');
  if (t) {
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(()=> t.classList.remove('show'), 1600);
  } else {
    try { console.log('toast:', msg); } catch(_) {}
  }
}

/* ========== SCA (passive) helpers & HUD ========== */
let cardRates = null;      // mapping cardId -> sca/sec
let ownedSet = new Set();  // live owned cards
let scaMultiplier = 1.0;
let lastCollection = null; // Firestore Timestamp or Date
let pendingUpdater = null;

async function loadCardRates() {
  try {
    const ref = db.collection('cardRates').doc('rates');
    const snap = await ref.get();
    if (snap.exists) {
      cardRates = snap.data() || {};
    } else {
      // fallback values (if doc missing)
      cardRates = {
        card1: 15, card2: 18, card3: 17, card4: 25, card5: 22, card6: 18,
        card7: -6, card8: -7, card9: -11, card10: -21, card11: -5, card12: -8,
        card13: -15, card14: -19, card15: -15, card16: -22, card17: -14, card18: -18,
        card19: 26, card20: 27, card21: 23, card22: 28, card23: 26, card24: 29,
        card25: 30, card26: 31, card27: 32, card28: 0, card29: 0, card30: 0
      };
    }
  } catch (e) {
    console.warn('loadCardRates failed', e);
    cardRates = {
      card1: 15, card2: 18, card3: 17, card4: 25, card5: 22, card6: 18,
      card7: -6, card8: -7, card9: -11, card10: -21, card11: -5, card12: -8,
      card13: -15, card14: -19, card15: -15, card16: -22, card17: -14, card18: -18,
      card19: 26, card20: 27, card21: 23, card22: 28, card23: 26, card24: 29,
      card25: 30, card26: 31, card27: 32, card28: 0, card29: 0, card30: 0
    };
  }
}

function computeTotalRateForOwned(setOwned) {
  if (!cardRates) return 0;
  let sum = 0;
  setOwned.forEach(cid => {
    if (cardRates[cid] !== undefined) sum += Number(cardRates[cid]) || 0;
  });
  return sum;
}

function computePendingSCA(lastCollectionTs, nowDate = new Date()) {
  if (!lastCollectionTs) return 0;
  let lastMs;
  try {
    lastMs = (typeof lastCollectionTs.toDate === 'function')
      ? lastCollectionTs.toDate().getTime()
      : new Date(lastCollectionTs).getTime();
  } catch (e) { lastMs = new Date().getTime(); }
  const deltaSeconds = Math.max(0, (nowDate.getTime() - lastMs) / 1000);
  const baseRate = computeTotalRateForOwned(ownedSet);
  return deltaSeconds * baseRate * (Number(scaMultiplier) || 1);
}

/* HUD injection (if not present) */
(function injectHud(){
  if (!byId('scaHud')) {
    const hud = document.createElement('div');
    hud.id = 'scaHud';
    hud.style.cssText = 'position:fixed;top:16px;right:16px;z-index:1300;background:#fff;border-radius:12px;padding:8px 12px;border:2px solid #ffcdd2;color:#b71c1c;font-weight:800;box-shadow:0 6px 18px rgba(0,0,0,.08);';
    // default uses image coin if exists; else you can swap to emoji '🪙' in code.
    const coinImgHTML = '<img src="assets/coin-gold.png" style="width:18px;vertical-align:middle;margin-right:6px">';
    hud.innerHTML = `${coinImgHTML} <span style="font-weight:800">SCA coins:</span> <span id="scaPending">0</span>
      <button id="collectAllBtn" style="margin-left:8px;padding:6px 10px;border-radius:8px;border:none;background:#e53935;color:#fff;font-weight:800;cursor:pointer">รับทั้งหมด</button>
      <div style="font-size:12px;color:#888;margin-top:4px">× <span id="scaMultiplierDisplay">1.00</span></div>`;
    document.body.appendChild(hud);
  }
})();

function renderPendingHud() {
  const el = byId('scaPending');
  const multEl = byId('scaMultiplierDisplay');
  if (!el) return;
  const pending = computePendingSCA(lastCollection, new Date());
  el.textContent = (pending >= 100 ? Math.round(pending) : pending.toFixed(1));
  if (multEl) multEl.textContent = (Number(scaMultiplier) || 1).toFixed(2);
}

function startPendingUpdater() {
  stopPendingUpdater();
  pendingUpdater = setInterval(renderPendingHud, 1000);
  renderPendingHud();
}
function stopPendingUpdater() {
  if (pendingUpdater) { clearInterval(pendingUpdater); pendingUpdater = null; }
}

async function collectAllToUser(uid) {
  try {
    const userRef = db.collection('users').doc(uid);
    const pending = computePendingSCA(lastCollection, new Date());
    const pendingRounded = Math.round(pending);
    if (pendingRounded <= 0) { toast('ยังไม่มีคะแนนให้รับ'); return; }

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) throw new Error('User doc missing');
      tx.update(userRef, {
        points: firebase.firestore.FieldValue.increment(pendingRounded),
        lastCollection: firebase.firestore.FieldValue.serverTimestamp()
      });
    });

    lastCollection = new Date();
    renderPendingHud();
    toast(`รับ ${pendingRounded} SCA เรียบร้อย`);
  } catch (e) {
    console.error('collectAll error', e);
    toast('ไม่สามารถรับคะแนนได้ ลองอีกครั้ง');
  }
}

/* Hook collect button */
document.addEventListener('click', (ev) => {
  if (ev.target && ev.target.id === 'collectAllBtn') {
    const user = firebase.auth().currentUser;
    if (!user) { location.href = 'login.html'; return; }
    collectAllToUser(user.uid);
  }
});

/* ========== Existing card rendering & helpers (untouched logic but slightly adapted) ========== */

/* ---------- Sidebar ---------- */
function setupSidebar() {
  const toggleBtn = byId("menu-toggle");
  const sidebar   = byId("sidebar");
  const overlay   = byId("overlay");
  const closeBtn  = byId("close-sidebar");
  const logout    = byId("logout-link");

  const open  = () => { sidebar.classList.add("open");  overlay.classList.add("active"); };
  const close = () => { sidebar.classList.remove("open"); overlay.classList.remove("active"); };

  if (toggleBtn) toggleBtn.addEventListener("click", open);
  if (closeBtn)  closeBtn.addEventListener("click", close);
  if (overlay)   overlay.addEventListener("click", close);
  if (logout)    logout.addEventListener("click", (e)=>{ e.preventDefault(); auth.signOut().then(()=>location.href="login.html"); });

  document.querySelectorAll("#sidebar .menu-item a").forEach(a=>{
    if (!a.closest("#logout-link")) a.addEventListener("click", close);
  });
}

/* ---------- Modal ---------- */
function showModal(html) {
  const modal = byId("modal");
  if (!modal) return;
  modal.innerHTML = `<div class="modal-content">${html}<br><button class="modal-close">OK</button></div>`;
  modal.classList.add("active");
  modal.querySelector(".modal-close").onclick = () => modal.classList.remove("active");
}

/* ---------- Rendering ---------- */
function renderGrid(ownedSetLocal, borrowedSet) {
  const grid = byId("cardGrid");
  if (!grid) return;
  grid.innerHTML = "";

  for (let i = 1; i <= TOTAL_CARDS; i++) {
    const cid = `card${i}`;
    const owned    = ownedSetLocal?.has(cid);
    const borrowed = borrowedSet?.has(cid);
    const card = document.createElement("div");

    if (owned || borrowed) {
      card.className = "card unlocked";
      card.style.backgroundImage = `url(assets/cards/${cid}.png)`;
      if (borrowed && !owned) {
        card.style.border    = "2.5px solid #ffcdd2";
        card.style.boxShadow = "0 4px 18px rgba(255,205,210,.7)";
        card.title = `Card ${i} (borrowed)`;
      } else {
        card.title = `Card ${i}`;
      }
      card.addEventListener("click", () => {
        const label = borrowed && !owned
          ? `Card ${i} <small style="color:#b71c1c">(borrowed)</small>`
          : `Card ${i}`;

        // get rate for this card (from cardRates)
        const rate = (cardRates && cardRates[cid]) ? Number(cardRates[cid]) : 0;
        // use coin image HTML (make sure assets/coin-gold.png exists) — fallback could be emoji
        const coinIcon = '<img src="assets/coin-gold.png" style="width:20px;vertical-align:middle;margin-right:8px">';

        showModal(
          `<img src="assets/cards/${cid}.png" alt="Card ${i}" style="max-width:220px;border-radius:12px;">
           <div style="margin-top:1em;">${label}</div>
           <div style="margin-top:.6em;font-weight:700;color:#b71c1c;">${coinIcon} ${rate} / sec</div>`
        );
      });
    } else {
      card.className = "card locked";
      card.innerHTML = `<span class="lock-icon">&#128274;</span>`;
    }

    card.innerHTML += `<span class="card-num">${i}</span>`;
    grid.appendChild(card);
  }
}

function renderAllLocked() { renderGrid(new Set(), new Set()); }

/* ---------- Self-heal from cardKeys ---------- */
async function healOwnedCards(uid) {
  try {
    const q = await db.collection('cardKeys').where('claimedBy','==',uid).limit(200).get();
    if (q.empty) return false;
    const ids = [];
    q.forEach(d => { const v = d.data(); if (v && typeof v.cardId === 'string') ids.push(v.cardId); });
    if (!ids.length) return false;

    const ref = db.collection('users').doc(uid);
    for (let i=0;i<ids.length;i+=10){
      const slice = ids.slice(i, i+10);
      await ref.set({ cards: firebase.firestore.FieldValue.arrayUnion(...slice) }, { merge:true });
    }
    return true;
  } catch (e) {
    console.warn('healOwnedCards failed', e);
    return false;
  }
}

/* ---------- Self-heal for feedback reward (card30 + +5) ---------- */
async function ensureFeedbackAwardApplied(uid, data){
  const flags = data.flags || {};
  if (!flags.feedbackAwardGiven) return;

  const cards = Array.isArray(data.cards) ? data.cards : [];
  const hasCard30 = cards.includes('card30');

  if (hasCard30) {
    if (!flags.feedbackAwardPatched) {
      await db.collection('users').doc(uid).set({ flags: { feedbackAwardPatched: true } }, { merge: true });
    }
    return;
  }

  await db.collection('users').doc(uid).set({
    cards:  firebase.firestore.FieldValue.arrayUnion('card30'),
    points: firebase.firestore.FieldValue.increment(5),
    flags: {
      feedbackAwardPatched: true,
      pointsFromFeedbackApplied: true
    }
  }, { merge: true });
}

/* ---------- Start (integrated with SCA loader and listener) ---------- */
auth.onAuthStateChanged(async (user) => {
  if (!user) { location.href = "login.html"; return; }
  setupSidebar();

  renderAllLocked();
  await loadCardRates();

  const docRef = db.collection("users").doc(user.uid);

  // Ensure user doc has sca fields
  const firstSnap = await docRef.get();
  if (!firstSnap.exists) {
    await docRef.set({
      username: (user.email || "").split("@")[0] || "user",
      cards: [],
      mission: Array(15).fill(false),
      points: 0,
      scaMultiplier: 1.0,
      lastCollection: firebase.firestore.FieldValue.serverTimestamp(),
      flags: { feedbackDone:false, befastDone:false, feedbackAwardGiven:false }
    }, { merge: true });
  } else {
    const d = firstSnap.data() || {};
    if (typeof d.scaMultiplier !== 'number') await docRef.set({ scaMultiplier: 1.0 }, { merge:true });
    if (!d.lastCollection) await docRef.set({ lastCollection: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
  }

  const borrowedSet = new Set();
  let didFirstRender = false;
  let healedOnce = false;

  setTimeout(async () => {
    if (!didFirstRender) {
      try {
        const snap = await docRef.get();
        const data  = snap.exists ? (snap.data() || {}) : {};
        const cards = Array.isArray(data.cards) ? data.cards : [];
        ownedSet.clear(); cards.forEach(c => ownedSet.add(c));
        renderGrid(ownedSet, borrowedSet);
      } catch (e) { console.warn('initial render failed', e); }
    }
  }, 1500);

  docRef.onSnapshot(async (snap) => {
    const data  = snap.exists ? (snap.data() || {}) : {};
    const cards = Array.isArray(data.cards) ? data.cards : [];

    // self-heal feedback award if needed
    ensureFeedbackAwardApplied(user.uid, data).catch(()=>{});

    // try heal cards from cardKeys if empty (once)
    if (!healedOnce && cards.length === 0) {
      healedOnce = true;
      const healed = await healOwnedCards(user.uid);
      if (healed) return;
    }

    ownedSet.clear(); cards.forEach(c => ownedSet.add(c));

    scaMultiplier = (typeof data.scaMultiplier === 'number') ? data.scaMultiplier : scaMultiplier || 1.0;
    lastCollection = data.lastCollection || lastCollection || new Date();

    renderGrid(ownedSet, borrowedSet);
    didFirstRender = true;
    startPendingUpdater();
  }, (err) => {
    console.warn("users doc listener error:", err);
    renderGrid(ownedSet, borrowedSet);
    startPendingUpdater();
  });

  // shared collection: borrowed cards
  docRef.collection("shared").onSnapshot((qs) => {
    borrowedSet.clear();
    qs.forEach(d => {
      const v = d.data();
      if (v && typeof v.cardId === "string") borrowedSet.add(v.cardId);
    });
    renderGrid(ownedSet, borrowedSet);
  }, (err) => {
    console.warn("shared listener error:", err);
    renderGrid(ownedSet, borrowedSet);
  });
});
