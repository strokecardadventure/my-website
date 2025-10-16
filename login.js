// ======================= login.js =======================
// UI: Show/Hide password
const toggleLoginPassword = document.getElementById('toggleLoginPassword');
const loginPasswordInput  = document.getElementById('login-password');
toggleLoginPassword.addEventListener('click', () => {
  const isHidden = loginPasswordInput.type === 'password';
  loginPasswordInput.type = isHidden ? 'text' : 'password';
  toggleLoginPassword.querySelector('i').classList.toggle('fa-eye-slash', isHidden);
  toggleLoginPassword.querySelector('i').classList.toggle('fa-eye', !isHidden);
});

// Modal helpers
const loginModal    = document.getElementById('loginModal');
const loginModalMsg = document.getElementById('loginModalMsg');
const loginModalBtn = document.getElementById('loginModalBtn');
function showModal(msg, color = '#b21e2c') {
  loginModalMsg.textContent = msg;
  loginModalMsg.style.color = color;
  loginModal.style.display = 'flex';
}
loginModalBtn.addEventListener('click', () => (loginModal.style.display = 'none'));

// Firebase
const FAKE_DOMAIN = '@myapp.fake';
const auth = firebase.auth();
const db   = firebase.firestore();

// Persist session across tabs/app restarts
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

// --- Query params ---
const qs = new URLSearchParams(location.search);
const keyParam   = (qs.get('k') || '').trim();                // secure key for redeem.html
const nextParam  = (qs.get('next') || '').trim();             // optional redirect
const cardParam  = (qs.get('card') || '').trim();             // legacy one-click unlock
const validCard  = /^card([1-9]|1[0-9]|2[0-5])$/;

// If already signed in, route immediately
auth.onAuthStateChanged(async (user) => {
  if (!user) return;

  if (keyParam) {
    location.replace(`redeem.html?k=${encodeURIComponent(keyParam)}`);
    return;
  }

  if (cardParam && validCard.test(cardParam)) {
    try {
      const uref = db.collection('users').doc(user.uid);
      const snap = await uref.get();
      const cards = (snap.exists && Array.isArray(snap.data().cards)) ? snap.data().cards : [];
      if (!cards.includes(cardParam)) {
        await uref.set(
          { cards: firebase.firestore.FieldValue.arrayUnion(cardParam) },
          { merge: true }
        );
      }
    } catch (e) {
      console.warn('legacy ?card= write skipped:', e?.message || e);
    }
  }

  // ✅ default landing → allcard.html
  location.replace(nextParam || 'allcard.html');
});

// ----- Login form -----
document.getElementById('loginForm').addEventListener('submit', function (e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = loginPasswordInput.value;

  if (!username || !password) {
    showModal('Please enter both username and password.');
    return;
  }

  const fakeEmail = username + FAKE_DOMAIN;

  auth.signInWithEmailAndPassword(fakeEmail, password)
    .then((userCredential) => {
      const user = userCredential.user;
      // ===== เพิ่ม: อัพเดตคะแนนล็อกอินต่อเนื่อง =====
      const uref = db.collection('users').doc(user.uid);
      const now = new Date();
      const ymdToday = now.toISOString().slice(0,10);  // รูปแบบ YYYY-MM-DD
      // วันที่เมื่อวาน
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const ymdYester = yesterday.toISOString().slice(0,10);

      uref.get().then((snap) => {
        let loginStreak = 1;
        if (snap.exists) {
          const data = snap.data();
          const lastYmd = data.loginLastYmd || null;
          const prevStreak = data.loginStreak || 0;
          if (lastYmd === ymdToday) {
            // เคยล็อกอินวันนี้แล้ว ไม่เพิ่ม streak
            loginStreak = prevStreak;
          } else if (lastYmd === ymdYester) {
            // ล็อกอินต่อเนื่องจากเมื่อวาน
            loginStreak = prevStreak + 1;
          } else {
            // ไม่ต่อเนื่อง (หรือไม่มีข้อมูล) -> เริ่มที่ 1
            loginStreak = 1;
          }
        }
        // บันทึกค่า loginStreak และ loginLastYmd
        return uref.set({
          loginStreak: loginStreak,
          loginLastYmd: ymdToday
        }, { merge: true });
      }).catch((err) => {
        console.warn('Update login streak error:', err.message || err);
      });
      // ============================================

      showModal('✅ Login successful!', '#299c34');
      loginModalBtn.onclick = () => {
        if (keyParam) {
          location.replace(`redeem.html?k=${encodeURIComponent(keyParam)}`);
        } else if (nextParam) {
          location.replace(nextParam);
        } else {
          location.replace('allcard.html'); // ✅ เดิม card.html
        }
      };
    })
    .catch((error) => showModal('❌ ' + (error?.message || String(error))));
});
