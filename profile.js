// profile.js — sidebar + profile (การ์ด rendering ถูกลบตามคำขอ)
// เพิ่มระบบ SCA (passive accumulation) ในไฟล์นี้ (suffix _p เพื่อแยกจาก mission.js)

// ===== Firebase handles =====
var auth = firebase.auth();
var db   = firebase.firestore();

// ===== Helpers =====
function $(id){ return document.getElementById(id); }
var toastEl = $("toast");
function toast(t){
  if (!toastEl) { alert(t); return; }
  toastEl.textContent = t;
  toastEl.classList.add("show");
  setTimeout(function(){ toastEl.classList.remove("show"); }, 1600);
}

// ===== Sidebar (match other pages; no optional chaining) =====
function setupSidebar(){
  var toggleBtn = $("menu-toggle");
  var sidebar   = $("sidebar");
  var overlay   = $("overlay");
  var closeBtn  = $("close-sidebar");
  var logout    = $("logout-link");

  function open(){ if (sidebar) sidebar.classList.add("open"); if (overlay) overlay.classList.add("active"); }
  function close(){ if (sidebar) sidebar.classList.remove("open"); if (overlay) overlay.classList.remove("active"); }

  if (toggleBtn) toggleBtn.addEventListener("click", open);
  if (closeBtn)  closeBtn.addEventListener("click", close);
  if (overlay)   overlay.addEventListener("click", close);

  var links = document.querySelectorAll("#sidebar .menu-item a");
  for (var i=0;i<links.length;i++){
    if (!links[i].closest || !links[i].closest("#logout-link")) {
      links[i].addEventListener("click", close);
    }
  }

  if (logout) logout.addEventListener("click", function(e){
    e.preventDefault();
    auth.signOut().then(function(){ location.href="login.html"; });
  });
}

// ===== Username mapping utilities =====
function ensureUsernameMapping(uid, uname){
  uname = String(uname || "").trim().toLowerCase();
  if (!uname) return Promise.resolve();
  return db.collection("usernames").doc(uname)
           .set({ uid: uid, username: uname }, { merge: true });
}

function renameUsernameMapping(uid, oldU, newU){
  oldU = String(oldU || "").trim().toLowerCase();
  newU = String(newU || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,20}$/.test(newU)) {
    return Promise.reject(new Error("Username must be 3–20 chars (a-z, 0-9, dot, _, -)."));
  }
  if (oldU === newU) return Promise.resolve();

  return db.collection("usernames").doc(newU).set({ uid: uid, username: newU }, { merge: true })
    .then(function(){
      if (!oldU) return;
      return db.collection("usernames").doc(oldU).get().then(function(s){
        if (s.exists && s.data() && s.data().uid === uid){
          return db.collection("usernames").doc(oldU).delete();
        }
      });
    });
}

/* === Identity hook ===
   Makes sure /users/{uid}.username exists and /usernames/{name}->{uid}.
   If the name is taken by someone else, suffix -xxxx and write both places. */
function ensureIdentity(user){
  var uref = db.collection("users").doc(user.uid);
  return uref.get().then(function(snap){
    var data = snap.exists ? (snap.data() || {}) : {};
    var emailName = (user.email || "").split("@")[0] || "user";
    var uname = String(data.username || emailName).trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
    if (uname.length < 3) uname = "user-" + user.uid.slice(0,4).toLowerCase();

    // Merge user doc (never wipe other fields)
    return uref.set({
      username: uname,
      about: data.about || "",
      // keep cards field untouched — but we won't render them in this page
      cards: Array.isArray(data.cards) ? data.cards : [],
      mission: Array.isArray(data.mission) ? data.mission : Array(15).fill(false),
      points: (typeof data.points === "number") ? data.points : 0,
      quizCount: (typeof data.quizCount === "number") ? data.quizCount : 0,
      quizStreak: (typeof data.quizStreak === "number") ? data.quizStreak : 0,
      quizLastYmd: data.quizLastYmd || null,
      // login streak fields (if not present, set defaults)
      loginStreak: (typeof data.loginStreak === "number") ? data.loginStreak : 0,
      loginLastYmd: data.loginLastYmd || null
    }, { merge: true }).then(function(){
      // Try claim mapping
      return ensureUsernameMapping(user.uid, uname).then(function(){
        return uref.get().then(function(fin){ return { data: fin.data() || {}, uname: uname }; });
      }).catch(function(){
        // If taken, suffix and retry once
        var fallback = uname + "-" + user.uid.slice(0,4).toLowerCase();
        return db.collection("usernames").doc(fallback)
          .set({ uid: user.uid, username: fallback }, { merge: true })
          .then(function(){
            return uref.set({ username: fallback }, { merge: true })
              .then(function(){ return { data: Object.assign({}, data, { username: fallback }), uname: fallback }; });
          });
      });
    });
  });
}

// ===== SCA passive helpers for profile page (suffix _p) =====
let cardRates_p = null;
let ownedSet_p = new Set();
let scaMultiplier_p = 1.0;
let lastCollection_p = null;
let pendingUpdater_p = null;

async function loadCardRates_p(){
  try {
    const ref = db.collection('cardRates').doc('rates');
    const snap = await ref.get();
    cardRates_p = snap.exists ? (snap.data() || {}) : { card1:15, card2:18 };
  } catch (e) {
    console.warn('loadCardRates_p', e);
    cardRates_p = { card1:15, card2:18 };
  }
}
function computeTotalRateForOwned_p(setOwned) {
  if (!cardRates_p) return 0;
  let s = 0;
  setOwned.forEach(cid => { if (cardRates_p[cid] !== undefined) s += Number(cardRates_p[cid])||0; });
  return s;
}
function computePendingSCA_p(lastCollectionTs, nowDate = new Date()){
  if (!lastCollectionTs) return 0;
  let lastMs;
  try {
    lastMs = (typeof lastCollectionTs.toDate === 'function') ? lastCollectionTs.toDate().getTime() : new Date(lastCollectionTs).getTime();
  } catch(e){ lastMs = new Date().getTime(); }
  const deltaSeconds = Math.max(0, (nowDate.getTime() - lastMs) / 1000);
  const baseRate = computeTotalRateForOwned_p(ownedSet_p);
  return deltaSeconds * baseRate * (Number(scaMultiplier_p) || 1);
}

(function injectHud_p(){
  if (!document.getElementById('scaHud_p')) {
    const hud = document.createElement('div');
    hud.id = 'scaHud_p';
    hud.style.cssText = 'position:fixed;top:16px;right:16px;z-index:1300;background:#fff;border-radius:12px;padding:8px 12px;border:2px solid #ffcdd2;color:#b71c1c;font-weight:800;box-shadow:0 6px 18px rgba(0,0,0,.08);';
    hud.innerHTML = `SCA: <span id="scaPending_p">0</span>
      <button id="collectAllBtn_p" style="margin-left:8px;padding:6px 10px;border-radius:8px;border:none;background:#e53935;color:#fff;font-weight:800;cursor:pointer">รับทั้งหมด</button>
      <div style="font-size:12px;color:#888;margin-top:4px">× <span id="scaMultiplierDisplay_p">1.00</span></div>`;
    document.body.appendChild(hud);
  }
})();

function renderPendingHud_p(){
  const el = document.getElementById('scaPending_p');
  const multEl = document.getElementById('scaMultiplierDisplay_p');
  if (!el) return;
  const pending = computePendingSCA_p(lastCollection_p, new Date());
  el.textContent = (pending >= 100 ? Math.round(pending) : pending.toFixed(1));
  if (multEl) multEl.textContent = (Number(scaMultiplier_p)||1).toFixed(2);
}
function startPendingUpdater_p(){ stopPendingUpdater_p(); pendingUpdater_p = setInterval(renderPendingHud_p,1000); renderPendingHud_p(); }
function stopPendingUpdater_p(){ if (pendingUpdater_p){ clearInterval(pendingUpdater_p); pendingUpdater_p = null; } }

async function collectAllToUser_p(uid){
  try {
    const userRef = db.collection('users').doc(uid);
    const pending = computePendingSCA_p(lastCollection_p, new Date());
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
    lastCollection_p = new Date();
    renderPendingHud_p();
    toast(`รับ ${pendingRounded} SCA เรียบร้อย`);
  } catch (e) {
    console.error('collectAll_p fail', e);
    toast('ไม่สามารถรับคะแนนได้ ลองอีกครั้ง');
  }
}

document.addEventListener('click', (ev) => {
  if (ev.target && ev.target.id === 'collectAllBtn_p') {
    const user = firebase.auth().currentUser;
    if (!user) { location.href='login.html'; return; }
    collectAllToUser_p(user.uid);
  }
});

// ===== App =====
auth.onAuthStateChanged(function(user){
  if (!user){ location.href = "login.html"; return; }

  setupSidebar();

  // Show UID ASAP so UI never stays blank
  if ($("uid")) $("uid").textContent = user.uid;

  // <<< เพิ่ม: ถ้ามีฟังก์ชัน global ให้เรียกอัปเดต streakก่อนโหลด UI >>>>
  if (window.updateLoginStreakIfNeeded) {
    try { window.updateLoginStreakIfNeeded(user); } catch(e){ console.warn('profile: update streak failed', e); }
  }
  // <<< end addition >>>

  ensureIdentity(user).then(async function(res){
    var data = res.data || {};
    var uname = res.uname || ((user.email||"").split("@")[0] || "user");

    if ($("displayName")) $("displayName").textContent = uname;
    if ($("username")) $("username").value = uname;
    if ($("about"))    $("about").value = data.about || "";
    if ($("points"))   $("points").textContent = String(data.points || 0);
    if ($("quizCount"))  $("quizCount").textContent = String(data.quizCount || 0);
    if ($("quizStreak")) $("quizStreak").textContent = String(data.quizStreak || 0);
    if ($("loginStreak")) $("loginStreak").textContent = String(data.loginStreak || 0);

    // ---- realtime listener for profile and SCA ----
    if (!window.__profileUserSnapUnsub) {
      // ensure cardRates loaded (non-blocking)
      loadCardRates_p().catch(()=>{});
      window.__profileUserSnapUnsub = db.collection("users").doc(user.uid)
        .onSnapshot(function(s){
          if (!s.exists) return;
          var live = s.data() || {};
          if ($("points"))   $("points").textContent = String(live.points || 0);
          if ($("loginStreak")) $("loginStreak").textContent = String(live.loginStreak || 0);
          if ($("quizCount")) $("quizCount").textContent = String(live.quizCount || 0);
          if ($("quizStreak")) $("quizStreak").textContent = String(live.quizStreak || 0);

          // update SCA local state
          const cards = Array.isArray(live.cards) ? live.cards : [];
          ownedSet_p.clear(); cards.forEach(c => ownedSet_p.add(c));
          scaMultiplier_p = (typeof live.scaMultiplier === 'number') ? live.scaMultiplier : scaMultiplier_p || 1.0;
          lastCollection_p = live.lastCollection || lastCollection_p || new Date();
          startPendingUpdater_p();
        }, function(err){
          console.error("profile: realtime listen error", err && err.message ? err.message : err);
          // still try start updater with whatever we have
          startPendingUpdater_p();
        });
    }
    // ----------------------------------------------

    // Save username
    var saveUserBtn = $("saveUserBtn");
    if (saveUserBtn) saveUserBtn.addEventListener("click", function(){
      var newName = ($("username") && $("username").value ? $("username").value : "").trim().toLowerCase();
      if ($("saveUserMsg")) $("saveUserMsg").textContent = "";
      if (!newName){ if ($("saveUserMsg")) $("saveUserMsg").textContent = "Please enter a username."; return; }

      renameUsernameMapping(user.uid, uname, newName).then(function(){
        return db.collection("users").doc(user.uid).set({ username: newName }, { merge: true });
      }).then(function(){
        if ($("displayName")) $("displayName").textContent = newName;
        if ($("username")) $("username").value = newName;
        toast("Username updated");
        uname = newName; // keep local in sync
      }).catch(function(e){
        if ($("saveUserMsg")) $("saveUserMsg").textContent = (e && e.message) ? e.message : String(e);
      });
    });

    // Save "about me"
    var saveAboutBtn = $("saveAboutBtn");
    if (saveAboutBtn) saveAboutBtn.addEventListener("click", function(){
      var about = ($("about") && $("about").value ? $("about").value : "").trim();
      if ($("saveAboutMsg")) $("saveAboutMsg").textContent = "";
      db.collection("users").doc(user.uid).set({ about: about }, { merge: true })
        .then(function(){ toast("Saved"); })
        .catch(function(e){ if ($("saveAboutMsg")) $("saveAboutMsg").textContent = (e && e.message) ? e.message : String(e); });
    });

    // Change password
    var changePassBtn = $("changePassBtn");
    if (changePassBtn) changePassBtn.addEventListener("click", function(){
      var cur = $("curPass") && $("curPass").value ? $("curPass").value : "";
      var nw  = $("newPass") && $("newPass").value ? $("newPass").value : "";
      if ($("passMsg")) $("passMsg").textContent = "";
      if (!cur || !nw){ if ($("passMsg")) $("passMsg").textContent = "Fill both fields."; return; }

      var cred = firebase.auth.EmailAuthProvider.credential(user.email, cur);
      user.reauthenticateWithCredential(cred)
        .then(function(){ return user.updatePassword(nw); })
        .then(function(){
          if ($("curPass")) $("curPass").value = "";
          if ($("newPass")) $("newPass").value = "";
          toast("Password changed");
        })
        .catch(function(e){ if ($("passMsg")) $("passMsg").textContent = (e && e.message) ? e.message : String(e); });
    });

    // Sign out
    var signOutBtn = $("signOutBtn");
    if (signOutBtn) signOutBtn.addEventListener("click", function(){
      auth.signOut().then(function(){ location.href="login.html"; });
    });

  }).catch(function(err){
    console.error("Profile init error:", err && err.message ? err.message : String(err));
  });
});

// Bind sidebar even if script loads early
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupSidebar, { once:true });
} else {
  setupSidebar();
                  }
