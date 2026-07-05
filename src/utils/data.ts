import { addDays, differenceInCalendarDays, format, isValid, parse } from "date-fns";
import type { Customer, LeafletDrop, MessageTemplate, Street, Tier } from "../types";

export const TODAY = new Date();

export const tierCadenceWeeks: Record<Tier, number> = {
  S: 8,
  A: 12,
  B: 14,
  C: 18,
  D: 0,
};

export const tierLabels: Record<Tier, string> = {
  S: "S tier",
  A: "A tier",
  B: "B tier",
  C: "C tier",
  D: "No-go",
};

export const tierColors: Record<Tier, string> = {
  S: "#00d45a",
  A: "#11cdd4",
  B: "#f59e0b",
  C: "#94a3b8",
  D: "#ef4444",
};

export function idFrom(parts: Array<string | number | undefined>) {
  return parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function normalise(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function parseUkDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const parsed = parse(trimmed, "d/M/yy", new Date());
  return isValid(parsed) ? format(parsed, "yyyy-MM-dd") : trimmed;
}

export function formatShortDate(value?: string) {
  if (!value) return "Not set";
  const date = new Date(`${value}T12:00:00`);
  return isValid(date) ? format(date, "dd MMM yy") : value;
}

export function streetFromAddress(address: string) {
  let street = address
    .toLowerCase()
    .replace(/^\s*\d+[a-z]?\s*/i, "")
    .replace(/^\s*[a-z]\s+/i, "")
    .replace(/\brd\b/g, "road")
    .replace(/\bav\b/g, "avenue")
    .replace(/\bcresent\b/g, "crescent")
    .replace(/\btrinty\b/g, "trinity")
    .replace(/\bmanour\b/g, "manor")
    .replace(/\bbeverly\b/g, "beverley")
    .replace(/\bwymersley\b/g, "wymersley")
    .replace(/\bfirstlane\b/g, "first lane")
    .replace(/\s+/g, " ")
    .trim();

  if (!street) street = address.toLowerCase().trim();
  return titleCase(street);
}

export function titleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      if (["rd", "av"].includes(word.toLowerCase())) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export function areaKey(area: string) {
  const cleaned = normalise(area);
  if (cleaned === "hesse") return "hessle";
  if (cleaned === "n ferriby") return "north ferriby";
  if (cleaned === "boothferry") return "hessle";
  return cleaned;
}

const areaCenters: Record<string, [number, number]> = {
  hessle: [53.7245, -0.4388],
  anlaby: [53.7419, -0.4378],
  willerby: [53.7607, -0.4415],
  "north ferriby": [53.7219, -0.5062],
  "west hull": [53.7464, -0.3924],
  swanland: [53.7411, -0.4927],
  brough: [53.7281, -0.5731],
};

function hash(value: string) {
  let total = 0;
  for (let i = 0; i < value.length; i += 1) {
    total = (total * 31 + value.charCodeAt(i)) >>> 0;
  }
  return total;
}

export function approxPoint(area: string, seed: string): [number, number] {
  const center = areaCenters[areaKey(area)] ?? areaCenters.hessle;
  const h = hash(`${area}:${seed}`);
  const latOffset = (((h % 200) - 100) / 100) * 0.0029;
  const lngOffset = ((((h >> 8) % 200) - 100) / 100) * 0.0042;
  return [center[0] + latOffset, center[1] + lngOffset];
}

export function weeklyRevenue(customer: Customer) {
  return customer.status === "active" ? customer.price / customer.frequencyWeeks : 0;
}

export function monthlyRevenue(customer: Customer) {
  return weeklyRevenue(customer) * 52 / 12;
}

export function yearlyRevenue(customer: Customer) {
  return weeklyRevenue(customer) * 52;
}

export function lifetimeValue(customer: Customer, years = 3) {
  return yearlyRevenue(customer) * years;
}

export function nextJobDate(customer: Customer, fromDate = TODAY) {
  if (customer.nextDueDate) {
    const manualDue = new Date(`${customer.nextDueDate}T12:00:00`);
    if (isValid(manualDue)) return manualDue;
  }

  const start = new Date(`${customer.startDate}T12:00:00`);
  if (!isValid(start)) return undefined;

  const step = customer.frequencyWeeks * 7;
  let due = start;
  while (differenceInCalendarDays(due, fromDate) < 0) {
    due = addDays(due, step);
  }
  return due;
}

export function nextLeafletDate(street: Street, fromDate = TODAY) {
  if (!street.lastLeaflet) return undefined;
  const cadence = tierCadenceWeeks[street.tier];
  if (!cadence) return undefined;

  let due = new Date(`${street.lastLeaflet}T12:00:00`);
  const step = cadence * 7;
  while (differenceInCalendarDays(due, fromDate) < 0) {
    due = addDays(due, step);
  }
  return due;
}

export function streetCustomers(street: Street, customers: Customer[]) {
  const streetKey = normalise(street.name);
  return customers.filter((customer) => normalise(customer.street) === streetKey);
}

export function sourceMatches(customer: Customer, source: string) {
  return normalise(customer.source).includes(normalise(source));
}

export function streetScore(street: Street, customers: Customer[], drops: LeafletDrop[]) {
  const related = streetCustomers(street, customers);
  const active = related.filter((customer) => customer.status === "active");
  const cancelled = related.filter((customer) => customer.status === "cancelled");
  const revenue = active.reduce((sum, customer) => sum + monthlyRevenue(customer), 0);
  const tierBase = { S: 120, A: 95, B: 70, C: 45, D: 0 }[street.tier];
  const dropSignal = drops
    .filter((drop) => drop.streetId === street.id)
    .reduce((sum, drop) => sum + drop.responses * 6 + drop.customersWon * 16, 0);

  return Math.max(0, Math.round(tierBase + active.length * 18 + revenue * 0.6 + dropSignal - cancelled.length * 10));
}

export function distanceKm(a: [number, number], b: [number, number]) {
  const r = 6371;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * r * Math.asin(Math.sqrt(x));
}

export function renderTemplate(template: MessageTemplate, customer: Customer) {
  const values: Record<string, string> = {
    "[Name]": customer.name,
    "[Address]": customer.address,
    "[Area]": customer.area,
    "[Price]": String(customer.price),
    "[Frequency]": String(customer.frequencyWeeks),
    "[NextDue]": formatShortDate(customer.nextDueDate),
  };

  return Object.entries(values).reduce((text, [token, value]) => text.replaceAll(token, value), template.body);
}

export function messageLink(customer: Customer, template: MessageTemplate) {
  const body = encodeURIComponent(renderTemplate(template, customer));
  const digits = (customer.phone || "").replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (template.channel === "whatsapp") return `https://wa.me/${digits.replace(/^\+/, "")}?text=${body}`;
  return `sms:${digits}?&body=${body}`;
}

function toRad(value: number) {
  return value * Math.PI / 180;
}

export function optimiseRoute(customers: Customer[]) {
  const start: [number, number] = [53.7245, -0.4388];
  const remaining = customers.map((customer) => ({ ...customer }));
  const ordered: Customer[] = [];
  let current = start;

  while (remaining.length) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((customer, index) => {
      const dist = distanceKm(current, [customer.lat, customer.lng]);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestIndex = index;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next);
    current = [next.lat, next.lng];
  }

  return ordered;
}
