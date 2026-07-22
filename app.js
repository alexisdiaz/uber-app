// 1) Crea tu proyecto en Supabase.
// 2) Ejecuta schema.sql en el SQL Editor.
// 3) Pega aqui tu URL y anon key de Project Settings > API.
const SUPABASE_URL = "https://mloogmsxdgiiokwdfnsr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_okb5ENjIPzUxmJz4icaaAA_WwKswv6h";

const DEFAULT_SETTINGS = {
  vehiclePercent: 50,
  mePercent: 50,
  gasPrice: 4.42,
  fuelAmount: 20
};

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let entries = [];
let settings = { ...DEFAULT_SETTINGS };

const $ = (id) => document.getElementById(id);
const money = (value) => "$" + Number(value || 0).toFixed(2);
const numberValue = (id) => Number($(id).value || 0);

const els = {
  authView: $("authView"),
  appView: $("appView"),
  authForm: $("authForm"),
  signupButton: $("signupButton"),
  logoutButton: $("logoutButton"),
  authMessage: $("authMessage"),
  formMessage: $("formMessage"),
  settingsMessage: $("settingsMessage"),
  percentStatus: $("percentStatus"),
  entryForm: $("entryForm"),
  journalView: $("journalView"),
  monthSelect: $("monthSelect"),
  entriesBody: $("entriesBody")
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  $("entryDate").valueAsDate = new Date();
  setPercentInputs(DEFAULT_SETTINGS);
  setSettingsInputs(DEFAULT_SETTINGS);
  buildMonthOptions();
  bindEvents();

  const { data } = await db.auth.getSession();
  if (data.session) {
    await loadApp(data.session.user);
  } else {
    showAuth();
  }
}

function bindEvents() {
  els.authForm.addEventListener("submit", login);
  els.signupButton.addEventListener("click", signup);
  els.logoutButton.addEventListener("click", logout);
  els.entryForm.addEventListener("submit", saveEntry);
  els.monthSelect.addEventListener("change", render);
  $("saveSettings").addEventListener("click", saveSettings);
  $("resetPercents").addEventListener("click", () => {
    setPercentInputs(settings);
    updatePreview();
  });

  ["income", "fuelSpent", "otherSpent", "milesStart", "milesEnd", "fuelAmountInput", "vehiclePercent", "mePercent"].forEach((id) => {
    $(id).addEventListener("input", updatePreview);
  });
}

async function login(event) {
  event.preventDefault();
  setMessage(els.authMessage, "Entrando...");
  const { data, error } = await db.auth.signInWithPassword({
    email: $("email").value,
    password: $("password").value
  });

  if (error) {
    setMessage(els.authMessage, error.message, "error");
    return;
  }

  await loadApp(data.user);
}

async function signup() {
  setMessage(els.authMessage, "Creando cuenta...");
  const { data, error } = await db.auth.signUp({
    email: $("email").value,
    password: $("password").value
  });

  if (error) {
    setMessage(els.authMessage, error.message, "error");
    return;
  }

  setMessage(els.authMessage, "Cuenta creada. Si Supabase pide confirmar correo, revisa tu email.", "ok");
  if (data.user) await loadApp(data.user);
}

async function logout() {
  await db.auth.signOut();
  currentUser = null;
  entries = [];
  showAuth();
}

async function loadApp(user) {
  currentUser = user;
  els.authView.classList.add("hidden");
  els.appView.classList.remove("hidden");
  await loadSettings();
  await loadEntries();
}

function showAuth() {
  els.appView.classList.add("hidden");
  els.authView.classList.remove("hidden");
}

async function loadSettings() {
  const { data, error } = await db
    .from("uber_settings")
    .select("*")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (error) {
    setMessage(els.settingsMessage, error.message, "error");
    return;
  }

  settings = data ? normalizeSettings({
    vehiclePercent: Number(data.vehicle_percent),
    mePercent: Number(data.me_percent),
    gasPrice: Number(data.gas_price),
    fuelAmount: Number(data.fuel_amount_default ?? data.daily_fuel_target ?? 20)
  }) : { ...DEFAULT_SETTINGS };

  setPercentInputs(settings);
  setSettingsInputs(settings);
}

async function saveSettings() {
  const next = {
    ...settings,
    fuelAmount: numberValue("fuelAmountSetting"),
    vehiclePercent: numberValue("vehiclePercent"),
    mePercent: numberValue("mePercent"),
    gasPrice: numberValue("gasPrice")
  };

  if (!validPercentTotal(next)) return;

  const payload = settingsPayload(next);

  const { error } = await db.from("uber_settings").upsert(payload, { onConflict: "user_id" });
  if (error) {
    setMessage(els.settingsMessage, error.message, "error");
    return;
  }

  settings = next;
  setMessage(els.settingsMessage, "Ajustes guardados.", "ok");
  updatePreview();
}

async function loadEntries() {
  const { data, error } = await db
    .from("uber_entries")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("entry_date", { ascending: false });

  if (error) {
    setMessage(els.formMessage, error.message, "error");
    return;
  }

  entries = data || [];
  render();
}

async function saveEntry(event) {
  event.preventDefault();
  const percents = currentPercents();
  if (!validPercentTotal(percents)) return;

  const income = numberValue("income");
  const fuelSpent = numberValue("fuelSpent");
  const otherSpent = numberValue("otherSpent");
  const distance = distanceValues();
  if (distance.miles < 0) {
    setMessage(els.formMessage, "Las millas finales deben ser mayores o iguales a las millas de inicio.", "error");
    return;
  }
  const allocation = allocationFor(income, percents);

  const payload = {
    user_id: currentUser.id,
    entry_date: $("entryDate").value,
    income,
    fuel_spent: fuelSpent,
    other_spent: otherSpent,
    km: distance.km,
    miles_start: distance.start,
    miles_end: distance.end,
    miles: distance.miles,
    fuel_percent: 0,
    vehicle_percent: percents.vehiclePercent,
    me_percent: percents.mePercent,
    fuel_amount: allocation.fuel,
    vehicle_amount: allocation.vehicle,
    me_amount: allocation.me,
    gas_price: numberValue("gasPrice"),
    note: $("note").value.trim()
  };

  setMessage(els.formMessage, "Guardando...");
  const { error } = await db.from("uber_entries").insert(payload);

  if (error) {
    setMessage(els.formMessage, error.message, "error");
    return;
  }

  els.entryForm.reset();
  $("entryDate").valueAsDate = new Date();
  setPercentInputs(settings);
  setSettingsInputs(settings);
  setMessage(els.formMessage, "Jornada guardada.", "ok");
  await loadEntries();
  updatePreview();
}

async function deleteEntry(id) {
  if (!confirm("Eliminar esta jornada?")) return;
  const { error } = await db.from("uber_entries").delete().eq("id", id).eq("user_id", currentUser.id);
  if (error) {
    setMessage(els.formMessage, error.message, "error");
    return;
  }
  await loadEntries();
}

function render() {
  const month = els.monthSelect.value;
  const monthEntries = entries.filter((entry) => entry.entry_date.slice(0, 7) === month);
  const totals = monthEntries.reduce((acc, entry) => {
    acc.income += Number(entry.income);
    acc.expenses += Number(entry.fuel_spent) + Number(entry.other_spent);
    acc.miles += Number(entry.miles || 0);
    acc.km += Number(entry.km);
    acc.fuel += Number(entry.fuel_amount);
    acc.vehicle += Number(entry.vehicle_amount);
    acc.me += Number(entry.me_amount);
    acc.fuelSpent += Number(entry.fuel_spent);
    acc.otherSpent += Number(entry.other_spent);
    acc.gallons += Number(entry.gas_price) > 0 ? Number(entry.fuel_spent) / Number(entry.gas_price) : 0;
    return acc;
  }, emptyTotals());

  $("summaryTitle").textContent = monthLabel(month);
  $("sumIncome").textContent = money(totals.income);
  $("totalFuel").textContent = money(totals.fuel);
  $("totalVehicle").textContent = money(totals.vehicle);
  $("totalMe").textContent = money(totals.me);
  $("totalVehicleMe").textContent = money(totals.vehicle + totals.me);
  $("totalFuelSpent").textContent = money(totals.fuelSpent);
  $("totalOtherSpent").textContent = money(totals.otherSpent);
  $("totalMiles").textContent = totals.miles.toFixed(1);
  $("totalKm").textContent = totals.km.toFixed(1);
  $("totalGallons").textContent = totals.gallons.toFixed(2);

  els.entriesBody.innerHTML = monthEntries.map(rowTemplate).join("") || '<tr><td colspan="9">No hay jornadas en este mes.</td></tr>';
  els.entriesBody.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteEntry(button.dataset.delete));
  });
}

function rowTemplate(entry) {
  const expenses = Number(entry.fuel_spent) + Number(entry.other_spent);
  return `
    <tr>
      <td>${entry.entry_date}</td>
      <td>${money(entry.income)}</td>
      <td>${money(expenses)}</td>
      <td>${Number(entry.miles || 0).toFixed(1)}</td>
      <td>${Number(entry.km).toFixed(1)}</td>
      <td>${money(entry.fuel_amount)}</td>
      <td>${money(entry.vehicle_amount)}</td>
      <td>${money(entry.me_amount)}</td>
      <td><button class="secondary danger small" type="button" data-delete="${entry.id}">Borrar</button></td>
    </tr>
  `;
}

function updatePreview() {
  const percents = currentPercents();
  const allocation = allocationFor(numberValue("income"), percents);
  const distance = distanceValues();
  $("previewFuel").textContent = money(allocation.fuel);
  $("previewVehicle").textContent = money(allocation.vehicle);
  $("previewMe").textContent = money(allocation.me);
  $("distancePreview").textContent = Math.max(distance.miles, 0).toFixed(1) + " mi / " + Math.max(distance.km, 0).toFixed(1) + " km";
  validPercentTotal(percents, false);
}

function allocationFor(income, percents) {
  const fuel = Math.min(percents.fuelAmount, income);
  const remaining = Math.max(income - fuel, 0);
  return {
    fuel,
    vehicle: remaining * (percents.vehiclePercent / 100),
    me: remaining * (percents.mePercent / 100)
  };
}

function currentPercents() {
  return {
    fuelAmount: numberValue("fuelAmountInput"),
    vehiclePercent: numberValue("vehiclePercent"),
    mePercent: numberValue("mePercent")
  };
}

function validPercentTotal(percents, showFormMessage = true) {
  const total = percents.vehiclePercent + percents.mePercent;
  const ok = Math.abs(total - 100) < 0.01;
  const message = "Vehiculo + Yo: " + total.toFixed(1) + "%. Combustible fijo: " + money(percents.fuelAmount);
  els.percentStatus.textContent = ok ? message : message + " - vehiculo y yo deben sumar 100%.";
  els.percentStatus.className = ok ? "message ok" : "message error";
  if (!ok && showFormMessage) setMessage(els.formMessage, "Vehiculo y yo deben sumar 100%.", "error");
  return ok;
}

function setPercentInputs(values) {
  $("fuelAmountInput").value = values.fuelAmount;
  $("vehiclePercent").value = values.vehiclePercent;
  $("mePercent").value = values.mePercent;
  updatePreview();
}

function setSettingsInputs(values) {
  $("gasPrice").value = values.gasPrice;
  $("fuelAmountSetting").value = values.fuelAmount;
}

function settingsPayload(values) {
  return {
    user_id: currentUser.id,
    fuel_percent: 0,
    vehicle_percent: values.vehiclePercent,
    me_percent: values.mePercent,
    gas_price: values.gasPrice,
    daily_fuel_target: values.fuelAmount,
    fuel_amount_default: values.fuelAmount,
    updated_at: new Date().toISOString()
  };
}

function normalizeSettings(values) {
  const percentTotal = values.vehiclePercent + values.mePercent;
  if (Math.abs(percentTotal - 100) > 0.01) {
    return {
      ...values,
      vehiclePercent: DEFAULT_SETTINGS.vehiclePercent,
      mePercent: DEFAULT_SETTINGS.mePercent
    };
  }
  return values;
}

function distanceValues() {
  const start = numberValue("milesStart");
  const end = numberValue("milesEnd");
  const miles = end - start;
  return {
    start,
    end,
    miles,
    km: miles * 1.609344
  };
}

function buildMonthOptions() {
  const today = new Date();
  const formatter = new Intl.DateTimeFormat("es", { month: "long", year: "numeric" });
  const options = [];

  for (let i = 0; i < 18; i += 1) {
    const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const value = date.toISOString().slice(0, 7);
    options.push(`<option value="${value}">${formatter.format(date)}</option>`);
  }

  els.monthSelect.innerHTML = options.join("");
}

function monthLabel(value) {
  const date = new Date(value + "-01T00:00:00");
  return new Intl.DateTimeFormat("es", { month: "long", year: "numeric" }).format(date);
}

function emptyTotals() {
  return {
    income: 0,
    expenses: 0,
    miles: 0,
    km: 0,
    fuel: 0,
    vehicle: 0,
    me: 0,
    fuelSpent: 0,
    otherSpent: 0,
    gallons: 0
  };
}

function setMessage(element, text, type) {
  element.textContent = text || "";
  element.className = type ? "message " + type : "message";
}
