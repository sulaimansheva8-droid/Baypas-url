const urlInput = document.getElementById("urlInput");
const goBtn = document.getElementById("goBtn");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const resultInput = document.getElementById("resultInput");
const copyBtn = document.getElementById("copyBtn");
const openBtn = document.getElementById("openBtn");

function setStatus(type, msg) {
  statusEl.className = "status " + type;
  statusEl.textContent = msg;
  statusEl.classList.remove("hidden");
}
function hideStatus() { statusEl.classList.add("hidden"); }

async function bypass() {
  const url = urlInput.value.trim();
  if (!url) return setStatus("error", "Isi dulu URL shortlink-nya, bro 😅");
  goBtn.disabled = true;
  resultEl.classList.add("hidden");
  setStatus("loading", "⏳ Lagi resolve... sabar ya 🕐");
  try {
    const res = await fetch("/api/bypass", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Gagal resolve");
    hideStatus();
    resultInput.value = data.result;
    openBtn.href = data.result;
    resultEl.classList.remove("hidden");
  } catch (err) {
    setStatus("error", "❌ " + err.message);
  } finally {
    goBtn.disabled = false;
  }
}
goBtn.addEventListener("click", bypass);
urlInput.addEventListener("keydown", e => { if (e.key === "Enter") bypass(); });
copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(resultInput.value);
    copyBtn.textContent = "✅";
    setTimeout(() => (copyBtn.textContent = "📋"), 1500);
  } catch {}
});
