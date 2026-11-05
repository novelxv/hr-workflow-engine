/**
 * A synthetic directory for Arunika Life (fictional): about 270 people across a Jakarta
 * head office and four branches, with reporting lines, HRBP coverage and PKWT histories.
 */
import { addDays } from "../engine/calendar.js";

export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
    chance: (p: number) => next() < p,
    normal: () => Math.sqrt(-2 * Math.log(next() || 1e-9)) * Math.cos(2 * Math.PI * next()),
  };
}
export type Rng = ReturnType<typeof rng>;

export const DEPARTMENTS: [string, string][] = [
  ["EXE", "Board of Directors Office"],
  ["ACT", "Actuarial"],
  ["UW", "Underwriting"],
  ["CLM", "Claims"],
  ["POL", "Policy Administration"],
  ["CSV", "Customer Service"],
  ["ITD", "Information Technology"],
  ["GAF", "General Affairs"],
  ["BAN", "Bancassurance"],
  ["AGY", "Agency Development"],
  ["MKT", "Marketing & Product"],
  ["FIN", "Finance & Accounting"],
  ["INV", "Investment"],
  ["CMP", "Compliance & AML/CFT"],
  ["RSK", "Risk Management"],
  ["LGL", "Legal"],
  ["IAU", "Internal Audit"],
  ["HRD", "Human Capital"],
];

const LOCATIONS = ["Jakarta", "Surabaya", "Bandung", "Medan", "Makassar"] as const;
const BRANCH_WEIGHTS = [0.32, 0.2, 0.18, 0.16, 0.14];

// department, title, grade, count, spread (HO | EACH | BR), share hired on PKWT
const PLAN: [string, string, number, number, "HO" | "EACH" | "BR", number][] = [
  ["EXE", "President Director", 8, 1, "HO", 0],
  ["EXE", "Director", 8, 5, "HO", 0],
  ["ACT", "Head of Actuarial", 7, 1, "HO", 0],
  ["ACT", "Actuarial Analyst", 2, 5, "HO", 0],
  ["UW", "Head of Underwriting", 7, 1, "HO", 0],
  ["UW", "Underwriter", 2, 9, "HO", 0.3],
  ["CLM", "Head of Claims", 7, 1, "HO", 0],
  ["CLM", "Claims Supervisor", 3, 4, "EACH", 0],
  ["CLM", "Claims Analyst", 2, 14, "BR", 0.2],
  ["CLM", "Claims Administrator", 1, 10, "BR", 0.7],
  ["POL", "Policy Administration Manager", 5, 1, "HO", 0],
  ["POL", "Policy Administration Officer", 1, 18, "BR", 0.6],
  ["CSV", "Customer Experience Manager", 5, 1, "HO", 0],
  ["CSV", "Customer Service Supervisor", 3, 4, "EACH", 0],
  ["CSV", "Customer Service Officer", 1, 24, "BR", 0.7],
  ["ITD", "Head of Information Technology", 7, 1, "HO", 0],
  ["ITD", "Software Engineer", 3, 10, "HO", 0.1],
  ["ITD", "IT Support Officer", 1, 8, "BR", 0.5],
  ["GAF", "General Affairs Supervisor", 3, 1, "HO", 0],
  ["GAF", "General Affairs Officer", 1, 7, "BR", 0.6],
  ["BAN", "Head of Bancassurance", 7, 1, "HO", 0],
  ["BAN", "Bancassurance Relationship Manager", 4, 8, "BR", 0],
  ["BAN", "Bancassurance Sales Specialist", 2, 30, "BR", 0.7],
  ["AGY", "Agency Development Manager", 5, 4, "EACH", 0],
  ["AGY", "Agency Support Officer", 1, 12, "BR", 0.6],
  ["MKT", "Product Manager", 5, 2, "HO", 0],
  ["FIN", "Head of Finance", 7, 1, "HO", 0],
  ["FIN", "Accountant", 2, 8, "HO", 0.2],
  ["INV", "Investment Analyst", 3, 4, "HO", 0],
  ["CMP", "Head of Compliance", 7, 1, "HO", 0],
  ["CMP", "AML/CFT Officer", 3, 4, "HO", 0],
  ["RSK", "Risk Manager", 5, 1, "HO", 0],
  ["RSK", "Risk Analyst", 3, 3, "HO", 0],
  ["LGL", "Legal Counsel", 4, 3, "HO", 0],
  ["IAU", "Internal Auditor", 3, 4, "HO", 0],
  ["HRD", "Head of Human Capital", 7, 1, "HO", 0],
  ["HRD", "HR Business Partner", 4, 4, "HO", 0],
  ["HRD", "HR Operations Officer", 2, 4, "HO", 0.2],
  ["HRD", "Payroll Officer", 2, 3, "HO", 0],
];

const DIRECTOR_OF: Record<string, number | null> = {
  ACT: 0, UW: 0, CLM: 0, POL: 1, CSV: 1, ITD: 1, GAF: 1, BAN: 2, AGY: 2, MKT: 2,
  FIN: 3, INV: 3, CMP: 4, RSK: 4, LGL: 4, IAU: null, HRD: null, EXE: null,
}; // prettier-ignore

// HRBP number (index among HR Business Partners) covering each department.
const HRBP_OF: Record<string, number> = {
  CLM: 0, UW: 0, POL: 0, CSV: 0, BAN: 1, AGY: 1, MKT: 1, ITD: 2, GAF: 2, FIN: 2, INV: 2,
  ACT: 3, CMP: 3, RSK: 3, LGL: 3, IAU: 3, HRD: 3, EXE: 3,
}; // prettier-ignore

const FEMALE = ["Ayu", "Dewi", "Sari", "Rina", "Putri", "Nadia", "Intan", "Wulan", "Fitri", "Maya", "Siti", "Anisa", "Citra", "Dian", "Indah", "Kartika", "Lestari", "Nurul", "Ratna", "Melati", "Novita", "Gita", "Clara", "Monica", "Grace", "Ni Luh", "Tiara", "Aulia", "Zahra", "Ratih", "Widya", "Agnes"]; // prettier-ignore
const MALE = ["Budi", "Agus", "Andi", "Rizky", "Dimas", "Fajar", "Hendra", "Irfan", "Joko", "Bayu", "Arif", "Eko", "Galih", "Hadi", "Ilham", "Lukman", "Nugroho", "Rahmat", "Teguh", "Wahyu", "Yusuf", "Reza", "Daniel", "Kevin", "Yohanes", "I Made", "I Wayan", "Togar", "Faisal", "Taufik", "Gilang", "Aditya"]; // prettier-ignore
const SURNAMES = ["Pratama", "Saputra", "Wijaya", "Santoso", "Hidayat", "Siregar", "Nasution", "Harahap", "Lubis", "Sinaga", "Tanjung", "Chaniago", "Daeng", "Rahman", "Halim", "Gunawan", "Setiawan", "Kusuma", "Permana", "Ramadhan", "Hakim", "Nugraha", "Hartono", "Utomo", "Sitompul", "Manurung", "Sembiring", "Ginting", "Wenas", "Lim", "Tan", "Adnyana", "Suardana", "Pangaribuan"]; // prettier-ignore

const WAGE: Record<number, [number, number]> = {
  1: [5_000_000, 7_500_000], 2: [7_000_000, 11_000_000], 3: [10_000_000, 16_000_000], 4: [15_000_000, 24_000_000],
  5: [21_000_000, 34_000_000], 7: [48_000_000, 75_000_000], 8: [95_000_000, 160_000_000],
}; // prettier-ignore

export interface SeedEmployee {
  id: number;
  employeeNo: string;
  fullName: string;
  email: string;
  gender: "F" | "M";
  departmentCode: string;
  location: string;
  position: string;
  grade: string;
  rank: number;
  managerId: number | null;
  hireDate: string;
  employmentType: "PKWT" | "PKWTT";
  probationMonths: number;
  monthlyWage: number;
  isActive: boolean;
  lastDay: string | null;
}

export interface SeedContract {
  employeeId: number;
  kind: "PKWT" | "PKWTT";
  startDate: string;
  endDate: string | null;
}

export interface SeedDirectory {
  employees: SeedEmployee[];
  contracts: SeedContract[];
  departments: { code: string; name: string; headEmployeeId: number | null; hrbpEmployeeId: number | null }[];
}

function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function pkwtChain(start: string, until: string): SeedContract[] {
  const out: SeedContract[] = [];
  let s = start;
  for (let guard = 0; guard < 10; guard++) {
    const e = addDays(addMonths(s, 12), -1);
    out.push({ employeeId: 0, kind: "PKWT", startDate: s, endDate: e });
    if (e >= until) break;
    s = addDays(e, 1);
  }
  return out;
}

export function buildDirectory(today: string, seed = 7): SeedDirectory {
  const r = rng(seed);
  const slots: { dept: string; title: string; rank: number; loc: string; pkwt: number }[] = [];
  for (const [dept, title, rank, count, spread, pkwt] of PLAN) {
    for (let i = 0; i < count; i++) {
      let loc: string = "Jakarta";
      if (spread === "EACH") loc = LOCATIONS[i % LOCATIONS.length]!;
      if (spread === "BR") {
        let x = r.next();
        loc = LOCATIONS[BRANCH_WEIGHTS.findIndex((w) => (x -= w) < 0)] ?? "Jakarta";
      }
      slots.push({ dept, title, rank, loc, pkwt });
    }
  }

  const used = new Set<string>();
  const people: SeedEmployee[] = slots.map((s, i) => {
    const gender: "F" | "M" = r.chance(s.rank >= 7 ? 0.35 : 0.55) ? "F" : "M";
    let name = "";
    for (let tries = 0; tries < 20; tries++) {
      name = `${r.pick(gender === "F" ? FEMALE : MALE)} ${r.pick(SURNAMES)}`;
      if (!used.has(name)) break;
    }
    used.add(name);
    // Frontline turnover means about one in eight staff joined in the last six months.
    const recent = s.rank <= 3 && r.chance(0.12);
    const tenureYears =
      s.rank >= 7 ? r.int(4, 16) : s.rank >= 4 ? r.int(2, 12) : recent ? r.next() * 0.5 : r.int(0, 8) + r.next();
    const onPkwt = r.chance(s.pkwt) && tenureYears < 4;
    const hire = addDays(today, -Math.round(tenureYears * 365) - r.int(5, 200));
    const [lo, hi] = WAGE[s.rank]!;
    const local = name.toLowerCase().replace(/[^a-z ]/g, "").split(" ").slice(-2).join(".");
    return {
      id: i + 1,
      employeeNo: "",
      fullName: name,
      email: `${local}@arunikalife.example`,
      gender,
      departmentCode: s.dept,
      location: s.loc,
      position: s.title,
      grade: `G${s.rank}`,
      rank: s.rank,
      managerId: null,
      hireDate: hire,
      employmentType: onPkwt ? "PKWT" : "PKWTT",
      probationMonths: onPkwt ? 0 : 3,
      monthlyWage: Math.round((lo + r.next() * (hi - lo)) / 50_000) * 50_000,
      isActive: true,
      lastDay: null,
    };
  });

  // Reporting lines: leader of each department reports to a director (or the PD); others to
  // the nearest higher grade in the same office, else the department leader.
  const pd = people.find((p) => p.position === "President Director")!;
  const directors = people.filter((p) => p.position === "Director");
  for (const d of directors) d.managerId = pd.id;
  const heads = new Map<string, SeedEmployee>();
  for (const [code] of DEPARTMENTS) {
    const members = people.filter((p) => p.departmentCode === code && p !== pd && !directors.includes(p));
    if (!members.length) continue;
    const top = Math.max(...members.map((m) => m.rank));
    const leader = members.find((m) => m.rank === top && m.location === "Jakarta") ?? members[0]!;
    heads.set(code, leader);
    const dIdx = DIRECTOR_OF[code];
    leader.managerId = dIdx === null || dIdx === undefined ? pd.id : directors[dIdx]!.id;
    let rr = 0;
    for (const m of members) {
      if (m === leader) continue;
      const higher = members.filter((h) => h.rank > m.rank);
      const sameLoc = higher.filter((h) => h.location === m.location);
      const pool = sameLoc.length ? sameLoc : higher.filter((h) => h === leader || h.location === "Jakarta");
      if (!pool.length) {
        m.managerId = leader.id;
        continue;
      }
      const low = Math.min(...pool.map((h) => h.rank));
      const cands = pool.filter((h) => h.rank === low);
      m.managerId = cands[rr++ % cands.length]!.id;
    }
  }
  if (!heads.has("EXE")) heads.set("EXE", pd);

  // Three joiners who have signed but not started yet.
  for (const [position, location, inDays] of [
    ["Customer Service Officer", "Surabaya", 6],
    ["Claims Analyst", "Medan", 11],
    ["Software Engineer", "Jakarta", 16],
  ] as const) {
    const twin = people.find((p) => p.position === position && p.location === location) ?? people.find((p) => p.position === position)!;
    const gender: "F" | "M" = r.chance(0.5) ? "F" : "M";
    const name = `${r.pick(gender === "F" ? FEMALE : MALE)} ${r.pick(SURNAMES)}`;
    people.push({
      ...twin,
      id: people.length + 1,
      fullName: name,
      email: `${name.toLowerCase().replace(/[^a-z ]/g, "").split(" ").slice(-2).join(".")}.new@arunikalife.example`,
      gender,
      location,
      hireDate: addDays(today, inDays),
      employmentType: position === "Customer Service Officer" ? "PKWT" : "PKWTT",
      probationMonths: position === "Customer Service Officer" ? 0 : 3,
    });
  }

  // Employee numbers follow hire order, as an HRIS would issue them.
  const byHire = [...people].sort((a, b) => a.hireDate.localeCompare(b.hireDate) || a.id - b.id);
  byHire.forEach((p, i) => (p.employeeNo = `AL-${String(i + 1).padStart(5, "0")}`));

  const contracts: SeedContract[] = [];
  for (const p of people) {
    if (p.employmentType === "PKWT") {
      for (const c of pkwtChain(p.hireDate, today)) contracts.push({ ...c, employeeId: p.id });
    } else {
      contracts.push({ employeeId: p.id, kind: "PKWTT", startDate: p.hireDate, endDate: null });
    }
  }

  const hrbps = people.filter((p) => p.position === "HR Business Partner");
  const departments = DEPARTMENTS.map(([code, name]) => ({
    code,
    name,
    headEmployeeId: heads.get(code)?.id ?? null,
    hrbpEmployeeId: hrbps[HRBP_OF[code] ?? 3]?.id ?? null,
  }));
  return { employees: people, contracts, departments };
}
