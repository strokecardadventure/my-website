// ====== mission.js (with SCA passive integration) ======

// ====== Auth guard ======
const auth = firebase.auth();
const db   = firebase.firestore();

const LEVEL_COUNT = 15; // 15 checkpoints
let CURRENT_POINTS = 0;
let CURRENT_USER = null; // for writing stats

// tiny safe logger
const log = (...a) => { try { console.log(...a); } catch(_){} };

// ====== SCA passive helpers (shared for this page) ======
let cardRates_m = null;
let ownedSet_m = new Set();
let scaMultiplier_m = 1.0;
let lastCollection_m = null;
let pendingUpdater_m = null;

async function loadCardRates_m(){
  try {
    const ref = db.collection('cardRates').doc('rates');
    const snap = await ref.get();
    cardRates_m = snap.exists ? (snap.data() || {}) : { card1:15, card2:18 };
  } catch (e) {
    console.warn('loadCardRates_m', e);
    cardRates_m = { card1:15, card2:18 };
  }
}
function computeTotalRateForOwned_m(setOwned) {
  if (!cardRates_m) return 0;
  let s = 0;
  setOwned.forEach(cid => { if (cardRates_m[cid] !== undefined) s += Number(cardRates_m[cid])||0; });
  return s;
}
function computePendingSCA_m(lastCollectionTs, nowDate = new Date()){
  if (!lastCollectionTs) return 0;
  let lastMs;
  try {
    lastMs = (typeof lastCollectionTs.toDate === 'function') ? lastCollectionTs.toDate().getTime() : new Date(lastCollectionTs).getTime();
  } catch(e){ lastMs = new Date().getTime(); }
  const deltaSeconds = Math.max(0, (nowDate.getTime() - lastMs) / 1000);
  const baseRate = computeTotalRateForOwned_m(ownedSet_m);
  return deltaSeconds * baseRate * (Number(scaMultiplier_m) || 1);
}

(function injectHud_m(){
  if (!document.getElementById('scaHud_m')) {
    const hud = document.createElement('div');
    hud.id = 'scaHud_m';
    hud.style.cssText = 'position:fixed;top:16px;right:16px;z-index:1300;background:#fff;border-radius:12px;padding:8px 12px;border:2px solid #ffcdd2;color:#b71c1c;font-weight:800;box-shadow:0 6px 18px rgba(0,0,0,.08);';
    hud.innerHTML = `SCA: <span id="scaPending_m">0</span>
      <button id="collectAllBtn_m" style="margin-left:8px;padding:6px 10px;border-radius:8px;border:none;background:#e53935;color:#fff;font-weight:800;cursor:pointer">รับทั้งหมด</button>
      <div style="font-size:12px;color:#888;margin-top:4px">× <span id="scaMultiplierDisplay_m">1.00</span></div>`;
    document.body.appendChild(hud);
  }
})();

function renderPendingHud_m(){
  const el = document.getElementById('scaPending_m');
  const multEl = document.getElementById('scaMultiplierDisplay_m');
  if (!el) return;
  const pending = computePendingSCA_m(lastCollection_m, new Date());
  el.textContent = (pending >= 100 ? Math.round(pending) : pending.toFixed(1));
  if (multEl) multEl.textContent = (Number(scaMultiplier_m)||1).toFixed(2);
}
function startPendingUpdater_m(){ stopPendingUpdater_m(); pendingUpdater_m = setInterval(renderPendingHud_m,1000); renderPendingHud_m(); }
function stopPendingUpdater_m(){ if (pendingUpdater_m){ clearInterval(pendingUpdater_m); pendingUpdater_m = null; } }

async function collectAllToUser_m(uid){
  try {
    const userRef = db.collection('users').doc(uid);
    const pending = computePendingSCA_m(lastCollection_m, new Date());
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
    lastCollection_m = new Date();
    renderPendingHud_m();
    toast(`รับ ${pendingRounded} SCA เรียบร้อย`);
  } catch (e) {
    console.error('collectAll_m fail', e);
    toast('ไม่สามารถรับคะแนนได้ ลองอีกครั้ง');
  }
}

document.addEventListener('click', (ev) => {
  if (ev.target && ev.target.id === 'collectAllBtn_m') {
    const user = firebase.auth().currentUser;
    if (!user) { location.href='login.html'; return; }
    collectAllToUser_m(user.uid);
  }
});

/* ===== existing mission.js content starts here (unchanged logic), with SCA init integrated ====== */

// ====== Start ======
auth.onAuthStateChanged(async (user) => {
  if (!user) return location.href = "login.html";
  CURRENT_USER = user;
  setupSidebar();
  try {
    // load SCA rates & start SCA listener for this user (non-blocking)
    await loadCardRates_m();
    const uref = db.collection('users').doc(user.uid);
    // ensure fields
    const s = await uref.get();
    if (!s.exists) {
      await uref.set({ scaMultiplier:1.0, lastCollection: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
    } else {
      const d = s.data() || {};
      if (typeof d.scaMultiplier !== 'number') await uref.set({ scaMultiplier:1.0 }, { merge:true });
      if (!d.lastCollection) await uref.set({ lastCollection: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
    }
    // listen to user doc to update SCA state (cards might not be needed here but keep)
    uref.onSnapshot((snap)=>{
      const data = snap.exists ? (snap.data() || {}) : {};
      const cards = Array.isArray(data.cards) ? data.cards : [];
      ownedSet_m.clear(); cards.forEach(c => ownedSet_m.add(c));
      scaMultiplier_m = (typeof data.scaMultiplier === 'number') ? data.scaMultiplier : scaMultiplier_m || 1.0;
      lastCollection_m = data.lastCollection || lastCollection_m || new Date();
      startPendingUpdater_m();
    }, (err)=>{ console.warn('mission: sca listen', err); startPendingUpdater_m(); });

    await buildPath(user);
  }
  catch (e) { log("buildPath error:", e); toast("มีข้อผิดพลาดเล็กน้อย กรุณารีเฟรชแล้วลองใหม่"); }
});

// ====== Sidebar ======
function setupSidebar() {
  const toggleBtn = document.getElementById("menu-toggle");
  const sidebar   = document.getElementById("sidebar");
  const overlay   = document.getElementById("overlay");
  const closeBtn  = document.getElementById("close-sidebar");
  const logout    = document.getElementById("logout-link");

  const open  = () => { sidebar.classList.add("open");  overlay.classList.add("active"); };
  const close = () => { sidebar.classList.remove("open"); overlay.classList.remove("active"); };

  toggleBtn?.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  overlay?.addEventListener("click", close);
  document.querySelectorAll("#sidebar .menu-item a").forEach(a=>{
    if (!a.closest("#logout-link")) a.addEventListener("click", close);
  });
  logout?.addEventListener("click", (e)=>{ e.preventDefault(); auth.signOut().then(()=>location.href="login.html"); });
}

// ====== QUESTION BANKS (TH) ======
const Q1_BASIC = [
  { q:"โรคหลอดเลือดสมองมีชนิดหลักกี่ชนิด?", opts:["หนึ่งชนิด:แตก,อุดตันและตื่น","สองชนิด: อุดตันและแตก ","สามชนิด","สี่ชนิด"], a:1 },
  { q:"คำว่า “Stroke” หมายถึงอะไร?", opts:["อาการบาดเจ็บของกล้ามเนื้อ","ปัญหาสมองเฉียบพลันจากหลอดเลือดอุดตันหรือแตก","แค่ปวดศีรษะ","กระดูกหัก"], a:1 },
  { q:"ปี2567 มีผู้เสียชีวิตประมาณกี่คน", opts:["20 คน","39000 คน","100คน","1คน"], a:1 },
  { q:"stroke มีปัจจัยเสี่ยงคือ", opts:["กินผัก","สูบบุหรี่","กินน้ำ","ออกกำลังกาย"], a:1 },
  { q:"stroke ป้องกันปัจจัยเสี่ยงด้วยอะไร", opts:["เล่นเกมดึกทุกวันจนถึงตีสาม","นอนเต็มอิ่มทุกๆวัน","นอนดึก","กินมันและหวาน"], a:1 },
  { q:"สโตรกถือเป็นภาวะฉุกเฉินหรือไม่?", opts:["ไม่ใช่","เฉพาะเวลาปวดมาก","ใช่ ทุกนาทีมีค่า","เฉพาะผู้สูงอายุเท่านั้น"], a:2 },
  { q:"อาการเตือนของโรค strokeมีอะไรบ้าง", opts:["BEFAST","Storke","EXPRESS","GeoGebra"], a:0 },
  { q:"หากเกิดอาการเตือนstroke ต้องไปพบแพทย์ภายในกี่ชั่วโมง", opts:["10000000นาที","4 ชั่วโมง","1–2 วัน","999 ชั่วโมง"], a:1 },
  { q:"คนวัยรุ่นเป็นสโตรกได้ไหม?", opts:["ไม่มีทาง","ได้ หากมีปัจจัยเสี่ยง","เฉพาะนักกีฬา","เฉพาะคนสูบบุหรี่"], a:1 },
  { q:"สถานการณ์ในประเทศไทยคนที่เป็นสโตรกมีสถานการณ์เป็นอย่างไร?", opts:["ลดลง","แนวโน้มเพิ่มขึ้นตามสังคมสูงวัยและพฤติกรรมเสี่ยง","ไม่มีแล้ว","ไม่ทราบ"], a:1 },
];

const Q2_CAUSES = [
  { q:"ปัจจัยสำคัญที่สุดของสโตรกชนิดเลือดออกคือ?", opts:["ความดันต่ำ","ความดันโลหิตสูง","น้ำตาลต่ำ","อากาศหนาว"], a:1 },
  { q:"ภาวะหัวใจข้อใดเพิ่มความเสี่ยงสโตรก?", opts:["หัวใจเต้นผิดจังหวะชนิด Atrial Fibrillation","หัวใจนักกีฬา","ลิ้นหัวใจปกติ","หัวใจเต้นช้า (Bradycardia)"], a:0 },
  { q:"เหตุใดความดันโลหิตสูงจึงเพิ่มความเสี่ยง?", opts:["ทำให้หลอดเลือดแข็งแรง","ทำลายผนังหลอดเลือด","ทำให้เลือดใส","ทำให้สมองเย็น"], a:1 },
  { q:"การสูบบุหรี่มีผลอย่างไร?", opts:["ปกป้องหลอดเลือด","ไม่กระทบ","ทำลายหลอดเลือดและกระตุ้นการเกิดลิ่มเลือด","รักษาสโตรกได้"], a:2 },
  { q:"เบาหวานสัมพันธ์กับสโตรกเพราะ…", opts:["ซ่อมแซมหลอดเลือด","ทำลายหลอดเลือดเล็กและเร่งการตีบแคบ","ป้องกันลิ่มเลือด","ลดคอเลสเตอรอล"], a:1 },
  { q:"คอเลสเตอรอลสูง…", opts:["ทำให้เกิดคราบไขมันอุดตันหลอดเลือด","ทำให้เลือดใส","ไม่เป็นอันตรายเสมอไป","ป้องกันการอุดตัน"], a:0 },
  { q:"Atrial fibrillation อาจ…", opts:["ทำให้เกิดลิ่มเลือดในหัวใจแล้วหลุดไปอุดสมอง","หยุดการเกิดลิ่มเลือด","ลดความดันโลหิต","รักษาเบาหวาน"], a:0 },
  { q:"ดื่มแอลกอฮอล์มากเกินไปอาจ…", opts:["ลดความดัน","เพิ่มความดันและรบกวนจังหวะหัวใจ","ป้องกันสโตรก","แค่ทำให้ง่วง"], a:1 },
  { q:"ความเครียดเรื้อรัง…", opts:["ไม่เกี่ยวข้อง","ทำให้ความดันสูงและพฤติกรรมสุขภาพแย่ลง","รักษาความกังวล","ป้องกันลิ่มเลือด"], a:1 },
  { q:"ข้อใดคือปัจจัยเสี่ยงที่ควบคุมได้?", opts:["อายุและพันธุกรรม","อาหาร การออกกำลังกาย ความดัน การสูบบุหรี่","แค่เพศ","ส่วนสูง"], a:1 },
];

const Q3_PREVENT = [
  { q:"อาหารแบบไหนเหมาะกับการป้องกันสโตรก?", opts:["ของทอดและเค็มจัด","ผักผลไม้ ธัญพืชไม่ขัดสี ปลา ลดหวาน/เค็ม","กินแต่เนื้อ","พึ่งอาหารเสริมอย่างเดียว"], a:1 },
  { q:"การออกกำลังกายที่แนะนำต่อสัปดาห์คือ?", opts:["อย่างน้อย 150 นาที/สัปดาห์ (ระดับปานกลาง) + เวท 2 วัน","รวม 30 นาที","ไม่ต้อง หากยังเด็ก","ออกเฉพาะเสาร์–อาทิตย์"], a:0 },
  { q:"ควบคุมความดันช่วยเพราะ…", opts:["ป้องกันการทำลายหลอดเลือด","ทำให้ตัวสูงขึ้น","เปลี่ยนกรุ๊ปเลือด","ทำให้สายตาลดลง"], a:0 },
  { q:"เลิกสูบบุหรี่ส่งผลต่อความเสี่ยงสโตรกอย่างไร?", opts:["ไม่เปลี่ยน","ลดลงมากใน 1–2 ปี และใกล้เคียงคนไม่สูบใน ~5 ปี","เสี่ยงเพิ่ม","ช่วยแค่ปอด"], a:1 },
  { q:"ตรวจสุขภาพสม่ำเสมอช่วยโดย…", opts:["ได้ของกินเล่นฟรี","คัดกรองและรักษาปัจจัยเสี่ยงตั้งแต่เนิ่น ๆ","ทำให้ง่วง","เพิ่มความดัน"], a:1 },
  { q:"น้ำหนักเกิน/อ้วน…", opts:["ลดความเสี่ยง","ไม่กระทบ","เพิ่มความเสี่ยงผ่านความดัน เบาหวาน ไขมันสูง","เป็นเรื่องความสวยงามเท่านั้น"], a:2 },
  { q:"ควบคุมน้ำตาลในเลือดเพื่อ…", opts:["ทำลายหลอดเลือด","ป้องกันการทำลายหลอดเลือด","เพิ่มน้ำหนัก","เปลี่ยนสีตา"], a:1 },
  { q:"การนอนน้อยเกินไป…", opts:["อาจทำให้ความดันและความเครียดสูงขึ้น","ปลอดภัยเสมอ","รักษาความเครียด","ป้องกันลิ่มเลือด"], a:0 },
  { q:"การจัดการความเครียดช่วยโดย…", opts:["ทำให้ความดันปกติและพฤติกรรมสุขภาพดีขึ้น","ทำลายการนอน","เพิ่มคอเลสเตอรอล","ทำให้เกิดลิ่มเลือด"], a:0 },
  { q:"การดื่มน้ำเพียงพอ…", opts:["ทำให้การไหลเวียนแย่ลง","ช่วยสุขภาพและการไหลเวียนโดยรวม","ทำให้เกิดสโตรก","ทดแทนการออกกำลังกายได้"], a:1 },
];

const Q4_BEFAST = [
  { q:"BEFAST ย่อมาจากอะไร?", opts:[
    "Brain, Eye, Feet, Arms, Speech, Talk",
    "Balance, Eyes, Face, Arms, Speech, Time",
    "Breathe, Eat, Fast, Act, Sit, Talk",
    "Blink, Ear, Face, Abdomen, Sleep, Time"
  ], a:1 },
  { q:"B = ?", opts:["Breath","ปัญหาการทรงตัว (Balance)","Bones","Belief"], a:1 },
  { q:"E = ?", opts:["ปวดหู","ตา: มองเห็นผิดปกติ/ตามัวเฉียบพลัน","พลังงานต่ำ","ศอกอ่อนแรง"], a:1 },
  { q:"F = ?", opts:["ไข้","หน้าเบี้ยว","ปวดเท้า","แพ้อาหาร"], a:1 },
  { q:"A = ?", opts:["แขนขาอ่อนแรง","ข้อเท้าเคล็ด","หืด","โลหิตจาง"], a:0 },
  { q:"S = ?", opts:["ง่วงนอน","พูดไม่ชัด/สื่อสารลำบาก","เหงื่อออก","ผิวไหม้แดด"], a:1 },
  { q:"T = ?", opts:["พรุ่งนี้ค่อยไป","ถึงเวลาโทรฉุกเฉิน","พักดื่มชา","งีบ"], a:1 },
  { q:"หากพบสัญญาณ BEFAST ควร…", opts:["รอดูที่บ้าน","โทร 1669 ทันที","ดื่มน้ำ","หาดูใน YouTube"], a:1 },
  { q:"เหตุใดเวลาเป็นสิ่งสำคัญ?", opts:["สมองทนได้ตลอดไป","รักษาได้เร็ว สมองเสียหายน้อยลง","รถพยาบาลชอบความเร็ว","ไม่สำคัญ"], a:1 },
  { q:"ทำไมไม่ควรรอให้อาการหายเอง?", opts:["รอปลอดภัยกว่า","ยิ่งช้า ยิ่งเสี่ยงเสียถาวร","โรงพยาบาลปิด","ดื่มน้ำก็หาย"], a:1 },
];

const Q5_TREAT = [
  { q:"เมื่อสงสัยว่าใครเป็นสโตรก ควรทำสิ่งแรกคือ?", opts:["ให้กินอาหาร","โทรขอความช่วยเหลือและรีบนำส่งโรงพยาบาล","ปล่อยให้นอนพัก","นวด"], a:1 },
  { q:"ทำไมต้องไปโรงพยาบาลให้เร็ว?", opts:["เพิ่มโอกาสรักษาได้ผลและฟื้นตัวดี","ไปจ่ายเงินเร็วขึ้น","เลี่ยงเอกสาร","ไม่มีเหตุผล"], a:0 },
  { q:"เครื่องมือใดใช้ตรวจแยกชนิดสโตรก?", opts:["อัลตราซาวด์","CT/MRI","เอกซเรย์ขา","วัดอุณหภูมิ"], a:1 },
  { q:"ถ้าเส้นเลือดอุดตัน แพทย์อาจ…", opts:["ให้ยาละลายลิ่มเลือด","ให้ยานอนหลับ","ไม่ทำอะไร","ประคบเย็นอย่างเดียว"], a:0 },
  { q:"ถ้าเส้นเลือดแตก แพทย์จะ…", opts:["ปล่อยให้เลือดออก","หยุดเลือด (บางกรณีผ่าตัด)","ให้ขนม","ให้กลับบ้าน"], a:1 },
  { q:"ทำไมต้องกายภาพบำบัดหลังสโตรก?", opts:["เพื่อฟื้นกำลังและการเคลื่อนไหว","เพื่อฝึกทำอาหาร","ไม่มีเหตุผล","เพื่อเลี่ยงการพบเพื่อน"], a:0 },
  { q:"ใครช่วยดูแลปัญหาการพูด?", opts:["ทันตแพทย์","นักแก้ไขการพูด","เชฟ","นักบิน"], a:1 },
  { q:"อาหารที่ดีช่วงฟื้นตัว…", opts:["ทำให้หายช้า","ให้สารอาหารช่วยซ่อมแซมร่างกาย","อุดตันท่อน้ำเหลือง","ไม่มีประโยชน์"], a:1 },
  { q:"กำลังใจจากครอบครัว…", opts:["ไม่สำคัญ","ช่วยสร้างแรงจูงใจในการฟื้นตัว","เป็นโทษต่อการรักษา","ทดแทนยาได้"], a:1 },
  { q:"เพื่อป้องกันสโตรกซ้ำ ควร…", opts:["เมินความดันโลหิต","กินดี ออกกำลัง คุมความดัน พบแพทย์ตามนัด","พักผ่อนอย่างเดียวตลอดไป","งดดื่มน้ำ"], a:1 },
];

// --- attach stable IDs to each question for stats ---
function tagBank(tag, bank){ bank.forEach((q,i)=>{ if(!q.id) q.id = `${tag}-${String(i+1).padStart(2,'0')}`; }); }
tagBank("B1", Q1_BASIC);
tagBank("B2", Q2_CAUSES);
tagBank("B3", Q3_PREVENT);
tagBank("B4", Q4_BEFAST);
tagBank("B5", Q5_TREAT);

// Category map: 1–3 → Q1, 4–6 → Q2, 7–9 → Q3, 10–12 → Q4, 13–15 → Q5
function categoryForLevel(levelIdx){ return Math.floor(levelIdx / 3) + 1; } // 1..5
function bankForCategory(cat){ return [null, Q1_BASIC, Q2_CAUSES, Q3_PREVENT, Q4_BEFAST, Q5_TREAT][cat] || Q1_BASIC; }

// ====== helpers ======
function shuffle(arr){
  const a = arr.slice();
  for (let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}
function pickQuestionsForCheckpoint(levelIdx){
  const cat = categoryForLevel(levelIdx);
  const bank = bankForCategory(cat);
  // deep-copy and keep stable id
  return shuffle(bank).slice(0, 10).map(q => ({ q: q.q, opts: q.opts.slice(), a: q.a, id: q.id }));
}
function renderPoints(n){
  CURRENT_POINTS = n|0;
  const el = document.getElementById("pointsNum");
  if (el) el.textContent = String(CURRENT_POINTS);
}
function nodeElement(index, state){
  const li = document.createElement("li");
  li.className = `node ${state}`;
  li.innerHTML = `
    <div class="badge">${state==="done"?"✓":index+1}</div>
    <div class="label">ด่าน ${index+1}</div>
  `;
  return li;
}

// streak helpers (daily)
const ymd = (d)=> {
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), da=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${da}`;
};
function isYesterday(prevYmd, todayYmd){
  if (!prevYmd) return false;
  const [py,pm,pd] = prevYmd.split('-').map(n=>parseInt(n,10));
  const [ty,tm,td] = todayYmd.split('-').map(n=>parseInt(n,10));
  const prev = new Date(py, pm-1, pd);
  const today= new Date(ty, tm-1, td);
  const diffDays = Math.round((today - prev) / (24*60*60*1000));
  return diffDays === 1;
}

// ====== Build the path ======
async function buildPath(user){
  const path = document.getElementById("path");
  const allDoneEl = document.getElementById("allDone");
  if (!path) return;

  const docRef = db.collection("users").doc(user.uid);
  const snap = await docRef.get();

  if (!snap.exists) {
    await docRef.set({
      username:(user.email||"").split("@")[0],
      cards:[],
      mission:Array(LEVEL_COUNT).fill(false),
      points:0,
      // seed new fields
      quizCount: 0,
      quizStreak: 0,
      quizLastYmd: null
    }, {merge:true});
  }

  const data = (await docRef.get()).data() || {};
  let completed = Array.isArray(data.mission) ? data.mission.slice(0, LEVEL_COUNT) : Array(LEVEL_COUNT).fill(false);
  while (completed.length < LEVEL_COUNT) completed.push(false);

  // ensure 15 items stored (fixes older 10-slot users)
  if (!Array.isArray(data.mission) || data.mission.length !== LEVEL_COUNT) {
    await docRef.set({ mission: completed }, { merge: true });
  }

  renderPoints(typeof data.points==="number" ? data.points : 0);

  const activeIdx = completed.findIndex(v=>!v);
  path.innerHTML = "";
  if (activeIdx === -1) {
    document.getElementById("allDone")?.classList.remove("hidden");
    for (let i=0;i<LEVEL_COUNT;i++) path.appendChild(nodeElement(i,"done"));
    return;
  }
  document.getElementById("allDone")?.classList.add("hidden");

  for (let i=0;i<LEVEL_COUNT;i++){
    const state = completed[i] ? "done" : (i===activeIdx ? "active" : "locked");
    const li = nodeElement(i, state);
    const btn = li.querySelector(".badge");
    if (state==="active") btn.addEventListener("click", ()=>startQuiz(i, docRef, completed));
    if (state==="locked") btn.addEventListener("click", ()=>toast("กรุณาผ่านด่านก่อนหน้าให้ครบก่อน"));
    path.appendChild(li);
  }
}

// ====== Quiz flow ======
let CURRENT_USER_LOCAL = null;
auth.onAuthStateChanged(function(u){
  CURRENT_USER_LOCAL = u;
});

function startQuiz(levelIdx, docRef, completed){
  const modal = document.getElementById("quizModal");
  const box   = document.getElementById("quizBox");

  const questions = pickQuestionsForCheckpoint(levelIdx);
  let idx = 0;
  const answers = Array(10).fill(undefined);

  function render(){
    const q = questions[idx];
    box.innerHTML = `
      <button class="close-x" id="closeX" aria-label="Close">×</button>
      <div class="q-header">
        <div class="q-title" id="quizTitle">ด่าน ${levelIdx+1}</div>
        <div class="q-progress">${idx+1}/10</div>
      </div>
      <div class="q-body">${q.q}</div>
      <div class="q-options">
        ${q.opts.map((t,i)=>`<div class="q-option" data-i="${i}">${t}</div>`).join("")}
      </div>
      <div class="q-actions">
        ${idx>0?'<button class="btn btn-grey" id="backBtn">ย้อนกลับ</button>':''}
        <button class="btn btn-red" id="nextBtn">${idx<9?'ถัดไป':'เสร็จสิ้น'}</button>
      </div>
    `;
    modal.classList.add("show");

    document.getElementById("closeX").onclick = ()=> modal.classList.remove("show");

    // restore selection
    let selected = (answers[idx] !== undefined) ? answers[idx] : -1;
    const opts = [...box.querySelectorAll(".q-option")];
    const highlight =()=>opts.forEach(o=>o.classList.toggle("selected", Number(o.dataset.i)===selected));
    highlight();
    opts.forEach(el=>el.onclick=()=>{ selected=Number(el.dataset.i); answers[idx]=selected; highlight(); });

    if (idx>0) document.getElementById("backBtn").onclick=()=>{ idx--; render(); };

    document.getElementById("nextBtn").onclick = async ()=>{
      if (selected === -1) return;
      if (idx < 9) { idx++; render(); return; }

      // Finished — compute score
      const correct = answers.reduce((sum,ans,i)=> sum + (ans===questions[i].a ? 1 : 0), 0);
      const firstTime = !completed[levelIdx];

      // --- write per-question attempt stats (parallel, faster) ---
      try{
        const writes = questions.map((q, i) =>
          db.collection('questionStats').doc(q.id)
            .collection('answers')
            .add({
              uid: CURRENT_USER_LOCAL ? CURRENT_USER_LOCAL.uid : 'anon',
              correct: (answers[i] === q.a),
              level: levelIdx+1,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            })
        );
        await Promise.all(writes);
      }catch(e){ log("questionStats write failed:", e); }

      if (correct === 10){
        completed[levelIdx] = true;

        // points: only once per level (keep old logic)
        if (firstTime){
          await docRef.set({ mission: completed, points: firebase.firestore.FieldValue.increment(1) }, {merge:true});
          renderPoints(CURRENT_POINTS + 1);
        } else {
          await docRef.set({ mission: completed }, {merge:true});
        }

        // quizCount + daily streak (count successful 10/10 only)
        try{
          const uSnap = await docRef.get();
          const uData = uSnap.data() || {};
          const today = ymd(new Date());
          let streak = (uData.quizStreak|0) || 0;
          const last  = uData.quizLastYmd || null;

          if (last === today) {
            // already counted today -> keep streak
          } else if (isYesterday(last, today)) {
            streak = (streak|0) + 1;
          } else {
            streak = 1;
          }

          await docRef.set({
            quizCount: firebase.firestore.FieldValue.increment(1),
            quizStreak: streak,
            quizLastYmd: today
          }, { merge: true });
        }catch(e){ log("streak update error:", e); }

        box.innerHTML = `
          <button class="close-x" id="closeX2" aria-label="Close">×</button>
          <div class="center">
            <h2 class="q-title">🎉 เยี่ยมมาก! ตอบถูก 10/10</h2>
            <p>คุณผ่านด่านที่ ${levelIdx+1} แล้ว</p>
            <p>+1 🧠 คะแนน ${firstTime?'(ครั้งแรก)':'(เคยได้รับแล้ว)'}</p>
            <button class="btn btn-red" id="okBtn">ตกลง</button>
          </div>`;
        document.getElementById("closeX2").onclick=()=>modal.classList.remove("show");
        document.getElementById("okBtn").onclick = ()=>location.reload();
      } else {
        box.innerHTML = `
          <button class="close-x" id="closeX3" aria-label="Close">×</button>
          <div class="center">
            <h2 class="q-title">สู้ต่อไป!</h2>
            <p>คุณได้ <b>${correct}/10</b> ต้องได้ <b>10/10</b> ถึงจะผ่านด่าน</p>
            <div class="q-actions" style="justify-content:center">
              <button class="btn btn-grey" id="closeBtn">ปิด</button>
              <button class="btn btn-red" id="retryBtn">ลองอีกครั้ง</button>
            </div>
          </div>`;
        document.getElementById("closeX3").onclick=()=>modal.classList.remove("show");
        document.getElementById("closeBtn").onclick = ()=>modal.classList.remove("show");
        document.getElementById("retryBtn").onclick = ()=>{
          const fresh = pickQuestionsForCheckpoint(levelIdx);
          for (let i=0;i<10;i++) questions[i] = fresh[i];
          idx = 0; answers.fill(undefined); render();
        };
      }
    };
  }
  render();
}

// ====== Simple notice modal ======
function toast(msg){
  const modal = document.getElementById("quizModal");
  const box   = document.getElementById("quizBox");
  box.innerHTML = `
    <button class="close-x" id="closeNoticeX" aria-label="Close">×</button>
    <div class="center">
      <h3 class="q-title">แจ้งเตือน</h3>
      <p>${msg}</p>
      <button class="btn btn-red" id="closeNotice">ตกลง</button>
    </div>`;
  modal.classList.add("show");
  document.getElementById("closeNoticeX").onclick = ()=>modal.classList.remove("show");
  document.getElementById("closeNotice").onclick  = ()=>modal.classList.remove("show");
    }
