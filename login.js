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

// helper: คืนวันที่แบบ local YYYY-MM-DD
function localYmd(d = new Date()){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

// --- Query params ---
const qs = new URLSearchParams(location.search);
const keyParam   = (qs.get('k') || '').trim();
const nextParam  = (qs.get('next') || '').trim();
const cardParam  = (qs.get('card') || '').trim();
const validCard  = /^card([1-9]|1[0-9]|2[0-5])$/;

// ==========================================================
// ✅ ตรวจจับว่าผู้ใช้ยังล็อกอินอยู่ (auto-login)
// ==========================================================
auth.onAuthStateChanged(async (user) => {
  if (!user) return; // ยังไม่ได้ล็อกอินจริง ๆ

  const uref = db.collection('users').doc(user.uid);
  const now = new Date();
  const ymdToday = localYmd(now);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const ymdYester = localYmd(yesterday);

  try {
    const snap = await uref.get();
    let loginStreak = 1;
    let pointsToAdd = 0;

    if (snap.exists) {
      const data = snap.data();
      const lastYmd = data.loginLastYmd || null;
      const prevStreak = data.loginStreak || 0;

      if (lastYmd === ymdToday) {
        // เคยล็อกอินวันนี้แล้ว -> ไม่เพิ่ม
        loginStreak = prevStreak;
        pointsToAdd = 0;
      } else if (lastYmd === ymdYester) {
        // ต่อเนื่องจากเมื่อวาน
        loginStreak = prevStreak + 1;
        pointsToAdd = loginStreak;
      } else {
        // ไม่ต่อเนื่อง -> รีเซ็ตใหม่
        loginStreak = 1;
        pointsToAdd = 1;
      }
    } else {
      // ไม่มี doc -> สร้างใหม่
      loginStreak = 1;
      pointsToAdd = 1;
    }

    const update = {
      loginStreak,
      loginLastYmd: ymdToday
    };
    if (pointsToAdd > 0)
      update.points = firebase.firestore.FieldValue.increment(pointsToAdd);

    await uref.set(update, { merge: true });

  } catch (err) {
    console.warn('Auto-login streak update error:', err.message || err);
  }

  // ถ้ามี parameter ก็เด้งตาม route ที่ตั้งไว้
  if (keyParam) {
    location.replace(`redeem.html?k=${encodeURIComponent(keyParam)}`);
  } else if (nextParam) {
    location.replace(nextParam);
  } else {
    location.replace('allcard.html');
  }
});

// ==========================================================
// ✅ ฟังก์ชันล็อกอินด้วยชื่อ+รหัส (ใช้วันแรก หรือหลัง sign-out)
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
      const uref = db.collection('users').doc(user.uid);
      const now = new Date();
      const ymdToday = localYmd(now);
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const ymdYester = localYmd(yesterday);

      try {
        const snap = await uref.get();
        let loginStreak = 1;
        let pointsToAdd = 0;

        if (snap.exists) {
          const data = snap.data();
          const lastYmd = data.loginLastYmd || null;
          const prevStreak = data.loginStreak || 0;

          if (lastYmd === ymdToday) {
            loginStreak = prevStreak;
            pointsToAdd = 0;
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
          loginStreak,
          loginLastYmd: ymdToday
        };
        if (pointsToAdd > 0)
          update.points = firebase.firestore.FieldValue.increment(pointsToAdd);

        await uref.set(update, { merge: true });

      } catch (err) {
        console.warn('Manual login streak update error:', err.message || err);
      }

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
