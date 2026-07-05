export type CustomerStatus = "active" | "cancelled" | "lead" | "quoted" | "ignored" | "declined" | "paused";
export type PaymentStatus = "paid" | "due" | "overdue" | "watch";
export type Tier = "S" | "A" | "B" | "C" | "D";
export type ViewKey = "dashboard" | "map" | "streets" | "customers" | "marketing" | "add";
export type MessageChannel = "sms" | "whatsapp";

export interface Customer {
  id: string;
  name: string;
  address: string;
  street: string;
  area: string;
  frequencyWeeks: number;
  price: number;
  startDate: string;
  nextDueDate?: string;
  phone?: string;
  source: string;
  campaignId?: string;
  status: CustomerStatus;
  endDate?: string;
  chaseDate?: string;
  quoteReason?: string;
  lastMessageAt?: string;
  notes?: string;
  paymentStatus: PaymentStatus;
  lat: number;
  lng: number;
  routeDay?: string;
}

export interface Street {
  id: string;
  area: string;
  name: string;
  tier: Tier;
  housesEstimate: number;
  notes?: string;
  lastLeaflet?: string;
  leafletCount: number;
  lat: number;
  lng: number;
}

export interface LeafletDrop {
  id: string;
  streetId: string;
  date: string;
  amount: number;
  leafletVersion: string;
  cost?: number;
  responses: number;
  customersWon: number;
}

export interface MessageTemplate {
  id: string;
  name: string;
  channel: MessageChannel;
  body: string;
}

export interface MarketingCampaign {
  id: string;
  name: string;
  source: string;
  startDate: string;
  endDate?: string;
  spend: number;
  notes?: string;
}

export interface AppState {
  customers: Customer[];
  streets: Street[];
  leafletDrops: LeafletDrop[];
  messageTemplates: MessageTemplate[];
  campaigns: MarketingCampaign[];
}
