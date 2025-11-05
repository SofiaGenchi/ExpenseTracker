// =========================
// Expense Tracker - main.js
// =========================

// ---------- Utils DOM ----------
const $  = (s) => document.querySelector(s);

// ---------- Config ----------
const DB_KEY = "transactions";
const DEFAULT_CURRENCY = "ARS";       // valor por defecto del selector
const LOCALE = "es-AR";               // para separadores correctos
const BUDGETS = {                     // presupuestos mensuales por categoría
  "Alimentación": 600000,
  "Transporte": 600000,
  "Hogar": 600000,
  "Ocio": 600000,
  "Salud": 600000,
  "Educación": 600000,
  "Ahorro": 600000,
  "Otros": 600000,
};
// Tasas estimadas (ejemplo simple). Si no querés conversión real, dejá todo en ARS.
const RATES = { ARS: 1, USD: 1500, EUR: 1200 };

// ---------- Estado / formato ----------
function getCurrency() {
  const el = $("#currency");
  return el?.value || DEFAULT_CURRENCY;
}
function fmt(n, c = getCurrency(), locale = LOCALE) {
  try { return new Intl.NumberFormat(locale, { style: "currency", currency: c }).format(n); }
  catch { return `${c} ${Number(n || 0).toFixed(2)}`; }
}
function convert(amount, from, to) {
  if (from === to) return amount;
  const rFrom = RATES[from] ?? 1;
  const rTo = RATES[to] ?? 1;
  return amount * (rFrom / rTo);
}

// ---------- Persistencia ----------
function loadTx() {
  const raw = JSON.parse(localStorage.getItem(DB_KEY) || "[]");
  // Migración suave: asegurar tipos/campos
  return raw.map(t => {
    const dateISO = (() => {
      // puede venir Date string, Date object, ISO, etc.
      try {
        const d = new Date(t.date);
        if (Number.isNaN(+d)) return new Date().toISOString().slice(0,10);
        return d.toISOString().slice(0,10);
      } catch { return new Date().toISOString().slice(0,10); }
    })();
    return {
      id: t.id || crypto.randomUUID(),
      type: t.type === "income" ? "income" : "expense",
      name: t.name || "Sin nombre",
      amount: Math.abs(Number(t.amount)) || 0,
      date: dateISO, // guardamos como 'YYYY-MM-DD'
      category: t.category || "Otros",
      tags: Array.isArray(t.tags) ? t.tags : (t.tags ? String(t.tags).split(",").map(x=>x.trim()).filter(Boolean) : []),
      currency: t.currency || DEFAULT_CURRENCY,
      recurrence: t.recurrence || undefined,
    };
  }).sort((a,b)=> (a.date<b.date?1:-1));
}
function saveTx(list) {
  list.sort((a,b)=> (a.date<b.date?1:-1));
  localStorage.setItem(DB_KEY, JSON.stringify(list));
}

// ---------- Data helpers ----------
function parseTags(str){ return str ? str.split(",").map(t=>t.trim()).filter(Boolean) : []; }

function getFilters() {
  return {
    month: $("#filterMonth")?.value || "",  // 'YYYY-MM'
    from:  $("#filterFrom")?.value || "",
    to:    $("#filterTo")?.value || "",
    cat:   $("#filterCategory")?.value || "",
  };
}
function applyFilters(list) {
  const { month, from, to, cat } = getFilters();
  return list.filter(tx => {
    if (cat && tx.category !== cat) return false;
    if (month && !tx.date.startsWith(month)) return false;
    if (from && tx.date < from) return false;
    if (to && tx.date > to) return false;
    return true;
  });
}
function sumByTypeInCurrency(list, currency) {
  let inc=0, exp=0;
  for (const tx of list) {
    const val = tx.currency===currency ? tx.amount : convert(tx.amount, tx.currency, currency);
    if (tx.type==="income") inc += val; else exp += val;
  }
  return { income: inc, expense: exp, balance: inc - exp };
}

// ---------- UI refs ----------
const listEl    = $("#transactionList");
const form      = $("#transactionForm");
const balanceEl = $("#balance");
const incomeEl  = $("#income");
const expenseEl = $("#expense");
const dateInput = $("#date");

// set default date = hoy
if (dateInput) dateInput.value = new Date().toISOString().slice(0,10);

// ---------- Toast ----------
function toast(msg){
  const t=document.createElement("div");
  t.className="toast"; t.textContent=msg; document.body.appendChild(t);
  setTimeout(()=>t.classList.add("show"),10);
  setTimeout(()=>{t.classList.remove("show"); t.remove();},2500);
}

// ---------- Render cabecera totals ----------
function updateTotal() {
  const currency = getCurrency();
  const filtered = applyFilters(loadTx());
  const { income, expense, balance } = sumByTypeInCurrency(filtered, currency);

  balanceEl.textContent = fmt(balance, currency);
  incomeEl.textContent  = fmt(income, currency);
  expenseEl.textContent = fmt(expense, currency);
}

// ---------- Lista ----------
function createItem({ id, name, amount, date, type, category, tags, currency }) {
  const sign = type === "income" ? 1 : -1;
  const li = document.createElement("li");
  li.innerHTML = `
    <div class="name">
      <h4>${name}</h4>
      <p>${new Date(date).toLocaleDateString(LOCALE)} · <small>${category}${tags?.length? " · #" + tags.join(" #"):""}</small></p>
    </div>
    <div class="amount ${type}">
      <span>${fmt(amount * sign, currency)}</span>
    </div>
  `;
  li.addEventListener("click", (e) => {
    e.stopPropagation();
    if (confirm("Delete transaction?")) {
      deleteTransaction(id);
    }
  });
  return li;
}
function renderList() {
  const filtered = applyFilters(loadTx());
  listEl.innerHTML = "";
  filtered.forEach(tx => listEl.appendChild(createItem(tx)));
}

// ---------- Presupuestos ----------
function computeSpentByCategory(list, yyyyMM){
  const spent = {};
  Object.keys(BUDGETS).forEach(c=>spent[c]=0);
  list.forEach(tx=>{
    if (tx.type==="expense" && (!yyyyMM || tx.date.startsWith(yyyyMM))){
      spent[tx.category] = (spent[tx.category]||0) + (tx.currency===getCurrency()? tx.amount : convert(tx.amount, tx.currency, getCurrency()));
    }
  });
  return spent;
}
function renderBudgets() {
  const month = $("#filterMonth")?.value || new Date().toISOString().slice(0,7);
  const filtered = loadTx(); // gastar del mes completo, no sólo filtros adicionales
  const spent = computeSpentByCategory(filtered, month);
  const container = $("#budgets");
  if (!container) return;
  container.innerHTML = "";

  Object.entries(BUDGETS).forEach(([cat, limitARS])=>{
    // convertir límite a la moneda actual para comparación/visual
    const limit = convert(limitARS, "ARS", getCurrency());
    const used = spent[cat] || 0;
    const pct = Math.min(100, Math.round((used/limit)*100));
    const warn = used >= limit*0.9 ? "⚠️" : "";
    const bar = `
      <div class="budget-item">
        <div class="row">
          <strong>${cat}</strong> — ${fmt(used)} / ${fmt(limit)} ${warn}
        </div>
        <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
      </div>`;
    container.insertAdjacentHTML("beforeend", bar);

    if (used >= limit) toast(`Te pasaste del presupuesto de ${cat}`);
    else if (used >= limit*0.9) toast(`Estás cerca del límite de ${cat}`);
  });
}

// ---------- Recurrentes ----------
function materializeRecurrences(){
  const list = loadTx();
  const today = new Date().toISOString().slice(0,10);
  let created = 0;

  for (const tx of list) {
    if (!tx.recurrence?.active) continue;
    let { freq, nextDate } = tx.recurrence;
    while (nextDate && nextDate <= today){
      // clonar como transacción real en nextDate
      list.push({
        id: crypto.randomUUID(),
        type: tx.type,
        name: tx.name,
        amount: tx.amount,
        date: nextDate,
        category: tx.category,
        tags: tx.tags,
        currency: tx.currency,
      });
      // avanzar nextDate
      const d = new Date(nextDate);
      if (freq === "monthly") d.setMonth(d.getMonth()+1);
      if (freq === "yearly")  d.setFullYear(d.getFullYear()+1);
      nextDate = d.toISOString().slice(0,10);
      tx.recurrence.nextDate = nextDate;
      created++;
    }
  }
  if (created>0) {
    saveTx(list);
    toast(`Se registraron ${created} transacciones recurrentes`);
  }
}

// ---------- Importar / Exportar ----------
function download(name, content, type="application/json"){
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([content],{type}));
  a.download=name; a.click(); URL.revokeObjectURL(a.href);
}
$("#exportJSON")?.addEventListener("click", ()=>{
  download("expense-data.json", JSON.stringify(loadTx(), null, 2));
});
$("#exportCSV")?.addEventListener("click", ()=>{
  const list = loadTx();
  const head = ["id","type","name","amount","date","category","tags","currency"];
  const rows = list.map(t=>[
    t.id,t.type,t.name,t.amount,t.date,t.category,(t.tags||[]).join("|"),t.currency
  ]);
  const csv = [head, ...rows]
    .map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(","))
    .join("\n");
  download("expense-data.csv", csv, "text/csv");
});
$("#importFile")?.addEventListener("change", async (e)=>{
  const file = e.target.files?.[0]; if(!file) return;
  const text = await file.text();
  let data=[];
  if (file.name.endsWith(".json")){
    data = JSON.parse(text);
  }else{ // CSV
    const lines = text.trim().split(/\r?\n/);
    const header = lines.shift().split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(s=>s.replace(/^"|"$/g,"").replace(/""/g,'"'));
    const idx = Object.fromEntries(header.map((h,i)=>[h,i]));
    data = lines.map(line=>{
      const c = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(s=>s.replace(/^"|"$/g,"").replace(/""/g,'"'));
      return {
        id: c[idx.id] || crypto.randomUUID(),
        type: c[idx.type]==="income" ? "income" : "expense",
        name: c[idx.name],
        amount: +c[idx.amount],
        date: c[idx.date],
        category: c[idx.category] || "Otros",
        tags: (c[idx.tags]||"").split("|").filter(Boolean),
        currency: c[idx.currency] || DEFAULT_CURRENCY,
      };
    });
  }
  saveTx(data); render();
  toast("Datos importados");
  e.target.value = "";
});

// ---------- Charts (Chart.js) ----------
let chartCat, chartMonth;
function dataByCategory(list, yyyyMM){
  const map = {};
  list.forEach(tx=>{
    if (tx.type==="expense" && (!yyyyMM || tx.date.startsWith(yyyyMM))){
      const val = tx.currency===getCurrency()? tx.amount : convert(tx.amount, tx.currency, getCurrency());
      map[tx.category] = (map[tx.category]||0) + val;
    }
  });
  return map;
}
function dataByMonth(list, months = 6){
  const labels=[], values=[];
  const d=new Date(); d.setDate(1);
  for(let i=months-1;i>=0;i--){
    const dt=new Date(d); dt.setMonth(d.getMonth()-i);
    const key = dt.toISOString().slice(0,7);
    labels.push(key);
    const val = list.filter(t=>t.type==="expense" && t.date.startsWith(key))
      .reduce((a,t)=> a + (t.currency===getCurrency()? t.amount : convert(t.amount, t.currency, getCurrency())), 0);
    values.push(val);
  }
  return { labels, values };
}
function renderCharts(){
  if (!window.Chart) return;
  const list = loadTx();
  const month = $("#filterMonth")?.value || undefined;

  // Pie por categoría
  const catMap = dataByCategory(applyFilters(list), month);
  const ctx1 = document.getElementById("chartByCat")?.getContext("2d");
  if (ctx1){
    chartCat?.destroy();
    chartCat = new Chart(ctx1,{ type:"pie", data:{
      labels:Object.keys(catMap),
      datasets:[{ data:Object.values(catMap) }]
    }});
  }

  // Línea últimos 6 meses
  const {labels,values} = dataByMonth(list, 6);
  const ctx2 = document.getElementById("chartByMonth")?.getContext("2d");
  if (ctx2){
    chartMonth?.destroy();
    chartMonth = new Chart(ctx2,{ type:"line", data:{
      labels, datasets:[{ label:"Gastos por mes", data:values }]
    }});
  }
}

// ---------- CRUD ----------
function deleteTransaction(id) {
  const list = loadTx();
  const index = list.findIndex((t)=>t.id===id);
  if (index<0) return;
  list.splice(index,1);
  saveTx(list);
  render();
}
function addTransaction(e) {
  e.preventDefault();
  const formData = new FormData(form);
  const uniqueId = Date.now().toString(36) + Math.random().toString(36).substring(2);
  const type = formData.get("type")==="on" ? "expense" : "income";
  const name = formData.get("name");
  const amount = parseFloat(formData.get("amount"));
  const date = formData.get("date");
  const category = formData.get("category") || "Otros";
  const tags = parseTags(formData.get("tags"));

  if (!name || Number.isNaN(amount) || !date){
    alert("Please fill in all fields correctly.");
    return;
  }
  const newTx = {
    id: uniqueId,
    name, amount: Math.abs(amount),
    date, type, category, tags,
    currency: getCurrency(),
  };
  const list = loadTx();
  list.push(newTx);
  saveTx(list);

  form.reset();
  $("#date").value = new Date().toISOString().slice(0,10);
  render();
}

// ---------- Demo & Reset ----------
function seedDemo(){
  const base = new Date();
  const iso = (d)=> new Date(d).toISOString().slice(0,10);
  const mk = (daysAgo, o)=>({ date: iso(base - daysAgo*86400000), ...o });

  const demo = [
    mk(2,{ id:crypto.randomUUID(), type:"income",  name:"Sueldo",   amount:600000, category:"Otros",        tags:["trabajo"],   currency:"ARS" }),
    mk(1,{ id:crypto.randomUUID(), type:"expense", name:"Super",    amount:42000,  category:"Alimentación", tags:["comida"],    currency:"ARS" }),
    mk(5,{ id:crypto.randomUUID(), type:"expense", name:"SUBE",     amount:2500,   category:"Transporte",   tags:["subte"],     currency:"ARS" }),
    mk(10,{id:crypto.randomUUID(), type:"expense", name:"Netflix",  amount:4999,   category:"Ocio",         tags:["suscripción"], currency:"ARS",
      recurrence:{freq:"monthly", nextDate: iso(base), active:true} }),
    mk(20,{id:crypto.randomUUID(), type:"expense", name:"Farmacia", amount:12000,  category:"Salud",        tags:["medicina"], currency:"ARS" }),
  ];
  saveTx(demo);
  render();
  toast("Demo cargada");
}
function resetData(){
  localStorage.removeItem(DB_KEY);
  render();
  toast("Datos reiniciados");
}

// ---------- Render principal ----------
function render(){
  updateTotal();
  renderList();
  renderBudgets();
  renderCharts();
}

// ---------- Eventos ----------
form?.addEventListener("submit", addTransaction);
["filterMonth","filterFrom","filterTo","filterCategory","currency"].forEach(id=>{
  const el = document.getElementById(id);
  if (el) el.addEventListener("change", render);
});
$("#clearFilters")?.addEventListener("click", ()=>{
  if ($("#filterMonth")) $("#filterMonth").value="";
  if ($("#filterFrom"))  $("#filterFrom").value="";
  if ($("#filterTo"))    $("#filterTo").value="";
  if ($("#filterCategory")) $("#filterCategory").value="";
  render();
});
$("#seedDemo")?.addEventListener("click", seedDemo);
$("#resetData")?.addEventListener("click", resetData);

// ---------- Init ----------
(function init(){
  materializeRecurrences();
  render();
})();
