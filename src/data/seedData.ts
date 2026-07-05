import type { AppState, Customer, CustomerStatus, LeafletDrop, MarketingCampaign, MessageTemplate, PaymentStatus, Street, Tier } from "../types";
import { approxPoint, idFrom, parseUkDate, streetFromAddress, titleCase } from "../utils/data";
import { rawPdfCustomers } from "./generatedCustomers";

const routeDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export const defaultMessageTemplates: MessageTemplate[] = [
  {
    id: "template-leaflet-quote",
    name: "Leaflet enquiry quote",
    channel: "sms",
    body: "Hi [Name], thanks for getting in touch. For [Address], the regular window clean would be £[Price] every [Frequency] weeks. I can get you booked in from [NextDue] if that works for you.",
  },
  {
    id: "template-website-booking",
    name: "Website enquiry booking",
    channel: "sms",
    body: "Hi [Name], thanks for your enquiry. The price for [Address] is £[Price] every [Frequency] weeks. Payments can be made by bank transfer after each clean. I can get you booked in for [NextDue].",
  },
  {
    id: "template-quote-follow-up",
    name: "Quote follow-up",
    channel: "sms",
    body: "Hi [Name], just checking if you wanted to go ahead with the window cleaning quote for [Address]. No worries either way.",
  },
  {
    id: "template-payment-chase",
    name: "Payment reminder",
    channel: "sms",
    body: "Hi [Name], just a quick reminder that payment for your recent window clean is still outstanding. The amount due is £[Price]. Thanks.",
  },
  {
    id: "template-review-request",
    name: "Review request",
    channel: "sms",
    body: "Hi [Name], hope you're happy with the window clean. If you have a minute, a quick review would really help. Thanks.",
  },
];

export const defaultCampaigns: MarketingCampaign[] = [
  {
    id: "campaign-leaflets",
    name: "Leaflet rounds",
    source: "Leaflet",
    startDate: "2026-01-01",
    spend: 0,
    notes: "Default campaign for hand-delivered leaflets.",
  },
  {
    id: "campaign-facebook-organic",
    name: "Facebook organic",
    source: "Facebook Organic",
    startDate: "2026-01-01",
    spend: 0,
  },
  {
    id: "campaign-google-organic",
    name: "Google organic",
    source: "Google Organic",
    startDate: "2026-01-01",
    spend: 0,
  },
];

const tierSeed: Array<{
  area: string;
  name: string;
  tier: Tier;
  housesEstimate: number;
  notes?: string;
  lastLeaflet?: string;
  leafletCount?: number;
}> = [
  { area: "Hessle", name: "Rosner Drive", tier: "S", housesEstimate: 42, notes: "Previous cleaner poor", lastLeaflet: "2026-06-20", leafletCount: 2 },
  { area: "Hessle", name: "Griffin Drive", tier: "S", housesEstimate: 54, notes: "Easy parking", lastLeaflet: "2026-06-13", leafletCount: 2 },
  { area: "Hessle", name: "Cherry Avenue", tier: "S", housesEstimate: 70, notes: "New builds", lastLeaflet: "2026-06-13", leafletCount: 2 },
  { area: "Anlaby", name: "Cape Drive", tier: "S", housesEstimate: 36, notes: "Facebook lead", lastLeaflet: "2026-06-08", leafletCount: 1 },
  { area: "Anlaby", name: "Ketil Place", tier: "S", housesEstimate: 30, notes: "New build", lastLeaflet: "2026-06-08", leafletCount: 1 },
  { area: "Willerby", name: "Wolfreton Lane", tier: "S", housesEstimate: 72, notes: "Big detached", lastLeaflet: "2026-06-03", leafletCount: 1 },
  { area: "Willerby", name: "Stuart Green", tier: "S", housesEstimate: 64, notes: "Easy houses", lastLeaflet: "2026-06-01", leafletCount: 2 },
  { area: "Swanland", name: "The Green", tier: "S", housesEstimate: 46, notes: "Premium area", lastLeaflet: "2026-05-29", leafletCount: 1 },
  { area: "Hessle", name: "Bilson Crescent", tier: "A", housesEstimate: 44, notes: "New builds", lastLeaflet: "2026-05-12", leafletCount: 1 },
  { area: "Hessle", name: "Barkworth Way", tier: "A", housesEstimate: 48, notes: "New builds", lastLeaflet: "2026-05-12", leafletCount: 1 },
  { area: "Hessle", name: "Lynwood Avenue", tier: "A", housesEstimate: 64, notes: "Last cleaner quit", lastLeaflet: "2026-05-05", leafletCount: 1 },
  { area: "Willerby", name: "The Parkway", tier: "A", housesEstimate: 78, lastLeaflet: "2026-05-01", leafletCount: 1 },
  { area: "Willerby", name: "Oakdale Avenue", tier: "A", housesEstimate: 52, lastLeaflet: "2026-05-01", leafletCount: 1 },
  { area: "Anlaby", name: "Beverley Road", tier: "A", housesEstimate: 110, notes: "Victorian houses", lastLeaflet: "2026-04-25", leafletCount: 1 },
  { area: "Hessle", name: "Boothferry Road", tier: "A", housesEstimate: 120, lastLeaflet: "2026-04-25", leafletCount: 1 },
  { area: "North Ferriby", name: "Plantation Drive", tier: "A", housesEstimate: 58, lastLeaflet: "2026-04-20", leafletCount: 1 },
];

function statusFrom(value: string): CustomerStatus {
  if (value === "cancelled") return "cancelled";
  if (value === "paused") return "paused";
  if (value === "lead") return "lead";
  if (value === "quoted") return "quoted";
  if (value === "ignored") return "ignored";
  if (value === "declined") return "declined";
  return "active";
}

function paymentFrom(_customer: unknown): PaymentStatus {
  return "paid";
}

function buildCustomers(): Customer[] {
  return rawPdfCustomers.map((row, index) => {
    const street = streetFromAddress(row.address);
    const [lat, lng] = approxPoint(row.area, `${row.address}-${row.name}`);

    return {
      id: idFrom(["customer", index + 1, row.name, row.address]),
      name: titleCase(row.name || "Unknown"),
      address: titleCase(row.address),
      street,
      area: titleCase(row.area || "Hessle"),
      frequencyWeeks: row.frequencyWeeks,
      price: row.price,
      startDate: parseUkDate(row.startDate),
      phone: "",
      source: titleCase(row.source || "Unknown"),
      campaignId: campaignForSource(row.source),
      status: statusFrom(row.status),
      endDate: parseUkDate(row.endDate),
      notes: row.notes,
      paymentStatus: paymentFrom(row),
      lat,
      lng,
      routeDay: routeDays[index % routeDays.length],
    };
  });
}

function buildStreets(customers: Customer[]) {
  const streets = new Map<string, Street>();

  for (const item of tierSeed) {
    const [lat, lng] = approxPoint(item.area, item.name);
    const street: Street = {
      id: idFrom(["street", item.area, item.name]),
      area: item.area,
      name: item.name,
      tier: item.tier,
      housesEstimate: item.housesEstimate,
      notes: item.notes,
      lastLeaflet: item.lastLeaflet,
      leafletCount: item.leafletCount ?? 0,
      lat,
      lng,
    };
    streets.set(streetKey(item.area, item.name), street);
  }

  for (const customer of customers) {
    const key = streetKey(customer.area, customer.street);
    const sourceIsLeaflet = customer.source.toLowerCase().includes("leaflet");

    if (!streets.has(key)) {
      const [lat, lng] = approxPoint(customer.area, customer.street);
      streets.set(key, {
        id: idFrom(["street", customer.area, customer.street]),
        area: customer.area,
        name: customer.street,
        tier: sourceIsLeaflet ? "B" : "C",
        housesEstimate: 60,
        notes: "Imported from customer list",
        lastLeaflet: sourceIsLeaflet ? customer.startDate : undefined,
        leafletCount: sourceIsLeaflet ? 1 : 0,
        lat,
        lng,
      });
      continue;
    }

    const existing = streets.get(key)!;
    if (sourceIsLeaflet && !existing.lastLeaflet) {
      streets.set(key, {
        ...existing,
        lastLeaflet: customer.startDate,
        leafletCount: Math.max(existing.leafletCount, 1),
      });
    }
  }

  return Array.from(streets.values()).sort((a, b) => {
    const tierOrder = "SABCD".indexOf(a.tier) - "SABCD".indexOf(b.tier);
    return tierOrder || a.area.localeCompare(b.area) || a.name.localeCompare(b.name);
  });
}

function buildLeafletDrops(streets: Street[], customers: Customer[]): LeafletDrop[] {
  return streets
    .filter((street) => street.lastLeaflet && street.leafletCount > 0)
    .map((street, index) => {
      const won = customers.filter(
        (customer) =>
          customer.source.toLowerCase().includes("leaflet") &&
          customer.street.toLowerCase() === street.name.toLowerCase(),
      ).length;

      return {
        id: idFrom(["drop", index + 1, street.id]),
        streetId: street.id,
        date: street.lastLeaflet!,
        amount: street.housesEstimate,
        leafletVersion: street.tier === "S" ? "Premium push" : "Standard round",
        responses: Math.max(won, street.tier === "S" ? 1 : 0),
        customersWon: won,
      };
    });
}

function streetKey(area: string, street: string) {
  return `${area.toLowerCase()}::${street.toLowerCase()}`;
}

const customers = buildCustomers();
const streets = buildStreets(customers);

export const initialState: AppState = {
  customers,
  streets,
  leafletDrops: buildLeafletDrops(streets, customers),
  messageTemplates: defaultMessageTemplates,
  campaigns: defaultCampaigns,
};

function campaignForSource(source: string) {
  const value = source.toLowerCase();
  if (value.includes("leaflet")) return "campaign-leaflets";
  if (value.includes("facebook")) return "campaign-facebook-organic";
  if (value.includes("google")) return "campaign-google-organic";
  return undefined;
}
