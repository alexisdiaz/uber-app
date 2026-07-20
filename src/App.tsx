import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Car,
  Fuel,
  Gauge,
  LogOut,
  Plus,
  ReceiptText,
  Save,
  Settings,
  Trash2,
  UserRound,
  Wallet,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "./supabase";

type Shift = {
  id: string;
  shift_date: string;
  gross_income: number;
  fuel_spent: number;
  other_spent: number;
  cash_on_hand: number;
  kilometers: number;
  notes: string | null;
  gas_price: number;
  daily_fuel_target: number;
  fuel_rate: number;
  vehicle_reserve_rate: number;
  driver_rate: number;
  fuel_allocation: number;
  vehicle_allocation: number;
  driver_allocation: number;
  total_spent: number;
  gallons: number;
};

type SettingsRow = {
  gas_price: number;
  daily_fuel_target: number;
  fuel_rate: number;
  vehicle_reserve_rate: number;
  driver_rate: number;
};

type ShiftForm = {
  shift_date: string;
  gross_income: string;
  fuel_spent: string;
  other_spent: string;
  cash_on_hand: string;
  fuel_rate: string;
  vehicle_reserve_rate: string;
  driver_rate: string;
  kilometers: string;
  notes: string;
};

const today = new Date().toISOString().slice(0, 10);
const defaultSettings: SettingsRow = {
  gas_price: 4.42,
  daily_fuel_target: 22.5,
  fuel_rate: 25,
  vehicle_reserve_rate: 22,
  driver_rate: 53,
};

const defaultForm: ShiftForm = {
  shift_date: today,
  gross_income: "",
  fuel_spent: "22.50",
  other_spent: "0",
  cash_on_hand: "0",
  fuel_rate: "25",
  vehicle_reserve_rate: "22",
  driver_rate: "53",
  kilometers: "",
  notes: "",
};

function money(value: number) {
  return new Intl.NumberFormat("es-GT", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function num(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function makeForm(settings: SettingsRow): ShiftForm {
  return {
    ...defaultForm,
    fuel_spent: settings.daily_fuel_target.toFixed(2),
    fuel_rate: settings.fuel_rate.toString(),
    vehicle_reserve_rate: settings.vehicle_reserve_rate.toString(),
    driver_rate: settings.driver_rate.toString(),
  };
}

function calculate(form: ShiftForm, settings: SettingsRow) {
  const gross = num(form.gross_income);
  const fuelSpent = num(form.fuel_spent);
  const otherSpent = num(form.other_spent);
  const cashOnHand = num(form.cash_on_hand);
  const kilometers = num(form.kilometers);
  const totalSpent = fuelSpent + otherSpent;
  const distributable = Math.max(gross - otherSpent, 0);
  const rawFuelRate = Math.max(num(form.fuel_rate), 0);
  const rawVehicleRate = Math.max(num(form.vehicle_reserve_rate), 0);
  const rawDriverRate = Math.max(num(form.driver_rate), 0);
  const rateTotal = rawFuelRate + rawVehicleRate + rawDriverRate;
  const fuelRate = rateTotal > 0 ? (rawFuelRate / rateTotal) * 100 : settings.fuel_rate;
  const vehicleRate = rateTotal > 0 ? (rawVehicleRate / rateTotal) * 100 : settings.vehicle_reserve_rate;
  const driverRate = rateTotal > 0 ? (rawDriverRate / rateTotal) * 100 : settings.driver_rate;
  const fuelAllocation = distributable * (fuelRate / 100);
  const vehicleAllocation = distributable * (vehicleRate / 100);
  const driverAllocation = distributable * (driverRate / 100);
  const gallons = settings.gas_price > 0 ? fuelSpent / settings.gas_price : 0;
  const costPerKm = kilometers > 0 ? totalSpent / kilometers : 0;

  return {
    gross,
    fuelSpent,
    otherSpent,
    cashOnHand,
    kilometers,
    totalSpent,
    distributable,
    fuelRate,
    vehicleRate,
    driverRate,
    rawRateTotal: rateTotal,
    fuelAllocation,
    vehicleAllocation,
    driverAllocation,
    gallons,
    costPerKm,
  };
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authMessage, setAuthMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<SettingsRow>(defaultSettings);
  const [form, setForm] = useState<ShiftForm>(defaultForm);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [notice, setNotice] = useState("");

  const projection = useMemo(() => calculate(form, settings), [form, settings]);

  const totals = useMemo(() => {
    return shifts.reduce(
      (acc, shift) => {
        acc.gross += num(shift.gross_income);
        acc.fuel += num(shift.fuel_allocation);
        acc.vehicle += num(shift.vehicle_allocation);
        acc.driver += num(shift.driver_allocation);
        acc.spent += num(shift.total_spent);
        acc.cash += num(shift.cash_on_hand);
        acc.kilometers += num(shift.kilometers);
        acc.gallons += num(shift.gallons);
        return acc;
      },
      { gross: 0, fuel: 0, vehicle: 0, driver: 0, spent: 0, cash: 0, kilometers: 0, gallons: 0 },
    );
  }, [shifts]);

  const monthlyTotals = useMemo(() => {
    const currentMonth = today.slice(0, 7);
    return shifts
      .filter((shift) => shift.shift_date.startsWith(currentMonth))
      .reduce(
        (acc, shift) => {
          acc.gross += num(shift.gross_income);
          acc.fuel += num(shift.fuel_allocation);
          acc.vehicle += num(shift.vehicle_allocation);
          acc.driver += num(shift.driver_allocation);
          acc.spent += num(shift.total_spent);
          acc.cash += num(shift.cash_on_hand);
          acc.kilometers += num(shift.kilometers);
          return acc;
        },
        { gross: 0, fuel: 0, vehicle: 0, driver: 0, spent: 0, cash: 0, kilometers: 0 },
      );
  }, [shifts]);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user.id) return;
    void loadData(session.user.id);
  }, [session?.user.id]);

  async function loadData(userId: string) {
    if (!supabase) return;
    setLoading(true);
    setNotice("");

    const [{ data: settingsData, error: settingsError }, { data: shiftsData, error: shiftsError }] =
      await Promise.all([
        supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
        supabase
          .from("daily_shifts")
          .select("*")
          .eq("user_id", userId)
          .order("shift_date", { ascending: false })
          .order("created_at", { ascending: false }),
      ]);

    if (settingsError || shiftsError) {
      setNotice("No pude leer los datos. Revisa que hayas ejecutado el SQL de Supabase.");
    } else {
      const nextSettings = {
        ...defaultSettings,
        ...(settingsData ?? {}),
      } as SettingsRow;
      setSettings(nextSettings);
      setForm((current) => ({
        ...current,
        fuel_spent: nextSettings.daily_fuel_target.toFixed(2),
        fuel_rate: nextSettings.fuel_rate.toString(),
        vehicle_reserve_rate: nextSettings.vehicle_reserve_rate.toString(),
        driver_rate: nextSettings.driver_rate.toString(),
      }));
      setShifts((shiftsData ?? []) as Shift[]);
      if (!settingsData) {
        await supabase.from("user_settings").insert({ user_id: userId, ...defaultSettings });
      }
    }

    setLoading(false);
  }

  async function handleAuth(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setAuthMessage("");

    const action =
      authMode === "login"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });

    const { error } = await action;
    if (error) {
      setAuthMessage(error.message);
    } else if (authMode === "signup") {
      setAuthMessage("Cuenta creada. Si Supabase pide confirmacion, revisa tu correo.");
    }

    setLoading(false);
  }

  async function saveSettings() {
    if (!supabase || !session?.user.id) return;
    setLoading(true);
    const { error } = await supabase.from("user_settings").upsert({
      user_id: session.user.id,
      ...settings,
      updated_at: new Date().toISOString(),
    });
    setNotice(error ? "No se pudieron guardar los ajustes." : "Ajustes guardados.");
    setLoading(false);
  }

  async function saveShift(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase || !session?.user.id) return;
    setLoading(true);
    setNotice("");

    const payload = {
      user_id: session.user.id,
      shift_date: form.shift_date,
      gross_income: projection.gross,
      fuel_spent: projection.fuelSpent,
      other_spent: projection.otherSpent,
      cash_on_hand: projection.cashOnHand,
      kilometers: projection.kilometers,
      notes: form.notes.trim() || null,
      gas_price: settings.gas_price,
      daily_fuel_target: settings.daily_fuel_target,
      fuel_rate: projection.fuelRate,
      vehicle_reserve_rate: projection.vehicleRate,
      driver_rate: projection.driverRate,
      fuel_allocation: projection.fuelAllocation,
      vehicle_allocation: projection.vehicleAllocation,
      driver_allocation: projection.driverAllocation,
      total_spent: projection.totalSpent,
      gallons: projection.gallons,
    };

    const { error } = await supabase.from("daily_shifts").insert(payload);
    if (error) {
      setNotice("No se pudo guardar la jornada.");
    } else {
      setNotice("Jornada guardada.");
      setForm(makeForm(settings));
      await loadData(session.user.id);
    }

    setLoading(false);
  }

  async function deleteShift(id: string) {
    if (!supabase || !session?.user.id) return;
    setLoading(true);
    const { error } = await supabase.from("daily_shifts").delete().eq("id", id);
    setNotice(error ? "No se pudo borrar la jornada." : "Jornada borrada.");
    await loadData(session.user.id);
    setLoading(false);
  }

  if (!isSupabaseConfigured) {
    return (
      <main className="setup-screen">
        <section className="setup-panel">
          <div className="mark">
            <Car size={30} />
          </div>
          <h1>Control Uber Diario</h1>
          <p>
            Falta conectar Supabase. Crea un archivo <strong>.env</strong> con tus claves y ejecuta el
            SQL incluido en <strong>supabase/schema.sql</strong>.
          </p>
          <div className="env-box">
            <span>VITE_SUPABASE_URL=https://tu-proyecto.supabase.co</span>
            <span>VITE_SUPABASE_ANON_KEY=tu_anon_key</span>
          </div>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="login-screen">
        <section className="login-panel">
          <div className="brand-row">
            <div className="mark">
              <Car size={30} />
            </div>
            <div>
              <h1>Control Uber Diario</h1>
              <p>Registra tu jornada, gastos y separa tu dinero sin hacer cuentas tarde en la noche.</p>
            </div>
          </div>

          <form onSubmit={handleAuth} className="login-form">
            <label>
              Correo
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label>
              Contrasena
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                required
              />
            </label>
            {authMessage && <p className="notice">{authMessage}</p>}
            <button type="submit" disabled={loading}>
              <UserRound size={18} />
              {authMode === "login" ? "Entrar" : "Crear cuenta"}
            </button>
          </form>

          <button className="ghost-button" onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}>
            {authMode === "login" ? "Crear una cuenta nueva" : "Ya tengo cuenta"}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Jornada Uber</p>
          <h1>Control de dinero diario</h1>
        </div>
        <button className="icon-button" aria-label="Cerrar sesion" onClick={() => supabase?.auth.signOut()}>
          <LogOut size={20} />
        </button>
      </header>

      {notice && <p className="notice app-notice">{notice}</p>}

      <section className="summary-grid">
        <Metric icon={<Wallet />} label="Ingresado" value={money(totals.gross)} />
        <Metric icon={<Fuel />} label="Combustible" value={money(totals.fuel)} />
        <Metric icon={<Car />} label="Reserva vehiculo" value={money(totals.vehicle)} />
        <Metric icon={<UserRound />} label="Para ti" value={money(totals.driver)} />
        <Metric icon={<ReceiptText />} label="Gastado" value={money(totals.spent)} />
        <Metric icon={<Wallet />} label="Efectivo" value={money(totals.cash)} />
        <Metric icon={<Gauge />} label="Kilometros" value={`${totals.kilometers.toFixed(1)} km`} />
      </section>

      <section className="panel month-panel">
        <div className="section-title compact">
          <div>
            <p className="eyebrow">Mes actual</p>
            <h2>Resumen mensual</h2>
          </div>
        </div>
        <div className="month-grid">
          <MiniMetric label="Ingresado" value={money(monthlyTotals.gross)} />
          <MiniMetric label="Combustible" value={money(monthlyTotals.fuel)} />
          <MiniMetric label="Vehiculo" value={money(monthlyTotals.vehicle)} />
          <MiniMetric label="Para ti" value={money(monthlyTotals.driver)} />
          <MiniMetric label="Gastado" value={money(monthlyTotals.spent)} />
          <MiniMetric label="Efectivo" value={money(monthlyTotals.cash)} />
          <MiniMetric label="Km del mes" value={`${monthlyTotals.kilometers.toFixed(1)} km`} />
        </div>
      </section>

      <div className="workspace">
        <section className="panel form-panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">Nuevo cierre</p>
              <h2>Registrar jornada</h2>
            </div>
            <Plus size={22} />
          </div>

          <form onSubmit={saveShift} className="shift-form">
            <div className="field-row">
              <label>
                Fecha
                <input
                  type="date"
                  value={form.shift_date}
                  onChange={(event) => setForm({ ...form, shift_date: event.target.value })}
                  required
                />
              </label>
              <label>
                Km recorridos
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={form.kilometers}
                  onChange={(event) => setForm({ ...form, kilometers: event.target.value })}
                  placeholder="180"
                  required
                />
              </label>
            </div>
            <div className="field-row">
              <label>
                Total ingresado
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.gross_income}
                  onChange={(event) => setForm({ ...form, gross_income: event.target.value })}
                  placeholder="125.00"
                  required
                />
              </label>
              <label>
                Combustible gastado
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.fuel_spent}
                  onChange={(event) => setForm({ ...form, fuel_spent: event.target.value })}
                  required
                />
              </label>
            </div>
            <label>
              Otros gastos
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.other_spent}
                onChange={(event) => setForm({ ...form, other_spent: event.target.value })}
              />
            </label>
            <label>
              Efectivo que llevas hoy
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.cash_on_hand}
                onChange={(event) => setForm({ ...form, cash_on_hand: event.target.value })}
                placeholder="40.00"
              />
            </label>
            <div className="percentage-box">
              <div>
                <p className="eyebrow">Porcentajes de este cierre</p>
                <h3>Reparto opcional</h3>
              </div>
              <div className="field-row">
                <label>
                  Combustible %
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    value={form.fuel_rate}
                    onChange={(event) => setForm({ ...form, fuel_rate: event.target.value })}
                  />
                </label>
                <label>
                  Vehiculo %
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    value={form.vehicle_reserve_rate}
                    onChange={(event) => setForm({ ...form, vehicle_reserve_rate: event.target.value })}
                  />
                </label>
                <label>
                  Yo %
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    value={form.driver_rate}
                    onChange={(event) => setForm({ ...form, driver_rate: event.target.value })}
                  />
                </label>
              </div>
              <small>
                Total escrito: {projection.rawRateTotal.toFixed(0)}%. Calculado como{" "}
                {projection.fuelRate.toFixed(1)}% / {projection.vehicleRate.toFixed(1)}% /{" "}
                {projection.driverRate.toFixed(1)}%.
              </small>
            </div>
            <label>
              Nota
              <textarea
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                placeholder="Lavado, parqueo, reparacion menor..."
              />
            </label>
            <button type="submit" disabled={loading}>
              <Save size={18} />
              Guardar jornada
            </button>
          </form>
        </section>

        <aside className="panel split-panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">Reparto estimado</p>
              <h2>De esta jornada</h2>
            </div>
            <ReceiptText size={22} />
          </div>
          <div className="allocation-list">
            <Allocation label="Combustible" value={projection.fuelAllocation} detail={`${projection.fuelRate.toFixed(1)}% separado, ${projection.gallons.toFixed(2)} gal gastados`} />
            <Allocation label="Reserva vehiculo" value={projection.vehicleAllocation} detail={`${projection.vehicleRate.toFixed(1)}% para desgaste y mantenimiento`} />
            <Allocation label="Para ti" value={projection.driverAllocation} detail={`${projection.driverRate.toFixed(1)}% disponible para ti`} />
            <Allocation label="Gastos totales" value={projection.totalSpent} detail={`${money(projection.costPerKm)} por km`} muted />
            <Allocation label="Efectivo contado" value={projection.cashOnHand} detail="Dinero fisico que llevas hoy" muted />
          </div>

          <div className="settings-box">
            <div className="section-title compact">
              <h3>Ajustes</h3>
              <Settings size={18} />
            </div>
            <label>
              Precio galon regular
              <input
                type="number"
                step="0.01"
                min="0"
                value={settings.gas_price}
                onChange={(event) => setSettings({ ...settings, gas_price: num(event.target.value) })}
              />
            </label>
            <label>
              Meta diaria combustible
              <input
                type="number"
                step="0.01"
                min="0"
                value={settings.daily_fuel_target}
                onChange={(event) => setSettings({ ...settings, daily_fuel_target: num(event.target.value) })}
              />
            </label>
            <label>
              Combustible % por defecto
              <input
                type="number"
                step="1"
                min="0"
                max="100"
                value={settings.fuel_rate}
                onChange={(event) => setSettings({ ...settings, fuel_rate: num(event.target.value) })}
              />
            </label>
            <label>
              Reserva vehiculo %
              <input
                type="number"
                step="1"
                min="0"
                max="80"
                value={settings.vehicle_reserve_rate}
                onChange={(event) => setSettings({ ...settings, vehicle_reserve_rate: num(event.target.value) })}
              />
            </label>
            <label>
              Yo % por defecto
              <input
                type="number"
                step="1"
                min="0"
                max="100"
                value={settings.driver_rate}
                onChange={(event) => setSettings({ ...settings, driver_rate: num(event.target.value) })}
              />
            </label>
            <button type="button" className="secondary-button" onClick={saveSettings} disabled={loading}>
              Guardar ajustes
            </button>
          </div>
        </aside>
      </div>

      <section className="panel history-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Historial</p>
            <h2>Jornadas guardadas</h2>
          </div>
          <span className="count-pill">{shifts.length}</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Ingreso</th>
                <th>Gasolina</th>
                <th>Vehiculo</th>
                <th>Para ti</th>
                <th>Gasto</th>
                <th>Efectivo</th>
                <th>Km</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((shift) => (
                <tr key={shift.id}>
                  <td>
                    <strong>{shift.shift_date}</strong>
                    {shift.notes && <span>{shift.notes}</span>}
                  </td>
                  <td>{money(shift.gross_income)}</td>
                  <td>{money(shift.fuel_allocation)}</td>
                  <td>{money(shift.vehicle_allocation)}</td>
                  <td>{money(shift.driver_allocation)}</td>
                  <td>{money(shift.total_spent)}</td>
                  <td>{money(num(shift.cash_on_hand))}</td>
                  <td>{num(shift.kilometers).toFixed(1)}</td>
                  <td>
                    <button className="icon-button subtle" aria-label="Borrar jornada" onClick={() => deleteShift(shift.id)}>
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
              {!shifts.length && (
                <tr>
                  <td colSpan={9} className="empty-state">
                    Guarda tu primera jornada para empezar a ver acumulados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <article className="mini-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Allocation({
  label,
  value,
  detail,
  muted = false,
}: {
  label: string;
  value: number;
  detail: string;
  muted?: boolean;
}) {
  return (
    <div className={muted ? "allocation muted" : "allocation"}>
      <div>
        <span>{label}</span>
        <small>{detail}</small>
      </div>
      <strong>{money(value)}</strong>
    </div>
  );
}

export default App;
