:root{
  --bg:#0f0f13; --card:#2b2b33; --accent:#7b5cff; --muted:#bfbfbf;
}
*{box-sizing:border-box}
html,body{height:100%;margin:0;font-family:Inter, system-ui, Arial, sans-serif;background:linear-gradient(180deg,#0b0b0d 0%, #111217 100%);color:#e9e9ee}
.wrap{max-width:420px;margin:28px auto;padding:18px}
.topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.topbar h1{font-size:18px;margin:0}
.wallet{font-weight:700}
.gacha-area{background:rgba(255,255,255,0.02);padding:16px;border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,0.6)}
.progress{font-size:13px;color:var(--muted);margin-bottom:12px}
.card-row{display:flex;gap:12px;justify-content:center;margin-bottom:12px}
.card{width:98px;height:148px;border-radius:10px;background:var(--card);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;box-shadow:0 6px 14px rgba(0,0,0,0.6);transition:transform .28s ease, box-shadow .28s}
.card.back{background:linear-gradient(180deg,#2b2b33,#26262b)}
.card .q{font-size:46px;color:#d6d6df}
.card.revealed{transform:translateY(-6px);box-shadow:0 12px 30px rgba(0,0,0,0.7)}
.controls{display:flex;flex-direction:column;align-items:center;gap:8px}
.btn{background:var(--accent);color:white;border:none;padding:10px 18px;border-radius:999px;cursor:pointer;font-weight:700}
.btn.small{padding:8px 12px;font-size:13px}
.hint{color:var(--muted);font-size:13px}
.footnote{font-size:12px;color:#9b9bb0;margin-top:10px;text-align:center}
.modal{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5)}
.modal.hidden{display:none}
.modal-card{background:linear-gradient(180deg,#17171a,#141417);padding:20px;border-radius:10px;min-width:260px;text-align:center}
.modal-card h3{margin:0 0 8px}
#modalBody{font-size:14px;color:var(--muted);margin-bottom:10px}
.smalltext{font-size:12px;color:var(--muted)}
@media (max-width:420px){.card{width:84px;height:124px}}
