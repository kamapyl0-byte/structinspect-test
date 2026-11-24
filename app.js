const DB_NAME = "structinspect-db";
const STORE = "defects";
let db;
let selectedPhotos = [];

const $ = (id) => document.getElementById(id);
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function store(mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = action(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const allRecords = () => store("readonly", s => s.getAll());
const saveRecord = r => store("readwrite", s => s.put(r));

function setTab(name) {
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("hidden", p.id !== name));
  if (name === "journal") renderRecords();
}
document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));

function updateStatus() {
  $("connection").textContent = navigator.onLine ? "Онлайн · данные локально" : "Офлайн · работает";
  $("connection").style.borderColor = navigator.onLine ? "#638096" : "#49a77d";
}
window.addEventListener("online", updateStatus);
window.addEventListener("offline", updateStatus);

$("photos").addEventListener("change", async e => {
  selectedPhotos = [];
  for (const file of [...e.target.files]) {
    if (!file.type.startsWith("image/")) continue;
    selectedPhotos.push({ name: file.name || "photo.jpg", type: file.type, data: await fileToDataURL(file) });
  }
  $("photoPreview").innerHTML = "";
  selectedPhotos.forEach(p => {
    const img = document.createElement("img");
    img.src = p.data;
    $("photoPreview").appendChild(img);
  });
});
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

$("defectForm").addEventListener("submit", async e => {
  e.preventDefault();
  const records = await allRecords();
  const id = `D-${Date.now()}`;
  const record = {
    id, createdAt: new Date().toISOString(), project: $("project").value.trim(),
    element: $("element").value, mark: $("mark").value.trim(),
    axes: $("axes").value.trim(), elevation: $("elevation").value.trim(),
    defectType: $("defectType").value, dimensions: $("dimensions").value.trim(),
    description: $("description").value.trim(), photos: selectedPhotos
  };
  await saveRecord(record);
  $("formMessage").textContent = `Сохранено: ${id}`;
  $("defectForm").reset();
  $("photoPreview").innerHTML = "";
  selectedPhotos = [];
  await updateCounts();
});

async function updateCounts() {
  const records = await allRecords();
  const n = records.length;
  $("count").textContent = `${n} ${n === 1 ? "дефект" : n < 5 ? "дефекта" : "дефектов"}`;
  $("tabCount").textContent = n;
}
async function renderRecords() {
  const records = (await allRecords()).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  const root = $("records");
  root.innerHTML = "";
  if (!records.length) {
    root.innerHTML = '<div class="empty">Пока нет зарегистрированных дефектов.<br>Добавь первую запись на вкладке «Новый дефект».</div>';
    return;
  }
  records.forEach(r => {
    const card = document.createElement("article");
    card.className = "record";
    const date = new Date(r.createdAt).toLocaleString("ru-RU");
    card.innerHTML = `<div class="record-top"><span>${escapeHTML(r.id)}</span><span>${escapeHTML(date)}</span></div>
      <h3>${escapeHTML(r.element)} ${escapeHTML(r.mark)}</h3>
      <p><b>Оси:</b> ${escapeHTML(r.axes)} · <b>Отметка:</b> ${escapeHTML(r.elevation || "не указана")}</p>
      <p><b>Дефект:</b> ${escapeHTML(r.defectType)} · <b>Размер:</b> ${escapeHTML(r.dimensions || "не указан")}</p>
      <p>${escapeHTML(r.description || "Описание не добавлено")}</p>
      <div class="record-photos">${(r.photos || []).map(p => `<img src="${p.data}" alt="Фото дефекта">`).join("")}</div>`;
    const del = document.createElement("button");
    del.className = "ghost";
    del.textContent = "Удалить запись";
    del.style.marginTop = "10px";
    del.addEventListener("click", async () => {
      if (confirm("Удалить эту запись? Сначала убедись, что у тебя есть резервная копия.")) {
        await store("readwrite", s => s.delete(r.id));
        renderRecords(); updateCounts();
      }
    });
    card.appendChild(del);
    root.appendChild(card);
  });
}
function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
$("refresh").addEventListener("click", renderRecords);

$("export").addEventListener("click", async () => {
  const payload = { app: "StructInspect", schemaVersion: 1, exportedAt: new Date().toISOString(), project: $("project").value, defects: await allRecords() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `StructInspect-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(url);
  $("backupMessage").textContent = "Резервная копия подготовлена. Проверь, что файл действительно сохранился.";
});
$("importFile").addEventListener("change", async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (!Array.isArray(payload.defects)) throw new Error("Неверный формат файла");
    for (const r of payload.defects) await saveRecord(r);
    if (payload.project) $("project").value = payload.project;
    await updateCounts();
    $("backupMessage").textContent = `Импортировано записей: ${payload.defects.length}.`;
  } catch(err) {
    $("backupMessage").textContent = `Не удалось импортировать: ${err.message}`;
  }
});

(async function init() {
  db = await openDB();
  updateStatus();
  await updateCounts();
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./sw.js"); } catch(e) { console.warn("SW registration failed", e); }
  }
})();
