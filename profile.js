// profile.js — sidebar + profile (การ์ด rendering ถูกลบตามคำขอ)

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

// ===== App =====
auth.onAuthStateChanged(function(user){
  if (!user){ location.href = "login.html"; return; }

  setupSidebar();

  // Show UID ASAP so UI never stays blank
  if ($("uid")) $("uid").textContent = user.uid;

  // <<< เพิ่ม: ถ้ามีฟังก์ชัน global ให้เรียกอัปเดต streak ก่อนโหลด UI >>>>
  if (window.updateLoginStreakIfNeeded) {
    try { window.updateLoginStreakIfNeeded(user); } catch(e){ console.warn('profile: update streak failed', e); }
  }
  // <<< end addition >>>

  ensureIdentity(user).then(function(res){
    var data = res.data || {};
    var uname = res.uname || ((user.email||"").split("@")[0] || "user");

    if ($("displayName")) $("displayName").textContent = uname;
    if ($("username")) $("username").value = uname;
    if ($("about"))    $("about").value = data.about || "";
    if ($("points"))   $("points").textContent = String(data.points || 0);
    if ($("quizCount"))  $("quizCount").textContent = String(data.quizCount || 0);
    if ($("quizStreak")) $("quizStreak").textContent = String(data.quizStreak || 0);
    // แสดงค่า loginStreak ในหน้าโปรไฟล์ (ยังคงให้แสดง)
    if ($("loginStreak")) $("loginStreak").textContent = String(data.loginStreak || 0);

    // ---- เพิ่ม listener แบบ realtime ให้ profile อัปเดตเมื่อ doc เปลี่ยน ----
    if (!window.__profileUserSnapUnsub) {
      window.__profileUserSnapUnsub = db.collection("users").doc(user.uid)
        .onSnapshot(function(s){
          if (!s.exists) return;
          var live = s.data() || {};
          if ($("points"))   $("points").textContent = String(live.points || 0);
          if ($("loginStreak")) $("loginStreak").textContent = String(live.loginStreak || 0);
          if ($("quizCount")) $("quizCount").textContent = String(live.quizCount || 0);
          if ($("quizStreak")) $("quizStreak").textContent = String(live.quizStreak || 0);
        }, function(err){
          console.error("profile: realtime listen error", err && err.message ? err.message : err);
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
