// profile.js — sidebar + profile + safe username mapping

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
// (ไม่เปลี่ยนแปลงในส่วนนี้)

function ensureUsernameMapping(uid, uname){
  // ...
}

function renameUsernameMapping(uid, oldU, newU){
  // ...
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
      cards: Array.isArray(data.cards) ? data.cards : [],
      mission: Array.isArray(data.mission) ? data.mission : Array(15).fill(false),
      points: (typeof data.points === "number") ? data.points : 0,
      quizCount: (typeof data.quizCount === "number") ? data.quizCount : 0,
      quizStreak: (typeof data.quizStreak === "number") ? data.quizStreak : 0,
      quizLastYmd: data.quizLastYmd || null,
      // ===== เพิ่ม: เก็บค่า loginStreak, loginLastYmd =====
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

  ensureIdentity(user).then(function(res){
    var data = res.data || {};
    var uname = res.uname || ((user.email||"").split("@")[0] || "user");

    if ($("displayName")) $("displayName").textContent = uname;
    if ($("username")) $("username").value = uname;
    if ($("about"))    $("about").value = data.about || "";
    if ($("points"))   $("points").textContent = String(data.points || 0);
    if ($("quizCount"))  $("quizCount").textContent = String(data.quizCount || 0);
    if ($("quizStreak")) $("quizStreak").textContent = String(data.quizStreak || 0);
    // ===== เพิ่ม: แสดงค่า loginStreak ในหน้าโปรไฟล์ =====
    if ($("loginStreak")) $("loginStreak").textContent = String(data.loginStreak || 0);

    // Cards grid with png->jpg fallback
    var cards = Array.isArray(data.cards) ? data.cards : [];
    if ($("cardsCount")) $("cardsCount").textContent = String(cards.length);
    var grid = $("cardsGrid");
    if (grid){
      if (!cards.length){
        grid.innerHTML = '<div class="muted">No cards yet.</div>';
      } else {
        var html = cards.slice()
          .sort(function(a,b){ return Number(a.replace('card','')) - Number(b.replace('card','')); })
          .map(function(cId){
            var n = cId.replace(/card/i,"Card ");
            return '' +
              '<div class="cardItem">' +
              '  <img src="assets/cards/'+cId+'.png" alt="'+n+'" onerror="this.onerror=null;this.src=\'assets/cards/'+cId+'.jpg\'">' +
              '  <div class="muted">'+n+'</div>' +
              '</div>';
          }).join("");
        grid.innerHTML = html;
      }
    }

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
    var dbg = $("debug");
    if (dbg){ dbg.classList.remove("hidden"); dbg.textContent = "Profile init error: " + (err && err.message ? err.message : String(err)); }
    else { console.error(err); }
  });
});

// Bind sidebar even if script loads early
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupSidebar, { once:true });
} else {
  setupSidebar();
    }
