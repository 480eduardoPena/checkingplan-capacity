import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Settings,
  Calculator,
  Plus,
  X,
  Check,
  Loader2,
  Calendar,
  User,
  Save,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Briefcase,
  RefreshCw,
  Trash2,
  Pencil,
  ExternalLink,
  ListTodo,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";

/* ────────────────────────────────────────────────────────── */
/*  CONSTANTS                                                 */
/* ────────────────────────────────────────────────────────── */

const STORAGE_KEY = "checkingplan_capacity_v1";
const ZOHO_PORTAL_ID = "20059477103";
const ZOHO_DC = "eu";
const ZOHO_PORTAL_NAME = "conpas";
// Projects excluded from capacity calculations (absences, holidays, etc.)
const EXCLUDED_PROJECTS = new Set(["ausencias checkingplan"]);
const ACTIVE_STATUSES = new Set(["pendiente", "en curso"]);

const SKILLS = [
  { key: "sql", label: "Consultas SQL" },
  { key: "net45", label: ".NET 4.5" },
  { key: "android", label: "Android" },
  { key: "reactjs", label: "React JS" },
  { key: "reactnative", label: "React Native" },
  { key: "flutter", label: "Flutter" },
];

// Skills marked as externalised (sólo mantenimiento – supervisión)
const EXTERNAL_SKILLS = new Set(["reactjs", "reactnative", "flutter"]);

const DEFAULT_DATA = {
  programmers: [
    {
      id: "ricardo",
      name: "Ricardo Cruz",
      zoho_zpuid: "5125000004360033",
      email: "ricardo.cruz@cuatroochenta.com",
      permanent: true,
      skills: { sql: true, net45: true, android: true, reactjs: false, reactnative: false, flutter: false },
      capacity: 59,
    },
    {
      id: "eduardo",
      name: "Eduardo Peña",
      zoho_zpuid: "5125000004207087",
      email: "eduardo.pena@cuatroochenta.com",
      permanent: true,
      skills: { sql: true, net45: true, android: true, reactjs: false, reactnative: false, flutter: false },
      capacity: 44,
    },
    {
      id: "joseph",
      name: "Joseph Rafael Montenegro",
      zoho_zpuid: "5125000023057263",
      email: "rafael.montenegro@cuatroochenta.com",
      permanent: true,
      skills: { sql: false, net45: true, android: true, reactjs: false, reactnative: false, flutter: false },
      capacity: 75,
    },
  ],
};

/* CheckingPlan-style green palette */
const C = {
  green: "#7AB648",
  greenDark: "#5A8A2E",
  greenSoft: "#E8F5DC",
  greenLine: "#C5E0A4",
  ink: "#1F2A1A",
  mute: "#6B7565",
  border: "#E5E9E1",
  bg: "#FAFBF8",
  surface: "#FFFFFF",
  warn: "#D97706",
  danger: "#DC2626",
};

/* ────────────────────────────────────────────────────────── */
/*  HELPERS                                                   */
/* ────────────────────────────────────────────────────────── */

const fmtDate = (d) => {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
};

const fmtMonth = (d) =>
  d.toLocaleDateString("es-ES", { month: "short", year: "2-digit" }).replace(".", "");

const zohoTaskUrl = (task) => {
  if (!task.id) return null;
  return `https://projects.zoho.${ZOHO_DC}/portal/${ZOHO_PORTAL_NAME}#zp/task-detail/${task.id}`;
};

const addMonths = (date, n) => {
  const r = new Date(date);
  r.setMonth(r.getMonth() + n);
  return r;
};

const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

// Count Mon–Fri days in a calendar month
const workdaysInMonth = (year, month) => {
  const d = new Date(year, month, 1);
  let n = 0;
  while (d.getMonth() === month) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
};

// Advance to the next working day (Mon–Fri) after date
const nextWorkDay = (date) => {
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
};

// Schedule `hours` of work starting from startDate, using monthlyCap/workdaysInMonth hours per day.
// Returns the last working day when the work completes.
const scheduleWork = (startDate, hours, monthlyCap) => {
  if (hours <= 0 || monthlyCap <= 0) return new Date(startDate);
  const d = new Date(startDate);
  d.setHours(0, 0, 0, 0);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  let remaining = hours;
  let safety = 0;
  while (remaining > 0 && safety < 10000) {
    const dailyCap = monthlyCap / workdaysInMonth(d.getFullYear(), d.getMonth());
    remaining -= dailyCap;
    if (remaining > 0) {
      d.setDate(d.getDate() + 1);
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    }
    safety++;
  }
  return new Date(d);
};

// Working hours available for a programmer in a given calendar month
// considering (a) capacity per month, (b) potential partial month at start.
const monthlyHours = (programmer) => programmer.capacity || 0;

/**
 * Distribute a total of taskHours across calendar months starting at startDate,
 * given a monthly capacity. Returns array of {month: Date, hoursThisMonth, capacity, percent}.
 * The first month is prorated by the proportion of remaining working days in that month.
 */
const buildMonthlyPlan = (startDate, taskHours, capacity) => {
  const plan = [];
  let remaining = taskHours;
  let cursor = new Date(startDate);
  let safety = 0;
  while (remaining > 0 && safety < 60) {
    const monthEnd = endOfMonth(cursor);
    const totalDaysInMonth = monthEnd.getDate();
    const daysLeftInMonth = totalDaysInMonth - cursor.getDate() + 1;
    const proration = safety === 0 ? daysLeftInMonth / totalDaysInMonth : 1;
    const monthCap = capacity * proration;
    const hoursThis = Math.min(remaining, monthCap);
    plan.push({
      monthDate: new Date(cursor.getFullYear(), cursor.getMonth(), 1),
      hoursThisMonth: hoursThis,
      effectiveCapacity: monthCap,
      fullCapacity: capacity,
      percent: monthCap > 0 ? (hoursThis / monthCap) * 100 : 0,
    });
    remaining -= hoursThis;
    // jump to first day of next month
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    safety++;
  }
  return plan;
};

const planEndDate = (plan) => {
  if (plan.length === 0) return null;
  // approximate: ratio of last month's hours over its effective capacity tells us how far into the month
  const last = plan[plan.length - 1];
  const monthStart = last.monthDate;
  const monthEnd = endOfMonth(monthStart);
  const totalDays = monthEnd.getDate();
  const ratio = last.effectiveCapacity > 0 ? last.hoursThisMonth / last.fullCapacity : 0;
  const daysIn = Math.max(1, Math.ceil(ratio * totalDays));
  return new Date(monthStart.getFullYear(), monthStart.getMonth(), Math.min(totalDays, daysIn));
};

/* ────────────────────────────────────────────────────────── */
/*  STORAGE                                                   */
/* ────────────────────────────────────────────────────────── */

const PERMANENT_IDS = new Set(["ricardo", "eduardo", "joseph"]);

const loadData = async () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      // Migration: ensure original 3 programmers are marked permanent
      d.programmers = d.programmers.map((p) =>
        PERMANENT_IDS.has(p.id) ? { ...p, permanent: true } : p
      );
      return d;
    }
  } catch (e) {
    /* fallback to default */
  }
  return DEFAULT_DATA;
};

const saveData = async (data) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error("Storage save failed", e);
    return false;
  }
};

/* ────────────────────────────────────────────────────────── */
/*  ZOHO via local backend                                    */
/* ────────────────────────────────────────────────────────── */

/**
 * Fetch in-progress tasks for one programmer from the local Express
 * backend (server/index.js), which talks directly to Zoho Projects'
 * REST API using OAuth.
 *
 * The MCP path used inside Claude.ai artifacts does NOT work here:
 * the MCP server URL is part of Anthropic's hosted infrastructure and
 * is authenticated via Claude.ai's OAuth flows, not reusable from a
 * standalone web app.
 */
const fetchOpenTasksForProgrammer = async (email) => {
  const response = await fetch(
    `api/zoho-tasks?email=${encodeURIComponent(email)}`
  );
  if (!response.ok) {
    let msg = `Backend ${response.status}`;
    try {
      const t = await response.text();
      try {
        const j = JSON.parse(t);
        if (j.error) msg += `: ${j.error}`;
      } catch {
        if (t) msg += `: ${t.slice(0, 160)}`;
      }
    } catch {}
    throw new Error(msg);
  }
  return response.json(); // {tasks: [...]}
};

/* ────────────────────────────────────────────────────────── */
/*  UI primitives                                             */
/* ────────────────────────────────────────────────────────── */

const Card = ({ children, className = "" }) => (
  <div
    className={`rounded-2xl border bg-white shadow-sm ${className}`}
    style={{ borderColor: C.border }}
  >
    {children}
  </div>
);

const Button = ({ children, onClick, disabled, variant = "primary", className = "", type = "button" }) => {
  const styles =
    variant === "primary"
      ? { background: C.green, color: "white", border: `1px solid ${C.greenDark}` }
      : variant === "ghost"
      ? { background: "transparent", color: C.ink, border: `1px solid ${C.border}` }
      : { background: C.greenSoft, color: C.greenDark, border: `1px solid ${C.greenLine}` };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={styles}
      className={`px-4 py-2 rounded-lg font-medium text-sm transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${className}`}
    >
      {children}
    </button>
  );
};

const Pill = ({ children, color = C.green }) => (
  <span
    className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
    style={{ background: `${color}1A`, color }}
  >
    {children}
  </span>
);

/* ────────────────────────────────────────────────────────── */
/*  PARÁMETROS SCREEN                                         */
/* ────────────────────────────────────────────────────────── */

const ParametrosScreen = ({ data, setData }) => {
  const [savedAt, setSavedAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDraft, setNewDraft] = useState({ name: "", email: "", zoho_zpuid: "" });

  const updateProgrammer = (id, patch) => {
    setData({
      ...data,
      programmers: data.programmers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
  };

  const toggleSkill = (id, skillKey) => {
    const p = data.programmers.find((x) => x.id === id);
    updateProgrammer(id, { skills: { ...p.skills, [skillKey]: !p.skills[skillKey] } });
  };

  const startEdit = (p) => {
    setEditingId(p.id);
    setEditDraft({ name: p.name, email: p.email || "", zoho_zpuid: p.zoho_zpuid || "" });
  };

  const saveEdit = (id) => {
    if (!editDraft.name.trim()) return;
    updateProgrammer(id, {
      name: editDraft.name.trim(),
      email: editDraft.email.trim(),
      zoho_zpuid: editDraft.zoho_zpuid.trim(),
    });
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  const deleteProgrammer = (id) => {
    if (!confirm("¿Eliminar este programador?")) return;
    setData({ ...data, programmers: data.programmers.filter((p) => p.id !== id) });
  };

  const addProgrammer = () => {
    if (!newDraft.name.trim()) return;
    const newP = {
      id: `p_${Date.now()}`,
      name: newDraft.name.trim(),
      email: newDraft.email.trim(),
      zoho_zpuid: newDraft.zoho_zpuid.trim(),
      permanent: false,
      skills: Object.fromEntries(SKILLS.map((s) => [s.key, false])),
      capacity: 0,
    };
    setData({ ...data, programmers: [...data.programmers, newP] });
    setNewDraft({ name: "", email: "", zoho_zpuid: "" });
    setShowAddForm(false);
  };

  const handleSave = async () => {
    setSaving(true);
    const ok = await saveData(data);
    setSaving(false);
    if (ok) {
      setSavedAt(new Date());
      setTimeout(() => setSavedAt(null), 3000);
    }
  };

  const busFactor = (skillKey) =>
    data.programmers.filter((p) => p.skills[skillKey]).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight" style={{ color: C.ink }}>
            Parámetros
          </h2>
          <p className="text-sm mt-1" style={{ color: C.mute }}>
            Habilidades y capacidad mensual del equipo.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {savedAt && (
            <span className="flex items-center gap-1.5 text-sm" style={{ color: C.greenDark }}>
              <CheckCircle2 size={16} /> Guardado
            </span>
          )}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Guardar
          </Button>
        </div>
      </div>

      {/* HABILIDADES */}
      <Card>
        <div className="px-6 py-4 border-b flex items-center gap-3" style={{ borderColor: C.border }}>
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: C.greenSoft, color: C.greenDark }}
          >
            <Sparkles size={16} />
          </div>
          <div>
            <h3 className="font-semibold" style={{ color: C.ink }}>
              Habilidades
            </h3>
            <p className="text-xs" style={{ color: C.mute }}>
              Marca con qué tecnologías trabaja cada programador.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: C.bg }}>
                <th className="text-left px-6 py-3 font-medium" style={{ color: C.mute }}>
                  Empleado / Habilidad
                </th>
                {SKILLS.map((s) => (
                  <th key={s.key} className="px-3 py-3 font-medium text-center" style={{ color: C.mute }}>
                    <div>{s.label}</div>
                    {EXTERNAL_SKILLS.has(s.key) && (
                      <div className="text-[10px] font-normal italic" style={{ color: C.warn }}>
                        externalizado*
                      </div>
                    )}
                  </th>
                ))}
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.programmers.map((p) => (
                <tr key={p.id} className="border-t" style={{ borderColor: C.border }}>
                  {editingId === p.id ? (
                    <td className="px-4 py-2">
                      <div className="space-y-1.5">
                        <input
                          value={editDraft.name}
                          onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                          placeholder="Nombre"
                          className="w-full px-2 py-1 rounded border text-sm"
                          style={{ borderColor: C.border, color: C.ink }}
                        />
                        <input
                          value={editDraft.email}
                          onChange={(e) => setEditDraft({ ...editDraft, email: e.target.value })}
                          placeholder="Email"
                          className="w-full px-2 py-1 rounded border text-xs font-mono"
                          style={{ borderColor: C.border, color: C.ink }}
                        />
                        <input
                          value={editDraft.zoho_zpuid}
                          onChange={(e) => setEditDraft({ ...editDraft, zoho_zpuid: e.target.value })}
                          placeholder="zpuid"
                          className="w-full px-2 py-1 rounded border text-xs font-mono"
                          style={{ borderColor: C.border, color: C.ink }}
                        />
                      </div>
                    </td>
                  ) : (
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium" style={{ color: C.ink }}>{p.name}</span>
                        {!p.permanent && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: C.greenSoft, color: C.mute }}>
                            inmediato
                          </span>
                        )}
                      </div>
                      <div className="text-xs mt-0.5 font-mono" style={{ color: C.mute }}>
                        zpuid: {p.zoho_zpuid || "—"}
                      </div>
                    </td>
                  )}
                  {SKILLS.map((s) => (
                    <td key={s.key} className="px-3 py-3 text-center">
                      <button
                        onClick={() => toggleSkill(p.id, s.key)}
                        className="w-7 h-7 rounded-md transition-all hover:scale-105 flex items-center justify-center mx-auto"
                        style={{
                          background: p.skills[s.key] ? C.green : "transparent",
                          border: `1.5px solid ${p.skills[s.key] ? C.green : C.border}`,
                        }}
                      >
                        {p.skills[s.key] && <Check size={16} color="white" strokeWidth={3} />}
                      </button>
                    </td>
                  ))}
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      {editingId === p.id ? (
                        <>
                          <button
                            onClick={() => saveEdit(p.id)}
                            title="Confirmar"
                            className="w-7 h-7 rounded flex items-center justify-center"
                            style={{ background: C.green, color: "white" }}
                          >
                            <Check size={13} strokeWidth={3} />
                          </button>
                          <button
                            onClick={cancelEdit}
                            title="Cancelar"
                            className="w-7 h-7 rounded flex items-center justify-center"
                            style={{ background: C.bg, color: C.mute, border: `1px solid ${C.border}` }}
                          >
                            <X size={13} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(p)}
                            title="Editar"
                            className="w-7 h-7 rounded flex items-center justify-center"
                            style={{ background: C.bg, color: C.mute, border: `1px solid ${C.border}` }}
                          >
                            <Pencil size={13} />
                          </button>
                          {!p.permanent && (
                            <button
                              onClick={() => deleteProgrammer(p.id)}
                              title="Eliminar"
                              className="w-7 h-7 rounded flex items-center justify-center"
                              style={{ background: "#FEE2E2", color: C.danger, border: "1px solid #FECACA" }}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {showAddForm && (
                <tr className="border-t" style={{ borderColor: C.border, background: C.greenSoft }}>
                  <td className="px-4 py-2">
                    <div className="space-y-1.5">
                      <input
                        value={newDraft.name}
                        onChange={(e) => setNewDraft({ ...newDraft, name: e.target.value })}
                        placeholder="Nombre *"
                        className="w-full px-2 py-1 rounded border text-sm"
                        style={{ borderColor: C.greenLine, color: C.ink }}
                      />
                      <input
                        value={newDraft.email}
                        onChange={(e) => setNewDraft({ ...newDraft, email: e.target.value })}
                        placeholder="Email (opcional)"
                        className="w-full px-2 py-1 rounded border text-xs font-mono"
                        style={{ borderColor: C.greenLine, color: C.ink }}
                      />
                      <input
                        value={newDraft.zoho_zpuid}
                        onChange={(e) => setNewDraft({ ...newDraft, zoho_zpuid: e.target.value })}
                        placeholder="zpuid (opcional)"
                        className="w-full px-2 py-1 rounded border text-xs font-mono"
                        style={{ borderColor: C.greenLine, color: C.ink }}
                      />
                    </div>
                  </td>
                  {SKILLS.map((s) => (
                    <td key={s.key} className="px-3 py-3 text-center text-xs" style={{ color: C.mute }}>—</td>
                  ))}
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={addProgrammer}
                        title="Confirmar"
                        className="w-7 h-7 rounded flex items-center justify-center"
                        style={{ background: C.green, color: "white" }}
                      >
                        <Check size={13} strokeWidth={3} />
                      </button>
                      <button
                        onClick={() => { setShowAddForm(false); setNewDraft({ name: "", email: "", zoho_zpuid: "" }); }}
                        title="Cancelar"
                        className="w-7 h-7 rounded flex items-center justify-center"
                        style={{ background: C.bg, color: C.mute, border: `1px solid ${C.border}` }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              <tr style={{ background: C.bg }}>
                <td className="px-6 py-3 font-medium text-xs uppercase tracking-wide" style={{ color: C.mute }}>
                  Bus factor
                </td>
                {SKILLS.map((s) => {
                  const bf = busFactor(s.key);
                  const ext = EXTERNAL_SKILLS.has(s.key);
                  const color = bf === 0 ? C.danger : bf === 1 ? C.warn : C.greenDark;
                  return (
                    <td key={s.key} className="px-3 py-3 text-center font-mono font-semibold" style={{ color }}>
                      {bf}
                      {ext && "*"}
                    </td>
                  );
                })}
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        <div className="px-6 py-3 border-t flex items-center justify-between" style={{ borderColor: C.border }}>
          <span className="text-xs italic" style={{ color: C.mute }}>*Externalizado, sólo para mantenimiento – supervisión.</span>
          {!showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
              style={{ background: C.greenSoft, color: C.greenDark, border: `1px solid ${C.greenLine}` }}
            >
              <Plus size={13} /> Añadir programador
            </button>
          )}
        </div>
      </Card>

      {/* CAPACIDAD */}
      <Card>
        <div className="px-6 py-4 border-b flex items-center gap-3" style={{ borderColor: C.border }}>
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: C.greenSoft, color: C.greenDark }}
          >
            <Briefcase size={16} />
          </div>
          <div>
            <h3 className="font-semibold" style={{ color: C.ink }}>
              Capacidad mensual (horas)
            </h3>
            <p className="text-xs" style={{ color: C.mute }}>
              Horas dedicables al mes por programador y por categoría de proyecto.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: C.bg }}>
                <th className="text-left px-6 py-3 font-medium" style={{ color: C.mute }}>
                  Empleado / Horas mensuales
                </th>
                <th className="px-3 py-3 font-medium text-center" style={{ color: C.mute }}>
                  Horas disponibles / mes
                </th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.programmers.map((p) => (
                <tr key={p.id} className="border-t" style={{ borderColor: C.border }}>
                  <td className="px-6 py-3 font-medium" style={{ color: C.ink }}>
                    {p.name}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <input
                      type="number"
                      min="0"
                      value={p.capacity}
                      onChange={(e) =>
                        updateProgrammer(p.id, { capacity: Number(e.target.value) || 0 })
                      }
                      className="w-20 px-2 py-1.5 rounded-md border text-center font-mono"
                      style={{ borderColor: C.border, color: C.ink }}
                    />
                    <span className="ml-1.5 text-xs" style={{ color: C.mute }}>
                      h
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    {!p.permanent && (
                      <button
                        onClick={() => deleteProgrammer(p.id)}
                        title="Eliminar"
                        className="w-7 h-7 rounded flex items-center justify-center mx-auto"
                        style={{ background: "#FEE2E2", color: C.danger, border: "1px solid #FECACA" }}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>


    </div>
  );
};

/* ────────────────────────────────────────────────────────── */
/*  CALCULADORA SCREEN                                        */
/* ────────────────────────────────────────────────────────── */

const CalculadoraScreen = ({ data }) => {
const [skillRows, setSkillRows] = useState([{ skill: "net45", hours: 8 }]);
  const [calculating, setCalculating] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [results, setResults] = useState(null); // {byProgrammer: {...}, today: Date}

  const totalHours = useMemo(
    () => skillRows.reduce((s, r) => s + (Number(r.hours) || 0), 0),
    [skillRows]
  );

  const requiredSkills = useMemo(
    () => Array.from(new Set(skillRows.map((r) => r.skill).filter(Boolean))),
    [skillRows]
  );

  const eligibleProgrammers = useMemo(
    () => data.programmers.filter((p) => requiredSkills.every((sk) => p.skills[sk])),
    [data.programmers, requiredSkills]
  );

  const usesExternalSkill = requiredSkills.some((sk) => EXTERNAL_SKILLS.has(sk));

  const addSkillRow = () => setSkillRows([...skillRows, { skill: "net45", hours: 0 }]);
  const removeSkillRow = (i) => setSkillRows(skillRows.filter((_, j) => j !== i));
  const updateSkillRow = (i, patch) =>
    setSkillRows(skillRows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const handleCalculate = async () => {
    setErrorMsg("");
    setResults(null);

    if (eligibleProgrammers.length === 0) {
      setErrorMsg(
        "Ningún programador del equipo tiene todas las habilidades requeridas. Revisa la matriz en Parámetros."
      );
      return;
    }
    if (totalHours <= 0) {
      setErrorMsg("Indica al menos una habilidad con horas estimadas mayores que cero.");
      return;
    }

    setCalculating(true);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const byProgrammer = {};

    try {
      // Permanent programmers get queried in Zoho; others start immediately
      const zohoGroup = eligibleProgrammers.filter((p) => p.permanent === true);
      const immediateGroup = eligibleProgrammers.filter((p) => p.permanent !== true);

      const promises = zohoGroup.map(async (p) => {
        try {
          const r = await fetchOpenTasksForProgrammer(p.email);
          const tasks = (r.tasks || []).filter(
            (t) =>
              !EXCLUDED_PROJECTS.has((t.project || "").toLowerCase().trim()) &&
              ACTIVE_STATUSES.has((t.status || "").toLowerCase().trim()) &&
              taskPendingHours(t) > 0
          );
          return { programmer: p, tasks, error: null, immediate: false };
        } catch (e) {
          return { programmer: p, tasks: [], error: e.message, immediate: false };
        }
      });
      const fetched = await Promise.all(promises);
      const allResults = [
        ...fetched,
        ...immediateGroup.map((p) => ({ programmer: p, tasks: [], error: null, immediate: true })),
      ];

      for (const { programmer, tasks, error, immediate } of allResults) {
        const cap = monthlyHours(programmer);

        // Sum pending hours → schedule sequentially to find when programmer is free
        const totalPending = tasks.reduce((sum, t) => sum + taskPendingHours(t), 0);
        let latestEnd = null;
        let startDate = new Date(today);
        if (!immediate && totalPending > 0 && cap > 0) {
          latestEnd = scheduleWork(today, totalPending, cap);
          startDate = nextWorkDay(latestEnd);
        }

        // End date for the new task: schedule it starting from startDate
        const endDate = cap > 0 && totalHours > 0 ? scheduleWork(startDate, totalHours, cap) : null;

        // Monthly plan kept for the bar chart only (visual breakdown)
        const plan = cap > 0 ? buildMonthlyPlan(startDate, totalHours, cap) : [];

        byProgrammer[programmer.id] = {
          programmer,
          tasks,
          error,
          immediate,
          monthlyCap: cap,
          startDate,
          latestEnd,
          plan,
          endDate,
          openTaskCount: tasks.length,
        };
      }

      setResults({ byProgrammer, today, totalHours });
    } catch (e) {
      setErrorMsg("Error al consultar Zoho Projects: " + e.message);
    } finally {
      setCalculating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight" style={{ color: C.ink }}>
          Calculadora de plazos
        </h2>
        <p className="text-sm mt-1" style={{ color: C.mute }}>
          Estima fecha de inicio, programadores asignables y plazo de entrega para una nueva tarea.
        </p>

      </div>

      {/* INPUT FORM */}
      <Card>
        <div className="px-6 py-4 border-b" style={{ borderColor: C.border }}>
          <h3 className="font-semibold" style={{ color: C.ink }}>
            Nueva tarea
          </h3>
        </div>
        <div className="p-6 space-y-5">

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-medium uppercase tracking-wide" style={{ color: C.mute }}>
                Habilidades requeridas y horas estimadas
              </label>
              <span className="text-xs font-mono" style={{ color: C.greenDark }}>
                Total: {totalHours} h
              </span>
            </div>
            <div className="space-y-2">
              {skillRows.map((row, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <select
                    value={row.skill}
                    onChange={(e) => updateSkillRow(i, { skill: e.target.value })}
                    className="flex-1 px-3 py-2 rounded-lg border text-sm bg-white"
                    style={{ borderColor: C.border, color: C.ink }}
                  >
                    {SKILLS.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                        {EXTERNAL_SKILLS.has(s.key) ? " (externalizado)" : ""}
                      </option>
                    ))}
                  </select>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      value={row.hours}
                      onChange={(e) => updateSkillRow(i, { hours: Number(e.target.value) || 0 })}
                      className="w-24 px-3 py-2 rounded-lg border text-sm font-mono text-right pr-8"
                      style={{ borderColor: C.border, color: C.ink }}
                    />
                    <span
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs"
                      style={{ color: C.mute }}
                    >
                      h
                    </span>
                  </div>
                  <button
                    onClick={() => removeSkillRow(i)}
                    disabled={skillRows.length === 1}
                    className="w-9 h-9 rounded-lg flex items-center justify-center disabled:opacity-30"
                    style={{ color: C.mute, background: C.bg, border: `1px solid ${C.border}` }}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={addSkillRow}
              className="mt-2 flex items-center gap-1.5 text-xs font-medium"
              style={{ color: C.greenDark }}
            >
              <Plus size={14} /> Añadir habilidad
            </button>
          </div>

          {usesExternalSkill && (
            <div
              className="flex gap-2 px-3 py-2 rounded-lg text-xs"
              style={{ background: "#FEF3C7", color: "#92400E" }}
            >
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>
                Esta tarea requiere una habilidad externalizada. El equipo interno solo puede
                supervisar/mantener; la ejecución probablemente requiera proveedor externo.
              </span>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <div className="text-xs" style={{ color: C.mute }}>
              Programadores con todas las habilidades:{" "}
              <span className="font-semibold" style={{ color: C.greenDark }}>
                {eligibleProgrammers.length} / {data.programmers.length}
              </span>
            </div>
            <Button onClick={handleCalculate} disabled={calculating}>
              {calculating ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Consultando Zoho…
                </>
              ) : (
                <>
                  <Calculator size={16} />
                  Calcular plazo
                </>
              )}
            </Button>
          </div>

          {errorMsg && (
            <div
              className="flex gap-2 px-3 py-2 rounded-lg text-sm"
              style={{ background: "#FEE2E2", color: "#991B1B" }}
            >
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>
      </Card>

      {/* RESULTS */}
      {results && <ResultsView results={results} />}
    </div>
  );
};

/* ────────────────────────────────────────────────────────── */
/*  RESULTS VIEW                                              */
/* ────────────────────────────────────────────────────────── */

const ResultsView = ({ results }) => {
  const { byProgrammer, totalHours } = results;
  const list = Object.values(byProgrammer);
  const [selectedResult, setSelectedResult] = useState(null);

  // Determine the "best" candidate: earliest endDate
  const sorted = [...list].sort((a, b) => {
    if (!a.endDate) return 1;
    if (!b.endDate) return -1;
    return a.endDate - b.endDate;
  });
  const best = sorted[0];

  const earliestStart = list.reduce((min, r) => {
    if (!r.startDate) return min;
    return !min || r.startDate < min ? r.startDate : min;
  }, null);

  const handleClose = useCallback(() => setSelectedResult(null), []);

  return (
    <div className="space-y-5">

      {/* Per-programmer cards */}
      <div className="text-xs mb-1" style={{ color: C.mute }}>
        Pulsa una tarjeta para ver las tareas activas del programador.
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {sorted.map((r) => (
          <ProgrammerCard
            key={r.programmer.id}
            result={r}
            isBest={r === best}
            onClick={() => setSelectedResult(r)}
          />
        ))}
      </div>

      {selectedResult && (
        <TaskDetailModal result={selectedResult} onClose={handleClose} />
      )}
    </div>
  );
};

const Metric = ({ label, value, highlight = false }) => (
  <div>
    <div className="text-[11px] uppercase tracking-wide font-medium" style={{ color: C.mute }}>
      {label}
    </div>
    <div
      className={`mt-0.5 ${highlight ? "text-2xl font-bold" : "text-base font-semibold"}`}
      style={{ color: highlight ? C.greenDark : C.ink }}
    >
      {value}
    </div>
  </div>
);

const ProgrammerCard = ({ result, isBest, onClick }) => {
  const { programmer, plan, startDate, latestEnd, endDate, monthlyCap, openTaskCount, error, immediate } = result;

  const chartData = plan.map((p, i) => ({
    name: fmtMonth(p.monthDate),
    Carga: Math.round(p.percent),
    Tope: 100,
    Hours: Math.round(p.hoursThisMonth * 10) / 10,
    Cap: Math.round(p.fullCapacity * 10) / 10,
    EffectiveCap: Math.round(p.effectiveCapacity * 10) / 10,
  }));

  return (
    <Card className={isBest ? "ring-2" : ""} >
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
        className="px-5 py-4 border-b flex items-start justify-between gap-3 cursor-pointer transition-colors hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-1"
        style={{
          borderColor: C.border,
          background: isBest ? C.greenSoft : "transparent",
          focusRingColor: C.green,
        }}
        title="Ver tareas activas"
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center font-semibold"
            style={{ background: C.green, color: "white" }}
          >
            {programmer.name
              .split(" ")
              .slice(0, 2)
              .map((s) => s[0])
              .join("")}
          </div>
          <div>
            <div className="font-semibold flex items-center gap-2" style={{ color: C.ink }}>
              {programmer.name}
              {isBest && <Pill color={C.greenDark}>recomendado</Pill>}
            </div>
            <div className="text-xs font-mono" style={{ color: C.mute }}>
              zpuid {programmer.zoho_zpuid}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide" style={{ color: C.mute }}>
              Capacidad/mes
            </div>
            <div className="text-lg font-bold" style={{ color: C.greenDark }}>
              {monthlyCap} h
            </div>
          </div>
          <div className="flex items-center gap-1 text-[11px]" style={{ color: C.mute }}>
            <ListTodo size={12} />
            <span>ver tareas</span>
          </div>
        </div>
      </div>

      <div className="p-5">
        {error && (
          <div
            className="flex gap-2 px-3 py-2 rounded-lg text-xs mb-3"
            style={{ background: "#FEF3C7", color: "#92400E" }}
          >
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>No se pudieron cargar las tareas en curso de Zoho ({error}). Estimación basada en disponibilidad inmediata.</span>
          </div>
        )}
        {immediate && (
          <div
            className="flex gap-2 px-3 py-2 rounded-lg text-xs mb-3"
            style={{ background: C.greenSoft, color: C.greenDark }}
          >
            <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
            <span>Disponibilidad inmediata — no se consultan tareas en Zoho.</span>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 mb-4">
          <SmallStat
            label={immediate ? "Disponibilidad" : "Tareas en curso"}
            value={immediate ? "Inmediata" : openTaskCount}
            sub={immediate ? "arranca hoy" : openTaskCount === 0 ? "libre ahora" : "en Zoho"}
          />
          <SmallStat
            label="Disponible desde"
            value={latestEnd ? fmtDate(latestEnd) : fmtDate(startDate)}
          />
          <SmallStat
            label="Entrega estimada"
            value={endDate ? fmtDate(endDate) : "—"}
            highlight
          />
        </div>

        {chartData.length > 0 && (
          <>
            <div className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: C.mute }}>
              Carga mensual de la nueva tarea
            </div>
            <div style={{ height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: C.mute }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: C.mute }}
                    axisLine={false}
                    tickLine={false}
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    cursor={{ fill: C.greenSoft, opacity: 0.4 }}
                    contentStyle={{
                      borderRadius: 8,
                      border: `1px solid ${C.border}`,
                      fontSize: 12,
                    }}
                    formatter={(value, name, props) => {
                      if (name === "Carga") {
                        return [
                          `${value}% (${props.payload.Hours}h / ${props.payload.EffectiveCap}h disp.)`,
                          "Carga",
                        ];
                      }
                      return [value, name];
                    }}
                  />
                  <ReferenceLine y={100} stroke={C.danger} strokeDasharray="3 3" />
                  <Bar dataKey="Carga" radius={[6, 6, 0, 0]}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={d.Carga > 90 ? C.warn : C.green} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="text-[11px] mt-1" style={{ color: C.mute }}>
              Porcentaje de la capacidad mensual del programador consumido por la nueva tarea
              durante los meses que dura.
            </div>
          </>
        )}
      </div>
    </Card>
  );
};

/* ── Task detail modal ─────────────────────────────────── */

const TaskTable = ({ tasks }) => {
  if (!tasks.length) return (
    <div className="text-sm text-center py-8" style={{ color: C.mute }}>
      Sin tareas activas registradas en Zoho.
    </div>
  );
  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr style={{ color: C.mute }}>
          <th className="text-left pb-2 pr-3 font-medium text-xs uppercase tracking-wide">Tarea</th>
          <th className="text-left pb-2 pr-3 font-medium text-xs uppercase tracking-wide">Proyecto</th>
          <th className="text-left pb-2 pr-3 font-medium text-xs uppercase tracking-wide">Estado</th>
          <th className="text-right pb-2 pr-3 font-medium text-xs uppercase tracking-wide">Horas</th>
          <th className="text-right pb-2 pr-3 font-medium text-xs uppercase tracking-wide">% Hecho</th>
          <th className="text-right pb-2 pr-3 font-medium text-xs uppercase tracking-wide">H. Pendientes</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t, i) => {
          const url = zohoTaskUrl(t);
          const rowProps = url
            ? {
                onClick: () => window.open(url, "_blank", "noopener,noreferrer"),
                style: { borderColor: C.border, cursor: "pointer" },
                className: "border-t hover:bg-gray-50 transition-colors group",
                title: "Abrir en Zoho Projects",
              }
            : {
                style: { borderColor: C.border },
                className: "border-t",
              };
          return (
            <tr key={i} {...rowProps}>
              <td className="py-2 pr-3">
                <span
                  className={url ? "group-hover:underline" : ""}
                  style={{ color: url ? C.greenDark : C.ink, lineHeight: 1.4 }}
                >
                  {t.name}
                </span>
                {url && (
                  <ExternalLink size={11} className="inline ml-1 opacity-0 group-hover:opacity-60 transition-opacity align-middle" style={{ color: C.greenDark }} />
                )}
              </td>
              <td className="py-2 pr-3 text-xs whitespace-nowrap" style={{ color: C.mute }}>{t.project || "—"}</td>
              <td className="py-2 pr-3">
                {t.status ? (
                  <span
                    className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap"
                    style={{
                      background: t.status.toLowerCase() === "en curso" ? "#dbeafe" : "#fef9c3",
                      color:      t.status.toLowerCase() === "en curso" ? "#1d4ed8" : "#854d0e",
                    }}
                  >
                    {t.status}
                  </span>
                ) : "—"}
              </td>
              <td className="py-2 pr-3 text-right font-mono text-xs" style={{ color: C.mute }}>{t.total_work || "—"}</td>
              <td className="py-2 pr-3 text-right font-mono text-xs" style={{ color: C.mute }}>
                {(t.completion_percentage ?? null) !== null ? `${t.completion_percentage}%` : "—"}
              </td>
              <td className="py-2 pr-3 text-right font-mono text-xs font-semibold" style={{ color: C.ink }}>
                {hoursToHHMM(taskPendingHours(t))}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

const PRIORITY_RANK = { high: 0, medium: 1, normal: 2, low: 3, none: 4 };
const sortTasks = (tasks) =>
  [...tasks].sort((a, b) => {
    const pa = PRIORITY_RANK[(a.priority || "none").toLowerCase()] ?? 4;
    const pb = PRIORITY_RANK[(b.priority || "none").toLowerCase()] ?? 4;
    if (pa !== pb) return pa - pb;
    return taskPendingHours(b) - taskPendingHours(a);
  });

// Parse "HH:MM" → decimal hours (e.g. "16:30" → 16.5)
const parseWorkHours = (totalWork) => {
  if (!totalWork) return 0;
  const [h, m] = String(totalWork).split(":").map(Number);
  return (h || 0) + (m || 0) / 60;
};

// Decimal hours → "HH:MM" string
const hoursToHHMM = (h) => {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
};

// Pending hours for a task = total_work * (1 - completion_percentage/100)
const taskPendingHours = (t) => {
  const total = parseWorkHours(t.total_work);
  const pct = Number(t.completion_percentage) || 0;
  return Math.max(0, total * (1 - pct / 100));
};

// Add N working days to a date, skipping weekends (Mon–Fri only)
const addWorkDays = (date, days) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // Advance past any initial weekend
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  let n = Math.max(0, days);
  while (n > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) n--;
  }
  return d;
};

const TaskGantt = ({ tasks, monthlyCap }) => {
  if (!tasks.length) return (
    <div className="text-sm text-center py-8" style={{ color: C.mute }}>
      Sin tareas activas para mostrar en el Gantt.
    </div>
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Build sequential schedule using monthlyCap/workdaysInMonth hours per day
  const cap = monthlyCap || 1;
  let cursor = new Date(today);
  while (cursor.getDay() === 0 || cursor.getDay() === 6) cursor.setDate(cursor.getDate() + 1);
  const scheduled = tasks.map((t) => {
    const start = new Date(cursor);
    const end = scheduleWork(cursor, Math.max(0.01, taskPendingHours(t)), cap);
    cursor = nextWorkDay(end);
    return { task: t, start, end };
  });

  const rangeStart = new Date(today);
  const rangeEnd = scheduled.length
    ? new Date(scheduled[scheduled.length - 1].end)
    : new Date(today.getTime() + 7 * 86_400_000);
  rangeStart.setDate(rangeStart.getDate() - 1);
  rangeEnd.setDate(rangeEnd.getDate() + 2);
  const rangeMs = Math.max(rangeEnd.getTime() - rangeStart.getTime(), 1);
  const toPct = (date) =>
    Math.max(0, Math.min(100, ((date.getTime() - rangeStart.getTime()) / rangeMs) * 100));

  // Month labels
  const months = [];
  const cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  while (cur <= rangeEnd) {
    months.push(new Date(cur));
    cur.setMonth(cur.getMonth() + 1);
  }

  // Project → color map
  const palette = [C.green, "#60A5FA", "#A78BFA", C.warn, "#F87171", "#34D399", "#FB923C"];
  const projectColors = {};
  let ci = 0;
  const colorFor = (proj) => {
    if (!projectColors[proj]) projectColors[proj] = palette[ci++ % palette.length];
    return projectColors[proj];
  };
  tasks.forEach((t) => colorFor(t.project || ""));

  const todayPct = toPct(today);
  const LABEL_W = 168;

  return (
    <div>
      {/* Month header */}
      <div className="relative mb-1" style={{ marginLeft: LABEL_W, height: 18 }}>
        {months.map((m, i) => {
          const left = toPct(m);
          return (
            <div
              key={i}
              className="absolute text-[10px] select-none"
              style={{ left: `${left}%`, color: C.mute, transform: "translateX(-50%)", whiteSpace: "nowrap" }}
            >
              {fmtMonth(m)}
            </div>
          );
        })}
      </div>

      {/* Rows */}
      <div className="space-y-1.5">
        {scheduled.map(({ task: t, start, end }, i) => {
          const leftPct = toPct(start);
          const rightPct = toPct(end);
          const widthPct = Math.max(0.8, rightPct - leftPct);
          const color = colorFor(t.project || "");
          const url = zohoTaskUrl(t);
          const endLabel = `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,"0")}-${String(end.getDate()).padStart(2,"0")}`;
          const pendingH = taskPendingHours(t);
          return (
            <div key={i} className="flex items-center gap-2">
              {/* Label */}
              <div
                className="flex-shrink-0 text-xs text-right"
                style={{ width: LABEL_W, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={t.name}
              >
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer"
                     className="hover:underline" style={{ color: C.greenDark }}>
                    {t.name}
                  </a>
                ) : t.name}
              </div>
              {/* Bar track */}
              <div className="flex-1 relative rounded" style={{ height: 26, background: C.bg }}>
                {/* Month grid lines */}
                {months.map((m, mi) => (
                  <div key={mi} className="absolute top-0 bottom-0" style={{
                    left: `${toPct(m)}%`, width: 1, background: C.border,
                  }} />
                ))}
                {/* Today line */}
                <div className="absolute top-0 bottom-0" style={{
                  left: `${todayPct}%`, width: 2, background: C.danger,
                  opacity: 0.5, borderRadius: 1,
                }} />
                {/* Task bar */}
                <div
                  className="absolute top-1 bottom-1 rounded flex items-center px-1.5"
                  style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: color, opacity: 0.88 }}
                  title={`${t.name}: ${t.start_date || "hoy"} → ${endLabel} (pendiente: ${hoursToHHMM(pendingH)})`}
                >
                  {widthPct > 6 && (
                    <span className="text-[10px] font-medium text-white truncate leading-none">
                      {hoursToHHMM(pendingH)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 pt-3" style={{ borderTop: `1px solid ${C.border}` }}>
        {Object.entries(projectColors).map(([proj, color]) => (
          <div key={proj} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ background: color }} />
            <span className="text-xs" style={{ color: C.mute }}>{proj || "Sin proyecto"}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ background: C.danger, opacity: 0.5 }} />
          <span className="text-xs" style={{ color: C.mute }}>Hoy</span>
        </div>
      </div>
    </div>
  );
};

const TaskDetailModal = ({ result, onClose }) => {
  const [tab, setTab] = useState("tabla");
  const { programmer, tasks: rawTasks, error, immediate, monthlyCap } = result;
  const tasks = sortTasks(rawTasks);

  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const initials = programmer.name
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0])
    .join("");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl flex flex-col"
        style={{ width: "95vw", maxWidth: 1000, maxHeight: "90vh", border: `1px solid ${C.border}` }}
      >
        {/* Header */}
        <div
          className="px-6 py-4 flex items-center justify-between gap-3 flex-shrink-0"
          style={{ borderBottom: `1px solid ${C.border}` }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center font-semibold text-white text-sm flex-shrink-0"
              style={{ background: C.green }}
            >
              {initials}
            </div>
            <div>
              <div className="font-semibold" style={{ color: C.ink }}>{programmer.name}</div>
              <div className="text-xs" style={{ color: C.mute }}>
                {immediate
                  ? "Disponibilidad inmediata — sin tareas en Zoho"
                  : error
                  ? "No se pudieron cargar las tareas de Zoho"
                  : (() => {
                      const totalPending = tasks.reduce((s, t) => s + taskPendingHours(t), 0);
                      return `${tasks.length} tarea${tasks.length !== 1 ? "s" : ""} · ${hoursToHHMM(totalPending)} h pendientes`;
                    })()}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 flex-shrink-0 transition-colors"
            title="Cerrar (Esc)"
          >
            <X size={18} style={{ color: C.mute }} />
          </button>
        </div>

        {/* Tabs */}
        <div
          className="px-6 flex gap-5 flex-shrink-0"
          style={{ borderBottom: `1px solid ${C.border}` }}
        >
          {[
            { key: "tabla", label: "Tabla" },
            { key: "gantt", label: "Gantt" },
          ].map(({ key, label }) => (
            <button
              key={key}
              className="py-3 text-sm font-medium border-b-2 transition-colors"
              style={{
                color: tab === key ? C.greenDark : C.mute,
                borderColor: tab === key ? C.greenDark : "transparent",
                marginBottom: -1,
              }}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {error && (
            <div
              className="flex gap-2 px-3 py-2 rounded-lg text-xs mb-4"
              style={{ background: "#FEF3C7", color: "#92400E" }}
            >
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>No se pudieron cargar las tareas de Zoho: {error}. Los datos pueden estar incompletos.</span>
            </div>
          )}
          {tab === "tabla" ? <TaskTable tasks={tasks} /> : <TaskGantt tasks={tasks} monthlyCap={monthlyCap} />}
        </div>
      </div>
    </div>
  );
};

/* ──────────────────────────────────────────────────────── */

const SmallStat = ({ label, value, sub, highlight = false }) => (
  <div
    className="rounded-lg px-3 py-2"
    style={{ background: highlight ? C.greenSoft : C.bg }}
  >
    <div className="text-[10px] uppercase tracking-wide font-medium" style={{ color: C.mute }}>
      {label}
    </div>
    <div
      className="text-sm font-semibold mt-0.5"
      style={{ color: highlight ? C.greenDark : C.ink }}
    >
      {value}
    </div>
    {sub && (
      <div className="text-[10px] mt-0.5" style={{ color: C.mute }}>
        {sub}
      </div>
    )}
  </div>
);

/* ────────────────────────────────────────────────────────── */
/*  ROOT APP                                                  */
/* ────────────────────────────────────────────────────────── */

export default function App() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("calc"); // params | calc

  useEffect(() => {
    loadData().then(setData);
  }, []);

  const handleReset = async () => {
    if (!confirm("¿Restaurar valores iniciales del fichero original? Se sobrescribirán los actuales.")) return;
    setData(DEFAULT_DATA);
    await saveData(DEFAULT_DATA);
  };

  if (!data) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: C.bg, color: C.mute }}
      >
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: C.bg, color: C.ink }}>
      {/* Header */}
      <header
        className="border-b sticky top-0 z-10 backdrop-blur"
        style={{ borderColor: C.border, background: "rgba(250,251,248,0.85)" }}
      >
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-white"
              style={{
                background: `linear-gradient(135deg, ${C.green} 0%, ${C.greenDark} 100%)`,
              }}
            >
              CP
            </div>
            <div>
              <div className="font-semibold leading-tight" style={{ color: C.ink }}>
                Gestión de capacidad
              </div>
              <div className="text-xs" style={{ color: C.mute }}>
                Desarrollo CheckingPlan
              </div>
            </div>
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-6xl mx-auto px-6 flex gap-1">
          {[
            { id: "params", label: "Parámetros", icon: Settings },
            { id: "calc", label: "Calculadora de plazos", icon: Calculator },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="px-4 py-2.5 text-sm font-medium flex items-center gap-2 transition-colors -mb-px"
                style={{
                  color: active ? C.greenDark : C.mute,
                  borderBottom: `2px solid ${active ? C.green : "transparent"}`,
                }}
              >
                <Icon size={15} />
                {t.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Body */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {tab === "params" && <ParametrosScreen data={data} setData={setData} />}
        {tab === "calc" && <CalculadoraScreen data={data} />}
      </main>

    </div>
  );
}
