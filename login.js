// ======================= login.js =======================
// UI: Show/Hide password
const toggleLoginPassword = document.getElementById('toggleLoginPassword');
const loginPasswordInput  = document.getElementById('login-password');
if (toggleLoginPassword && loginPasswordInput) {
  toggleLoginPassword.addEventListener('click', () => {
    const isHidden = loginPasswordInput.type === 'password';
    loginPasswordInput.type = isHidden ? 'text' : 'password';
    toggleLoginPassword.querySelector('i').classList.toggle('fa-eye-slash', isHidden);
    toggleLoginPassword.querySelector('i').classList.toggle('fa-eye', !isHidden);
  });
}

// Modal helpers
const loginModal    = document.getElementById('loginModal');
const loginModalMsg = document.getElementById('loginModalMsg');
const loginModalBtn = document.getElementById('loginModalBtn');
function showModal(msg, color = '#b21e2c') {
  if (loginModalMsg) loginModalMsg.textContent = msg;
  if (loginModalMsg) loginModalMsg.style.color = color;
  if (loginModal) loginModal.style.display = 'flex';
}
if (loginModalBtn) loginModalBtn.addEventListener('click', () => (loginModal.style.display = 'none'));

// Firebase
const FAKE_DOMAIN = '@myapp.fake';
const auth = firebase.auth();
const db   = firebase.firestore();

// Session persistence (จำ session เดิม)
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

// helper: คืนวันที่แบบ local YYYY-MM-DD (ไม่กระทบ timezone ของ ISO)
function localYmd(d = new Date()){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

// === ฟังก์ชันสาธารณะ: อัปเดต login streak (เรียกซ้ำได้) ===
async function updateLoginStreakIfNeeded(user){
  if (!user) return;
  const uref = db.collection('users').doc(user.uid);
  const now = new Date();
  const ymdToday = localYmd(now);
  const yesterday = new Date(); yesterday.setDate(new Date().getDate() - 1);
  const ymdYester = localYmd(yesterday);

  try {
    const snap = await uref.get();
    let loginStreak = 1;
    let pointsToAdd = 0;

    if (snap.exists) {
      const data = snap.data() || {};
      const lastYmd = data.loginLastYmd || null;
      const prevStreak = Number(data.loginStreak || 0);

      if (lastYmd === ymdToday) {
        // วันนี้อัปเดตแล้ว -> ไม่ต้องทำอะไร
        return;
      } else if (lastYmd === ymdYester) {
        loginStreak = prevStreak + 1;
        pointsToAdd = loginStreak;
      } else {
        loginStreak = 1;
        pointsToAdd = 1;
      }
    } else {
      loginStreak = 1;
      pointsToAdd = 1;
    }

    const update = {
      loginStreak: loginStreak,
      loginLastYmd: ymdToday
    };
    if (pointsToAdd > 0) update.points = firebase.firestore.FieldValue.increment(pointsToAdd);

    await uref.set(update, { merge: true });
  } catch (err) {
    console.warn('updateLoginStreakIfNeeded error:', err && err.message ? err.message : err);
  }
}
// ให้หน้าอื่นเรียกได้
window.updateLoginStreakIfNeeded = updateLoginStreakIfNeeded;

// --- Query params ---
const qs = new URLSearchParams(location.search);
const keyParam   = (qs.get('k') || '').trim();
const nextParam  = (qs.get('next') || '').trim();
const cardParam  = (qs.get('card') || '').trim();
const validCard  = /^card([1-9]|1[0-9]|2[0-5])$/;

// ==========================================================
// ตรวจจับว่าผู้ใช้ยังล็อกอินอยู่ (auto-login) -> อัปเดต streak
// ==========================================================
auth.onAuthStateChanged(async (user) => {
  if (!user) return;

  try {
    await updateLoginStreakIfNeeded(user);
  } catch (e) {
    console.warn('Auto update streak failed:', e);
  }

  // legacy ?card= (ถ้ามี) - ทำเหมือนเดิม
  if (cardParam && validCard.test(cardParam)) {
    try {
      const uref = db.collection('users').doc(user.uid);
      const snap = await uref.get();
      const cards = (snap.exists && Array.isArray(snap.data().cards)) ? snap.data().cards : [];
      if (!cards.includes(cardParam)) {
        await uref.set({ cards: firebase.firestore.FieldValue.arrayUnion(cardParam) }, { merge: true });
      }
    } catch (e) {
      console.warn('legacy ?card= write skipped:', e && e.message ? e.message : e);
    }
  }

  if (keyParam) {
    location.replace(`redeem.html?k=${encodeURIComponent(keyParam)}`);
  } else {
    location.replace(nextParam || 'allcard.html');
  }
});

// ==========================================================
// ฟังก์ชันล็อกอินด้วยชื่อ+รหัส (ใช้วันแรก หรือหลัง sign-out)
// ==========================================================
document.getElementById('loginForm')?.addEventListener('submit', function (e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = loginPasswordInput.value;

  if (!username || !password) {
    showModal('Please enter both username and password.');
    return;
  }

  const fakeEmail = username + FAKE_DOMAIN;

  auth.signInWithEmailAndPassword(fakeEmail, password)
    .then(async (userCredential) => {
      const user = userCredential.user;
      // อัปเดต streak ทันทีหลัง sign-in
      try { await updateLoginStreakIfNeeded(user); } catch (e) { console.warn(e); }

      showModal('✅ Login successful!', '#299c34');
      loginModalBtn.onclick = () => {
        if (keyParam) {
          location.replace(`redeem.html?k=${encodeURIComponent(keyParam)}`);
        } else if (nextParam) {
          location.replace(nextParam);
        } else {
          location.replace('allcard.html');
        }
      };
    })
    .catch((error) => showModal('❌ ' + (error?.message || String(error))));
});
