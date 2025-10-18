// ======== BEGIN Passive SCA accumulation support ========
const byId = (id) => document.getElementById(id);
const TOTAL_CARDS = 30;

// HUD UI (เพิ่มลงใน card.html ใต้ header หรือที่เหมาะสม)
// <div id="scaHud" style="position:fixed; top:16px; right:16px; z-index:1300;"></div>
(function injectHud() {
  if (!byId('scaHud')) {
    const hud = document.createElement('div');
    hud.id = 'scaHud';
    hud.style.cssText = 'position:fixed;top:16px;right:16px;z-index:1300;background:#fff;border-radius:12px;padding:8px 12px;border:2px solid #ffcdd2;color:#b71c1c;font-weight:800;box-shadow:0 6px 18px rgba(0,0,0,.08);';
    hud.innerHTML = `SCA: <span id="scaPending">0</span> <button id="collectAllBtn" style="margin-left:8px;padding:6px 10px;border-radius:8px;border:none;background:#e53935;color:#fff;font-weight:800;cursor:pointer">รับทั้งหมด</button><div style="font-size:12px;color:#888;margin-top:4px">× <span id="scaMultiplierDisplay">1.0</span></div>`;
    document.body.appendChild(hud);
  }
})();

// variables
let cardRates = null; // mapping cardId -> sca/sec
let ownedCards = new Set();
let currentUserDoc = null;
let scaMultiplier = 1.0;
let lastCollection = null; // Timestamp (JS Date or Firestore Timestamp)
let pendingUpdater = null;

// read cardRates doc once
async function loadCardRates() {
  try {
    const ref = db.collection('cardRates').doc('rates');
    const snap = await ref.get();
    if (snap.exists) {
      cardRates = snap.data() || {};
    } else {
      // fallback mapping if doc missing (put minimal defaults)
      cardRates = { card1: 15, card2: 18 };
    }
  } catch (e) {
    console.warn('loadCardRates failed', e);
    cardRates = { card1: 15, card2: 18 };
  }
}

// compute total rate per second for a given set of owned card ids
function computeTotalRateForOwned(setOwned) {
  if (!cardRates) return 0;
  let sum = 0;
  setOwned.forEach(cid => {
    if (cardRates[cid] !== undefined) sum += Number(cardRates[cid]) || 0;
  });
  return sum;
}

// compute pending SCA (float) given lastCollected timestamp and now
function computePendingSC A(lastCollectionTs, nowDate = new Date()) {
  if (!lastCollectionTs) return 0;
  const lastMs = (lastCollectionTs.toDate) ? lastCollectionTs.toDate().getTime() : new Date(lastCollectionTs).getTime();
  const deltaSeconds = Math.max(0, (nowDate.getTime() - lastMs) / 1000);
  const baseRate = computeTotalRateForOwned(ownedCards);
  const total = deltaSeconds * baseRate * (Number(scaMultiplier) || 1);
  return total;
}

// update HUD display every second
function startPendingUpdater() {
  stopPendingUpdater();
  pendingUpdater = setInterval(() => {
    renderPendingHud();
  }, 1000);
  renderPendingHud();
}
function stopPendingUpdater() {
  if (pendingUpdater) { clearInterval(pendingUpdater); pendingUpdater = null; }
}
function renderPendingHud() {
  const el = byId('scaPending');
  const multEl = byId('scaMultiplierDisplay');
  if (!el) return;
  const pending = computePendingSCA(lastCollection, new Date());
  // show integer or 1 decimal (depending your preference)
  el.textContent = (pending >= 100 ? Math.round(pending) : pending.toFixed(1));
  if (multEl) multEl.textContent = (Number(scaMultiplier) || 1).toFixed(2);
}

// Collect all button -> commit to Firestore in a transaction
async function collectAllToUser(uid) {
  try {
    const userRef = db.collection('users').doc(uid);

    // compute pending now (client)
    const pending = computePendingSCA(lastCollection, new Date());
    const pendingRounded = Math.round(pending); // choose rounding rule

    if (pendingRounded <= 0) {
      toast('ยังไม่มีคะแนนให้รับ'); // reuse toast if exists
      return;
    }

    // Use transaction to increment points and set lastCollection to serverTimestamp
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) {
        throw new Error('User doc missing');
      }
      // Optionally, we could re-calc server-side, but Firestore transactions can't access server time easily.
      tx.update(userRef, {
        points: firebase.firestore.FieldValue.increment(pendingRounded),
        lastCollection: firebase.firestore.FieldValue.serverTimestamp()
      });
    });

    // After success, update local lastCollection to now (serverTimestamp will be set soon by listener)
    lastCollection = new Date();
    renderPendingHud();
    toast(`รับ ${pendingRounded} SCA เรียบร้อย`);
  } catch (e) {
    console.error('collectAll error', e);
    toast('ไม่สามารถรับคะแนนได้ ลองอีกครั้ง');
  }
}

// Hook collect button
document.addEventListener('click', (ev) => {
  if (ev.target && ev.target.id === 'collectAllBtn') {
    const user = firebase.auth().currentUser;
    if (!user) { location.href = 'login.html'; return; }
    collectAllToUser(user.uid);
  }
});

// Integrate with existing user doc listener in auth.onAuthStateChanged
// Replace your old onAuthStateChanged block (or augment it) to include:
auth.onAuthStateChanged(async (user) => {
  if (!user) { location.href = 'login.html'; return; }

  // first load rates
  await loadCardRates();

  // existing code for rendering cards etc.
  setupSidebar();
  renderAllLocked();

  const docRef = db.collection("users").doc(user.uid);

  // ensure user doc has scaMultiplier and lastCollection defaults
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
    // ensure fields exist
    const data = firstSnap.data() || {};
    if (typeof data.scaMultiplier !== 'number') {
      await docRef.set({ scaMultiplier: 1.0 }, { merge: true });
    }
    if (!data.lastCollection) {
      await docRef.set({ lastCollection: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
  }

  // Listen to users/{uid} once (live) and update local states
  docRef.onSnapshot((snap) => {
    const data = snap.exists ? snap.data() || {} : {};
    // cards
    const cards = Array.isArray(data.cards) ? data.cards : [];
    ownedCards = new Set(cards);
    // multiplier & lastCollection
    scaMultiplier = (typeof data.scaMultiplier === 'number') ? data.scaMultiplier : 1.0;
    lastCollection = data.lastCollection || lastCollection || new Date(); // may be Firestore Timestamp
    // re-render visual grid (reuse your renderGrid)
    renderGrid(ownedCards, new Set()); // borrowedSet handled separately in original code
    // start updater (will render using current lastCollection & multiplier)
    startPendingUpdater();
  }, (err) => {
    console.warn('user doc listener error', err);
  });

  // ... retain any other listeners such as shared cards etc. ...
});
// ======== END Passive SCA accumulation support ========
