import { useState, useEffect, useMemo } from "react";
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
      capacity_ckp: 59,
      capacity_otros: 43,
    },
    {
      id: "eduardo",
      name: "Eduardo Peña",
      zoho_zpuid: "5125000004207087",
      email: "eduardo.pena@cuatroochenta.com",
      permanent: true,
      skills: { sql: true, net45: true, android: true, reactjs: false, reactnative: false, flutter: false },
      capacity_ckp: 22,
      capacity_otros: 44,
    },
    {
      id: "joseph",
      name: "Joseph Rafael Montenegro",
      zoho_zpuid: "5125000023057263",
      email: "rafael.montenegro@cuatroochenta.com",
      permanent: true,
      skills: { sql: false, net45: true, android: true, reactjs: false, reactnative: false, flutter: false },
      capacity_ckp: 75,
      capacity_otros: 75,
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

const addMonths = (date, n) => {
  const r = new Date(date);
  r.setMonth(r.getMonth() + n);
  return r;
};

const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

// Working hours available for a programmer in a given calendar month
// considering (a) capacity per month, (b) potential partial month at start.
const monthlyHours = (programmer, isCkp) =>
  isCkp ? programmer.capacity_ckp : programmer.capacity_otros;

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
      capacity_ckp: 0,
      capacity_otros: 0,
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
            Habilidades y capacidad mensual del equipo. Editable y persistente.
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
                  Proyecto 'CHECKINGPLAN PRODUCTO'
                </th>
                <th className="px-3 py-3 font-medium text-center" style={{ color: C.mute }}>
                  Resto de proyectos
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
                      value={p.capacity_ckp}
                      onChange={(e) =>
                        updateProgrammer(p.id, { capacity_ckp: Number(e.target.value) || 0 })
                      }
                      className="w-20 px-2 py-1.5 rounded-md border text-center font-mono"
                      style={{ borderColor: C.border, color: C.ink }}
                    />
                    <span className="ml-1.5 text-xs" style={{ color: C.mute }}>
                      h
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <input
                      type="number"
                      min="0"
                      value={p.capacity_otros}
                      onChange={(e) =>
                        updateProgrammer(p.id, { capacity_otros: Number(e.target.value) || 0 })
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

      <div className="text-xs flex items-center gap-2" style={{ color: C.mute }}>
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: C.green }}
        ></span>
        Los datos se guardan en almacenamiento persistente local del navegador, en un único JSON.
      </div>
    </div>
  );
};

/* ────────────────────────────────────────────────────────── */
/*  CALCULADORA SCREEN                                        */
/* ────────────────────────────────────────────────────────── */

const CalculadoraScreen = ({ data }) => {
  const [taskName, setTaskName] = useState("");
  const [isCkp, setIsCkp] = useState(false); // CheckingPlan Producto checkbox, default unchecked
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
          return { programmer: p, tasks: r.tasks || [], error: null, immediate: false };
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
        const cap = monthlyHours(programmer, isCkp);

        // Find latest end_date among in-progress tasks (= when programmer frees up)
        let latestEnd = null;
        for (const t of tasks) {
          if (!t.end_date) continue;
          const d = new Date(t.end_date);
          if (isNaN(d.getTime())) continue;
          if (!latestEnd || d > latestEnd) latestEnd = d;
        }

        // Immediate programmers always start today; others wait for their last task to end
        let startDate = today;
        if (!immediate && latestEnd && latestEnd >= today) {
          startDate = new Date(latestEnd);
          startDate.setDate(startDate.getDate() + 1);
        }

        const plan = cap > 0 ? buildMonthlyPlan(startDate, totalHours, cap) : [];
        const endDate = planEndDate(plan);

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

      setResults({ byProgrammer, today, totalHours, isCkp, taskName });
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
        <div className="mt-3 flex gap-2 px-3 py-2 rounded-lg text-xs w-fit" style={{ background: C.greenSoft, color: C.mute }}>
          <AlertCircle size={13} className="flex-shrink-0 mt-0.5" style={{ color: C.greenDark }} />
          <span>
            La ocupación de cada programador se calcula a partir de sus tareas en Zoho Projects con estado{" "}
            <strong style={{ color: C.ink }}>Pendiente</strong> o{" "}
            <strong style={{ color: C.ink }}>En curso</strong>.
            La fecha de inicio estimada es el día siguiente a la tarea con la fecha de fin más tardía.
          </span>
        </div>
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
            <label className="block text-xs font-medium uppercase tracking-wide mb-1.5" style={{ color: C.mute }}>
              Nombre de la tarea
            </label>
            <input
              type="text"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder="Ej. Mejora informe de cuadrante mensual"
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{ borderColor: C.border, color: C.ink }}
            />
          </div>

          <div>
            <label
              className="flex items-start gap-3 px-4 py-3 rounded-lg cursor-pointer transition-all select-none"
              style={{
                background: isCkp ? C.greenSoft : C.bg,
                border: `1.5px solid ${isCkp ? C.green : C.border}`,
              }}
            >
              <input
                type="checkbox"
                checked={isCkp}
                onChange={(e) => setIsCkp(e.target.checked)}
                className="sr-only"
              />
              <span
                className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 transition-all"
                style={{
                  background: isCkp ? C.green : "white",
                  border: `1.5px solid ${isCkp ? C.green : C.border}`,
                }}
              >
                {isCkp && <Check size={14} color="white" strokeWidth={3} />}
              </span>
              <span>
                <span className="block text-sm font-medium" style={{ color: C.ink }}>
                  CheckingPlan Producto
                </span>
                <span className="block text-xs mt-0.5" style={{ color: C.mute }}>
                  Si está marcado se usa la capacidad mensual del proyecto{" "}
                  <span className="font-mono">CHECKINGPLAN PRODUCTO</span>; en otro caso, la del{" "}
                  <span className="font-mono">resto de proyectos</span>.
                </span>
              </span>
            </label>
          </div>

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
  const { byProgrammer, totalHours, isCkp, taskName } = results;
  const list = Object.values(byProgrammer);

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

  return (
    <div className="space-y-5">
      {/* Summary banner */}
      <Card>
        <div
          className="px-6 py-5 rounded-2xl"
          style={{
            background: `linear-gradient(135deg, ${C.greenSoft} 0%, #FFFFFF 100%)`,
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <Pill color={C.greenDark}>Estimación</Pill>
            {taskName && <span className="text-sm font-medium" style={{ color: C.ink }}>{taskName}</span>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-3">
            <Metric label="Carga total" value={`${totalHours} h`} />
            <Metric label="Tipo proyecto" value={isCkp ? "CKP Producto" : "Resto"} />
            <Metric
              label="Inicio más temprano"
              value={earliestStart ? fmtDate(earliestStart) : "—"}
            />
            <Metric
              label="Mejor entrega estimada"
              value={best && best.endDate ? fmtDate(best.endDate) : "—"}
              highlight
            />
          </div>
        </div>
      </Card>

      {/* Per-programmer cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {sorted.map((r) => (
          <ProgrammerCard key={r.programmer.id} result={r} isBest={r === best} />
        ))}
      </div>
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

const ProgrammerCard = ({ result, isBest }) => {
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
        className="px-5 py-4 border-b flex items-start justify-between gap-3"
        style={{
          borderColor: C.border,
          background: isBest ? C.greenSoft : "transparent",
        }}
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
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide" style={{ color: C.mute }}>
            Capacidad/mes
          </div>
          <div className="text-lg font-bold" style={{ color: C.greenDark }}>
            {monthlyCap} h
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
            value={fmtDate(startDate)}
            sub={latestEnd ? `tras ${fmtDate(latestEnd)}` : "ahora"}
          />
          <SmallStat
            label="Entrega estimada"
            value={endDate ? fmtDate(endDate) : "—"}
            sub={`${plan.length} ${plan.length === 1 ? "mes" : "meses"}`}
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
          <button
            onClick={handleReset}
            className="text-xs flex items-center gap-1.5 hover:underline"
            style={{ color: C.mute }}
            title="Restaurar datos del fichero original"
          >
            <RefreshCw size={12} /> reset
          </button>
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

      <footer className="max-w-6xl mx-auto px-6 py-6 text-xs" style={{ color: C.mute }}>
        Conectado a Zoho Projects (portal{" "}
        <span className="font-mono">{ZOHO_PORTAL_ID}</span>) vía API REST a través del backend local.
      </footer>
    </div>
  );
}
