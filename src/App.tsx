import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { addDays, differenceInCalendarDays, format, isSameMonth } from "date-fns";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  Download,
  Home,
  LayoutDashboard,
  MapPinned,
  Megaphone,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCcw,
  Route,
  Save,
  Search,
  Sparkles,
  Star,
  UserRoundSearch,
  TrendingUp,
  Upload,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip, useMapEvents } from "react-leaflet";
import type { AppState, Customer, LeafletDrop, MessageTemplate, PaymentStatus, Street, Tier, ViewKey } from "./types";
import { initialState } from "./data/seedData";
import {
  approxPoint,
  distanceKm,
  formatShortDate,
  idFrom,
  lifetimeValue,
  messageLink,
  monthlyRevenue,
  nextJobDate,
  nextLeafletDate,
  normalise,
  optimiseRoute,
  renderTemplate,
  sourceMatches,
  streetFromAddress,
  streetScore,
  tierCadenceWeeks,
  tierColors,
  tierLabels,
  titleCase,
  TODAY,
  weeklyRevenue,
  yearlyRevenue,
} from "./utils/data";

const STORAGE_KEY = "clearflow-territory-state-v1";
const currency = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const preciseCurrency = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 });

const navItems: Array<{ key: ViewKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "map", label: "Map", icon: MapPinned },
  { key: "streets", label: "Streets", icon: Home },
  { key: "customers", label: "Customers", icon: Users },
  { key: "marketing", label: "Marketing", icon: Megaphone },
  { key: "add", label: "Add", icon: Plus },
];

const sourceOptions = [
  "Leaflet",
  "Facebook Organic",
  "Facebook Ads",
  "Google Organic",
  "Google Ads",
  "Website",
  "Referral",
  "Nextdoor",
  "Seen Working",
  "Repeat Customer",
  "Other",
];

const quoteReasons = [
  "",
  "Too expensive",
  "Not ready yet",
  "Just checking price",
  "Went with someone else",
  "Bad timing",
  "No reply",
  "No reason given",
];

const blankCustomer = {
  name: "",
  address: "",
  area: "Hessle",
  frequencyWeeks: 4,
  price: 15,
  phone: "",
  source: "Leaflet",
  campaignId: "campaign-leaflets",
  status: "active" as Customer["status"],
  paymentStatus: "paid" as PaymentStatus,
  routeDay: "Monday",
  nextDueDate: format(TODAY, "yyyy-MM-dd"),
  quoteReason: "",
  notes: "",
};

const chaseStatuses: Customer["status"][] = ["lead", "quoted", "ignored"];

function loadState(): AppState {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? hydrateState(JSON.parse(stored) as Partial<AppState>) : initialState;
  } catch {
    return initialState;
  }
}

function hydrateState(stored: Partial<AppState>): AppState {
  return {
    ...initialState,
    ...stored,
    customers: (stored.customers ?? initialState.customers).map((customer) => ({
      ...customer,
      phone: customer.phone ?? "",
      campaignId: customer.campaignId ?? campaignForSource(customer.source),
      quoteReason: customer.quoteReason ?? "",
    })),
    streets: stored.streets ?? initialState.streets,
    leafletDrops: stored.leafletDrops ?? initialState.leafletDrops,
    messageTemplates: stored.messageTemplates?.length ? stored.messageTemplates : initialState.messageTemplates,
    campaigns: stored.campaigns?.length ? stored.campaigns : initialState.campaigns,
  };
}

function campaignForSource(source: string) {
  const value = normalise(source);
  if (value.includes("leaflet")) return "campaign-leaflets";
  if (value.includes("facebook")) return "campaign-facebook-organic";
  if (value.includes("google")) return "campaign-google-organic";
  return undefined;
}

export default function App() {
  const [state, setState] = useState<AppState>(loadState);
  const [view, setView] = useState<ViewKey>("dashboard");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerForm, setCustomerForm] = useState(blankCustomer);
  const [dropForm, setDropForm] = useState({
    streetId: initialState.streets[0]?.id ?? "",
    amount: 80,
    date: format(TODAY, "yyyy-MM-dd"),
    leafletVersion: "Standard round",
  });

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const activeCustomers = useMemo(
    () => state.customers.filter((customer) => customer.status === "active"),
    [state.customers],
  );

  const metrics = useMemo(() => {
    const weekly = activeCustomers.reduce((sum, customer) => sum + weeklyRevenue(customer), 0);
    const monthly = activeCustomers.reduce((sum, customer) => sum + monthlyRevenue(customer), 0);
    const averageClean = activeCustomers.length
      ? activeCustomers.reduce((sum, customer) => sum + customer.price, 0) / activeCustomers.length
      : 0;
    const hourly = activeCustomers.length
      ? activeCustomers.reduce((sum, customer) => sum + estimatedHourly(customer), 0) / activeCustomers.length
      : 0;
    const leafletsThisMonth = state.leafletDrops
      .filter((drop) => isSameMonth(new Date(`${drop.date}T12:00:00`), TODAY))
      .reduce((sum, drop) => sum + drop.amount, 0);
    const delivered = state.leafletDrops.reduce((sum, drop) => sum + drop.amount, 0);
    const leafletCustomers = state.customers.filter((customer) => customer.source.toLowerCase().includes("leaflet"));
    const conversion = delivered ? (leafletCustomers.length / delivered) * 100 : 0;
    const cancelled = state.customers.filter((customer) => customer.status === "cancelled");
    const overdue = state.customers.filter((customer) => customer.paymentStatus === "overdue");
    const duePayment = state.customers.filter((customer) => customer.paymentStatus === "due");

    return {
      weekly,
      monthly,
      averageClean,
      hourly,
      leafletsThisMonth,
      conversion,
      cancelled: cancelled.length,
      overdue: overdue.length,
      duePayment: duePayment.length,
      leafletCustomers: leafletCustomers.length,
    };
  }, [activeCustomers, state.customers, state.leafletDrops]);

  const dueJobs = useMemo(() => {
    const tomorrow = addDays(TODAY, 1);
    const withDates = activeCustomers
      .map((customer) => ({ customer, due: nextJobDate(customer) }))
      .filter((item): item is { customer: Customer; due: Date } => Boolean(item.due));

    const overdueJobs = withDates
      .filter((item) => differenceInCalendarDays(item.due, TODAY) < 0)
      .sort((a, b) => a.due.getTime() - b.due.getTime());
    const tomorrowJobs = withDates.filter((item) => differenceInCalendarDays(item.due, tomorrow) === 0);
    const weekJobs = withDates
      .filter((item) => {
        const diff = differenceInCalendarDays(item.due, TODAY);
        return diff >= 0 && diff <= 7;
      })
      .sort((a, b) => a.due.getTime() - b.due.getTime());

    return { overdueJobs, tomorrowJobs, weekJobs };
  }, [activeCustomers]);

  const routePlan = useMemo(() => {
    const jobs = (dueJobs.tomorrowJobs.length ? dueJobs.tomorrowJobs : dueJobs.overdueJobs.length ? dueJobs.overdueJobs : dueJobs.weekJobs)
      .slice(0, 14)
      .map((item) => item.customer);
    const optimised = optimiseRoute(jobs);
    const originalKm = routeDistance(jobs);
    const optimisedKm = routeDistance(optimised);
    const minutesSaved = Math.max(0, Math.round((originalKm - optimisedKm) * 2.4));

    return { jobs, optimised, originalKm, optimisedKm, minutesSaved };
  }, [dueJobs]);

  const leafletDue = useMemo(() => {
    return state.streets
      .map((street) => ({ street, due: nextLeafletDate(street), score: streetScore(street, state.customers, state.leafletDrops) }))
      .filter((item): item is { street: Street; due: Date; score: number } => Boolean(item.due))
      .map((item) => ({ ...item, days: differenceInCalendarDays(item.due, TODAY) }))
      .filter((item) => item.days <= 21)
      .sort((a, b) => a.days - b.days || b.score - a.score);
  }, [state.customers, state.leafletDrops, state.streets]);

  const opportunities = useMemo(() => {
    return state.streets
      .map((street) => {
        const active = state.customers.filter(
          (customer) => customer.status === "active" && normalise(customer.street) === normalise(street.name),
        );
        const score = streetScore(street, state.customers, state.leafletDrops);
        const due = nextLeafletDate(street);
        const dueBoost = due ? Math.max(0, 35 - differenceInCalendarDays(due, TODAY)) : 0;
        const revenue = active.reduce((sum, customer) => sum + monthlyRevenue(customer), 0);

        return {
          street,
          active: active.length,
          revenue,
          score,
          due,
          priority: score + dueBoost,
        };
      })
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 6);
  }, [state.customers, state.leafletDrops, state.streets]);

  const sourceBreakdown = useMemo(() => {
    const totals = new Map<string, { count: number; revenue: number }>();
    for (const customer of activeCustomers) {
      const key = customer.source || "Unknown";
      const current = totals.get(key) ?? { count: 0, revenue: 0 };
      current.count += 1;
      current.revenue += monthlyRevenue(customer);
      totals.set(key, current);
    }
    return Array.from(totals.entries())
      .map(([source, data]) => ({ source, ...data }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [activeCustomers]);

  const filteredCustomers = useMemo(() => {
    const query = normalise(customerQuery);
    if (!query) return state.customers;
    return state.customers.filter((customer) =>
      [customer.name, customer.address, customer.area, customer.source, customer.status]
        .some((value) => normalise(String(value)).includes(query)),
    );
  }, [customerQuery, state.customers]);

  function addCustomer(event: React.FormEvent) {
    event.preventDefault();
    const streetName = streetFromAddress(customerForm.address);
    const streetKey = normalise(`${customerForm.area}-${streetName}`);
    const matchedStreet = state.streets.find((street) => normalise(`${street.area}-${street.name}`) === streetKey);
    const [lat, lng] = matchedStreet
      ? [matchedStreet.lat, matchedStreet.lng]
      : approxPoint(customerForm.area, `${customerForm.address}-${customerForm.name}`);
    const sourceIsLeaflet = customerForm.source.toLowerCase().includes("leaflet");

    const customer: Customer = {
      id: idFrom(["customer", Date.now(), customerForm.name, customerForm.address]),
      name: titleCase(customerForm.name || "Unknown"),
      address: titleCase(customerForm.address),
      street: streetName,
      area: titleCase(customerForm.area),
      frequencyWeeks: Number(customerForm.frequencyWeeks),
      price: Number(customerForm.price),
      startDate: format(TODAY, "yyyy-MM-dd"),
      nextDueDate: customerForm.status === "active" ? customerForm.nextDueDate : undefined,
      phone: customerForm.phone,
      source: titleCase(customerForm.source),
      campaignId: customerForm.campaignId || campaignForSource(customerForm.source),
      status: customerForm.status as Customer["status"],
      paymentStatus: customerForm.paymentStatus,
      routeDay: customerForm.routeDay,
      chaseDate: chaseStatuses.includes(customerForm.status)
        ? format(addDays(TODAY, customerForm.status === "ignored" ? 0 : 2), "yyyy-MM-dd")
        : undefined,
      quoteReason: customerForm.quoteReason,
      notes: customerForm.notes,
      lat,
      lng,
    };

    setState((current) => {
      let streets = current.streets;
      if (matchedStreet) {
        streets = current.streets.map((street) =>
          street.id === matchedStreet.id && sourceIsLeaflet && !street.lastLeaflet
            ? { ...street, lastLeaflet: format(TODAY, "yyyy-MM-dd"), leafletCount: street.leafletCount + 1 }
            : street,
        );
      } else {
        streets = [
          ...current.streets,
          {
            id: idFrom(["street", customer.area, customer.street]),
            area: customer.area,
            name: customer.street,
            tier: sourceIsLeaflet ? "B" : "C",
            housesEstimate: 60,
            notes: sourceIsLeaflet ? "New customer from leaflet" : "Added from customer form",
            lastLeaflet: sourceIsLeaflet ? format(TODAY, "yyyy-MM-dd") : undefined,
            leafletCount: sourceIsLeaflet ? 1 : 0,
            lat,
            lng,
          },
        ];
      }

      return { ...current, customers: [customer, ...current.customers], streets };
    });
    setCustomerForm(blankCustomer);
    setView("dashboard");
  }

  function markLeafleted(street: Street) {
    const date = format(TODAY, "yyyy-MM-dd");
    const drop: LeafletDrop = {
      id: idFrom(["drop", Date.now(), street.id]),
      streetId: street.id,
      date,
      amount: street.housesEstimate,
      leafletVersion: street.tier === "S" ? "Premium push" : "Standard round",
      responses: 0,
      customersWon: 0,
    };

    setState((current) => ({
      ...current,
      streets: current.streets.map((item) =>
        item.id === street.id
          ? { ...item, lastLeaflet: date, leafletCount: item.leafletCount + 1 }
          : item,
      ),
      leafletDrops: [drop, ...current.leafletDrops],
    }));
  }

  function logLeafletDrop(event: React.FormEvent) {
    event.preventDefault();
    const street = state.streets.find((item) => item.id === dropForm.streetId);
    if (!street) return;

    const drop: LeafletDrop = {
      id: idFrom(["drop", Date.now(), street.id]),
      streetId: street.id,
      date: dropForm.date,
      amount: Number(dropForm.amount),
      leafletVersion: dropForm.leafletVersion,
      responses: 0,
      customersWon: 0,
    };

    setState((current) => ({
      ...current,
      streets: current.streets.map((item) =>
        item.id === street.id
          ? { ...item, lastLeaflet: drop.date, leafletCount: item.leafletCount + 1 }
          : item,
      ),
      leafletDrops: [drop, ...current.leafletDrops],
    }));
  }

  function updateCustomer(customerId: string, updates: Partial<Customer>) {
    setState((current) => ({
      ...current,
      customers: current.customers.map((customer) => {
        if (customer.id !== customerId) return customer;
        const address = updates.address ?? customer.address;
        const area = updates.area ?? customer.area;
        const street = streetFromAddress(address);
        const addressChanged = address !== customer.address || area !== customer.area;
        const [autoLat, autoLng] = addressChanged ? approxPoint(area, `${address}-${customer.name}`) : [customer.lat, customer.lng];

        return {
          ...customer,
          ...updates,
          address,
          area,
          street,
          price: Number(updates.price ?? customer.price),
          frequencyWeeks: Number(updates.frequencyWeeks ?? customer.frequencyWeeks),
          lat: updates.lat ?? autoLat,
          lng: updates.lng ?? autoLng,
        };
      }),
    }));
  }

  function markJobDone(customer: Customer) {
    updateCustomer(customer.id, {
      nextDueDate: format(addDays(TODAY, customer.frequencyWeeks * 7), "yyyy-MM-dd"),
      paymentStatus: customer.paymentStatus === "overdue" ? "due" : customer.paymentStatus,
    });
  }

  function updateCampaign(campaignId: string, updates: Partial<AppState["campaigns"][number]>) {
    setState((current) => ({
      ...current,
      campaigns: current.campaigns.map((campaign) =>
        campaign.id === campaignId ? { ...campaign, ...updates, spend: Number(updates.spend ?? campaign.spend) } : campaign,
      ),
    }));
  }

  function addCampaign() {
    const date = format(TODAY, "yyyy-MM-dd");
    setState((current) => ({
      ...current,
      campaigns: [
        {
          id: idFrom(["campaign", Date.now()]),
          name: "New campaign",
          source: "Facebook Ads",
          startDate: date,
          spend: 0,
        },
        ...current.campaigns,
      ],
    }));
  }

  function updateTemplate(templateId: string, body: string) {
    setState((current) => ({
      ...current,
      messageTemplates: current.messageTemplates.map((template) =>
        template.id === templateId ? { ...template, body } : template,
      ),
    }));
  }

  function markMessageSent(customer: Customer) {
    updateCustomer(customer.id, { lastMessageAt: format(TODAY, "yyyy-MM-dd") });
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `clearflow-territory-${format(TODAY, "yyyy-MM-dd")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function importData(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const loaded = JSON.parse(String(reader.result)) as Partial<AppState>;
        setState(hydrateState(loaded));
      } catch {
        window.alert("That backup file could not be imported.");
      }
    };
    reader.readAsText(file);
  }

  function resetData() {
    window.localStorage.removeItem(STORAGE_KEY);
    setState(initialState);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">C</div>
          <div>
            <strong>Clearflow</strong>
            <span>Territory command</span>
          </div>
        </div>

        <nav className="nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={view === item.key ? "active" : ""}
                onClick={() => setView(item.key)}
                type="button"
                title={item.label}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-panel">
          <span>Active customers</span>
          <strong>{activeCustomers.length}</strong>
          <small>{currency.format(metrics.monthly)} recurring monthly</small>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">{format(TODAY, "EEEE, d MMMM")}</p>
            <h1>{pageTitle(view)}</h1>
          </div>
          <div className="topbar-actions">
            <button type="button" className="icon-button" onClick={exportData} title="Export data">
              <Download size={18} />
            </button>
            <label className="icon-button" title="Import data">
              <Upload size={18} />
              <input type="file" accept="application/json,.json" onChange={importData} hidden />
            </label>
            <button type="button" className="icon-button" onClick={resetData} title="Reset seed data">
              <RefreshCcw size={18} />
            </button>
          </div>
        </header>

        {view === "dashboard" && (
          <Dashboard
            activeCustomers={activeCustomers}
            dueJobs={dueJobs}
            leafletDue={leafletDue}
            metrics={metrics}
            opportunities={opportunities}
            routePlan={routePlan}
            sourceBreakdown={sourceBreakdown}
            state={state}
          />
        )}

        {view === "map" && (
          <MapView
            routePlan={routePlan}
            state={state}
            updateCustomer={updateCustomer}
          />
        )}

        {view === "streets" && (
          <StreetsView
            leafletDue={leafletDue}
            markLeafleted={markLeafleted}
            state={state}
          />
        )}

        {view === "customers" && (
          <CustomersView
            customerQuery={customerQuery}
            customers={filteredCustomers}
            markJobDone={markJobDone}
            messageTemplates={state.messageTemplates}
            setCustomerQuery={setCustomerQuery}
            markMessageSent={markMessageSent}
            updateCustomer={updateCustomer}
          />
        )}

        {view === "marketing" && (
          <MarketingView
            addCampaign={addCampaign}
            markLeafleted={markLeafleted}
            markMessageSent={markMessageSent}
            state={state}
            updateCampaign={updateCampaign}
            updateTemplate={updateTemplate}
          />
        )}

        {view === "add" && (
          <AddView
            addCustomer={addCustomer}
            customerForm={customerForm}
            dropForm={dropForm}
            logLeafletDrop={logLeafletDrop}
            setCustomerForm={setCustomerForm}
            setDropForm={setDropForm}
            state={state}
          />
        )}
      </main>
    </div>
  );
}

function Dashboard({
  activeCustomers,
  dueJobs,
  leafletDue,
  metrics,
  opportunities,
  routePlan,
  sourceBreakdown,
  state,
}: {
  activeCustomers: Customer[];
  dueJobs: ReturnType<typeof buildDueJobsPlaceholder>;
  leafletDue: Array<{ street: Street; due: Date; score: number; days: number }>;
  metrics: {
    weekly: number;
    monthly: number;
    averageClean: number;
    hourly: number;
    leafletsThisMonth: number;
    conversion: number;
    cancelled: number;
    overdue: number;
    duePayment: number;
    leafletCustomers: number;
  };
  opportunities: Array<{ street: Street; active: number; revenue: number; score: number; due?: Date; priority: number }>;
  routePlan: RoutePlan;
  sourceBreakdown: Array<{ source: string; count: number; revenue: number }>;
  state: AppState;
}) {
  const reviewPrompts = activeCustomers.filter((customer) => {
    const days = differenceInCalendarDays(TODAY, new Date(`${customer.startDate}T12:00:00`));
    return days >= 21 && customer.status === "active";
  });
  const paymentAlerts = state.customers.filter((customer) => ["due", "overdue"].includes(customer.paymentStatus));
  const quoteFollowUps = state.customers
    .filter((customer) => chaseStatuses.includes(customer.status))
    .sort((a, b) => {
      const aDate = new Date(`${a.chaseDate ?? a.startDate}T12:00:00`).getTime();
      const bDate = new Date(`${b.chaseDate ?? b.startDate}T12:00:00`).getTime();
      return aDate - bDate;
    });

  return (
    <div className="content-grid">
      <section className="kpi-grid">
        <MetricCard icon={Users} label="Active customers" value={String(activeCustomers.length)} detail={`${metrics.cancelled} cancelled logged`} />
        <MetricCard icon={Wallet} label="Recurring monthly" value={currency.format(metrics.monthly)} detail={`${preciseCurrency.format(metrics.weekly)} weekly run-rate`} />
        <MetricCard icon={CalendarDays} label="Jobs tomorrow" value={String(dueJobs.tomorrowJobs.length)} detail={`${dueJobs.overdueJobs.length} overdue, ${dueJobs.weekJobs.length} due in 7 days`} />
        <MetricCard icon={TrendingUp} label="Average clean" value={currency.format(metrics.averageClean)} detail={`${currency.format(metrics.hourly)} estimated hourly`} />
        <MetricCard icon={MapPinned} label="Leaflets this month" value={String(metrics.leafletsThisMonth)} detail={`${metrics.conversion.toFixed(2)}% leaflet-to-customer`} />
        <MetricCard icon={Bell} label="Payment alerts" value={String(paymentAlerts.length)} detail={`${metrics.overdue} overdue, ${metrics.duePayment} due`} />
      </section>

      <section className="panel wide">
        <PanelHeader icon={Sparkles} title="Opportunity View" />
        <div className="opportunity-list">
          {opportunities.map((item) => (
            <div className="opportunity-row" key={item.street.id}>
              <div>
                <strong>{item.street.name}</strong>
                <span>{item.street.area} · {tierLabels[item.street.tier]} · score {item.score}</span>
              </div>
              <div>
                <strong>{currency.format(item.revenue)}</strong>
                <span>{item.due ? `Leaflet ${formatShortDate(format(item.due, "yyyy-MM-dd"))}` : "No leaflet date"}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <PanelHeader icon={Bell} title="Automatic Reminders" />
        <ReminderList
          rows={[
            ...quoteFollowUps.slice(0, 5).map((customer) => ({
              title: customer.name,
              detail: `${quoteLabel(customer.status)} · ${customer.address} · chase ${formatShortDate(customer.chaseDate ?? customer.startDate)}`,
              tone: "quote" as const,
            })),
            ...dueJobs.overdueJobs.slice(0, 4).map((item) => ({
              title: item.customer.name,
              detail: `${Math.abs(differenceInCalendarDays(item.due, TODAY))} days overdue - ${item.customer.address}`,
              tone: "job" as const,
            })),
            ...dueJobs.tomorrowJobs.slice(0, 4).map((item) => ({
              title: item.customer.name,
              detail: `${item.customer.address}, ${item.customer.area}`,
              tone: "job" as const,
            })),
            ...leafletDue.slice(0, 4).map((item) => ({
              title: item.street.name,
              detail: item.days < 0 ? `${Math.abs(item.days)} days overdue` : `due in ${item.days} days`,
              tone: "leaflet" as const,
            })),
            ...paymentAlerts.slice(0, 3).map((customer) => ({
              title: customer.name,
              detail: `${customer.paymentStatus} payment · ${currency.format(customer.price)}`,
              tone: "payment" as const,
            })),
            ...reviewPrompts.slice(0, 3).map((customer) => ({
              title: customer.name,
              detail: `review prompt ready · ${customer.source}`,
              tone: "review" as const,
            })),
          ]}
        />
      </section>

      <section className="panel">
        <PanelHeader icon={Route} title="Route Optimisation" />
        <div className="route-summary">
          <strong>{routePlan.optimised.length} stops</strong>
          <span>{routePlan.minutesSaved} minutes saved estimate</span>
        </div>
        <ol className="route-list">
          {routePlan.optimised.slice(0, 8).map((customer) => (
            <li key={customer.id}>
              <span>{customer.name}</span>
              <small>{customer.address}</small>
            </li>
          ))}
        </ol>
      </section>

      <section className="panel">
        <PanelHeader icon={Star} title="Lead Sources" />
        <div className="source-list">
          {sourceBreakdown.slice(0, 7).map((item) => (
            <div key={item.source}>
              <span>{item.source}</span>
              <strong>{item.count} · {currency.format(item.revenue)}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <PanelHeader icon={UserRoundSearch} title="Quotes To Chase" />
        <div className="source-list">
          {quoteFollowUps.length ? quoteFollowUps.slice(0, 8).map((customer) => (
            <div key={customer.id}>
              <span>{customer.name} · {customer.address}</span>
              <strong>{quoteLabel(customer.status)} · {currency.format(customer.price)}</strong>
            </div>
          )) : <p className="empty-state">No quotes need chasing.</p>}
        </div>
      </section>
    </div>
  );
}

function MarketingView({
  addCampaign,
  markLeafleted,
  markMessageSent,
  state,
  updateCampaign,
  updateTemplate,
}: {
  addCampaign: () => void;
  markLeafleted: (street: Street) => void;
  markMessageSent: (customer: Customer) => void;
  state: AppState;
  updateCampaign: (campaignId: string, updates: Partial<AppState["campaigns"][number]>) => void;
  updateTemplate: (templateId: string, body: string) => void;
}) {
  const [selectedStreetId, setSelectedStreetId] = useState(state.streets[0]?.id ?? "");
  const [selectedTemplateId, setSelectedTemplateId] = useState(state.messageTemplates[0]?.id ?? "");
  const [audience, setAudience] = useState("quotes");
  const selectedStreet = state.streets.find((street) => street.id === selectedStreetId) ?? state.streets[0];
  const selectedTemplate = state.messageTemplates.find((template) => template.id === selectedTemplateId) ?? state.messageTemplates[0];
  const dueLeaflets = state.streets
    .map((street) => {
      const due = nextLeafletDate(street);
      return { street, due, days: due ? differenceInCalendarDays(due, TODAY) : 999 };
    })
    .filter((item) => item.days <= 7)
    .sort((a, b) => a.days - b.days)
    .slice(0, 6);
  const streetStats = selectedStreet ? buildStreetMarketingStats(selectedStreet, state) : undefined;
  const messageQueue = buildMessageAudience(audience, state).slice(0, 24);

  return (
    <div className="marketing-grid">
      <section className="panel wide">
        <PanelHeader icon={MapPinned} title="Leaflets Due This Week" />
        <div className="street-due-list">
          {dueLeaflets.length ? dueLeaflets.map((item) => (
            <div className="street-due-row" key={item.street.id}>
              <div>
                <strong>{item.street.name}</strong>
                <span>{item.street.area} - {item.street.housesEstimate} houses - {item.days < 0 ? `${Math.abs(item.days)} days overdue` : `due in ${item.days} days`}</span>
              </div>
              <button type="button" onClick={() => markLeafleted(item.street)}>Mark done</button>
            </div>
          )) : <p className="empty-state">No leaflet rounds due in the next 7 days.</p>}
        </div>
      </section>

      <section className="panel wide">
        <PanelHeader icon={TrendingUp} title="Street Marketing Tracker" />
        <label className="field-label">
          Street
          <select value={selectedStreet?.id ?? ""} onChange={(event) => setSelectedStreetId(event.target.value)}>
            {state.streets.map((street) => (
              <option key={street.id} value={street.id}>{street.area} - {street.name}</option>
            ))}
          </select>
        </label>
        {streetStats ? (
          <>
            <div className="street-value-grid">
              <MetricMini label="Monthly value" value={currency.format(streetStats.monthly)} />
              <MetricMini label="Yearly value" value={currency.format(streetStats.yearly)} />
              <MetricMini label="Lifetime value" value={currency.format(streetStats.lifetime)} />
              <MetricMini label="Customers/drop" value={streetStats.averageCustomersPerDrop.toFixed(1)} />
            </div>
            <div className="street-facts">
              <span>{streetStats.thisYearDrops} leaflet drops this year</span>
              <span>{streetStats.lastYearDrops} last year</span>
              <span>{streetStats.totalLeaflets} leaflets delivered</span>
              <span>{streetStats.leafletCustomers} customers from leaflets</span>
              <span>{streetStats.facebookCustomers} from Facebook</span>
              <span>{streetStats.googleCustomers} from Google</span>
              <span>{streetStats.quotes} quotes sent</span>
              <span>{streetStats.noReplies} no replies</span>
              <span>{streetStats.saidNo} said no</span>
            </div>
            <div className="reason-list">
              {streetStats.reasons.map((reason) => (
                <span key={reason.reason}>{reason.reason}: {reason.count}</span>
              ))}
            </div>
          </>
        ) : null}
      </section>

      <section className="panel">
        <PanelHeader icon={MessageSquareText} title="Message Queue" />
        <div className="message-controls">
          <label>
            Audience
            <select value={audience} onChange={(event) => setAudience(event.target.value)}>
              <option value="quotes">Quotes to chase</option>
              <option value="payments">Payments to chase</option>
              <option value="reviews">Review requests</option>
              <option value="tomorrow">Jobs tomorrow</option>
              <option value="phones">Everyone with phone</option>
            </select>
          </label>
          <label>
            Template
            <select value={selectedTemplate?.id ?? ""} onChange={(event) => setSelectedTemplateId(event.target.value)}>
              {state.messageTemplates.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="message-list">
          {messageQueue.length && selectedTemplate ? messageQueue.map((customer) => {
            const link = messageLink(customer, selectedTemplate);
            return (
              <div className="message-row" key={customer.id}>
                <div>
                  <strong>{customer.name}</strong>
                  <span>{customer.address} - {customer.phone || "No phone saved"}</span>
                </div>
                {link ? (
                  <a href={link} onClick={() => markMessageSent(customer)}>Send</a>
                ) : (
                  <span className="muted-pill">Add phone</span>
                )}
              </div>
            );
          }) : <p className="empty-state">No customers match this queue yet.</p>}
        </div>
      </section>

      <section className="panel">
        <PanelHeader icon={Save} title="Message Templates" />
        <div className="template-list">
          {state.messageTemplates.map((template) => (
            <label key={template.id}>
              {template.name}
              <textarea value={template.body} onChange={(event) => updateTemplate(template.id, event.target.value)} />
            </label>
          ))}
        </div>
      </section>

      <section className="panel full-width">
        <PanelHeader icon={Megaphone} title="Campaign Tracker" />
        <button type="button" className="secondary-action campaign-add" onClick={addCampaign}>Add campaign</button>
        <div className="campaign-table">
          {state.campaigns.map((campaign) => {
            const stats = buildCampaignStats(campaign.id, state);
            return (
              <article className="campaign-row" key={campaign.id}>
                <input value={campaign.name} onChange={(event) => updateCampaign(campaign.id, { name: event.target.value })} />
                <select value={campaign.source} onChange={(event) => updateCampaign(campaign.id, { source: event.target.value })}>
                  {sourceOptions.map((source) => (
                    <option key={source}>{source}</option>
                  ))}
                </select>
                <input type="number" min={0} value={campaign.spend} onChange={(event) => updateCampaign(campaign.id, { spend: Number(event.target.value) })} />
                <span>{stats.leads} leads</span>
                <span>{stats.customers} customers</span>
                <span>{currency.format(stats.monthly)} monthly</span>
                <span>{stats.customers ? currency.format(campaign.spend / stats.customers) : "n/a"} CAC</span>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function MapView({
  routePlan,
  state,
  updateCustomer,
}: {
  routePlan: RoutePlan;
  state: AppState;
  updateCustomer: (customerId: string, updates: Partial<Customer>) => void;
}) {
  const [movingCustomerId, setMovingCustomerId] = useState("");
  const movingCustomer = state.customers.find((customer) => customer.id === movingCustomerId);
  const routePositions = routePlan.optimised.map((customer) => [customer.lat, customer.lng] as [number, number]);

  function moveCustomerPin(lat: number, lng: number) {
    if (!movingCustomer) return;
    updateCustomer(movingCustomer.id, { lat, lng });
    setMovingCustomerId("");
  }

  return (
    <div className="map-layout">
      <section className="map-panel">
        <MapContainer center={[53.739, -0.455]} zoom={12} scrollWheelZoom className="territory-map">
          <PinMoveLayer active={Boolean(movingCustomer)} onMove={moveCustomerPin} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {state.streets.map((street) => (
            <CircleMarker
              key={street.id}
              center={[street.lat, street.lng]}
              radius={11 + Math.min(7, street.leafletCount)}
              pathOptions={{
                color: tierColors[street.tier],
                fillColor: tierColors[street.tier],
                fillOpacity: 0.28,
                weight: 3,
              }}
            >
              <Tooltip>
                <strong>{street.name}</strong><br />
                {street.area} · {tierLabels[street.tier]}<br />
                {street.leafletCount} leaflet rounds
              </Tooltip>
            </CircleMarker>
          ))}

          {state.customers.map((customer) => (
            <CircleMarker
              key={customer.id}
              center={[customer.lat, customer.lng]}
              radius={customer.status === "active" ? 6 : 5}
              pathOptions={{
                color: customer.status === "cancelled" ? "#ef4444" : "#166534",
                fillColor: customer.paymentStatus === "overdue"
                  ? "#111827"
                  : customer.status === "cancelled" || customer.status === "declined"
                    ? "#ef4444"
                    : chaseStatuses.includes(customer.status)
                      ? "#f59e0b"
                      : "#22c55e",
                fillOpacity: 0.82,
                weight: 1.5,
              }}
            >
              <Tooltip>
                <strong>{customer.name}</strong><br />
                {customer.address}<br />
                {currency.format(customer.price)} - {quoteLabel(customer.status)}
              </Tooltip>
              <Popup>
                <div className="marker-popup">
                  <strong>{customer.name}</strong>
                  <span>{customer.address}</span>
                  <span>{customer.area} - {currency.format(customer.price)} every {customer.frequencyWeeks} weeks</span>
                  <span>{formatShortDate(format(nextJobDate(customer) ?? TODAY, "yyyy-MM-dd"))} - {quoteLabel(customer.status)}</span>
                  <button type="button" onClick={() => setMovingCustomerId(customer.id)}>Move pin</button>
                </div>
              </Popup>
            </CircleMarker>
          ))}

          {routePositions.length > 1 && (
            <Polyline positions={routePositions} pathOptions={{ color: "#0f766e", weight: 4, opacity: 0.72 }} />
          )}
        </MapContainer>
      </section>

      <aside className="map-side">
        <PanelHeader icon={MapPinned} title="Map Legend" />
        <Legend />
        <div className="pin-panel">
          <label>
            Fix customer pin
            <select value={movingCustomerId} onChange={(event) => setMovingCustomerId(event.target.value)}>
              <option value="">Choose customer</option>
              {state.customers
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} - {customer.address}
                  </option>
                ))}
            </select>
          </label>
          {movingCustomer ? (
            <div className="pin-active">
              <strong>{movingCustomer.name}</strong>
              <span>{movingCustomer.address}</span>
              <button type="button" onClick={() => setMovingCustomerId("")}>Cancel move</button>
            </div>
          ) : null}
        </div>
        <div className="route-summary side">
          <strong>{routePlan.optimised.length} route stops</strong>
          <span>{routePlan.optimisedKm.toFixed(1)} km optimised · {routePlan.minutesSaved} min saved</span>
        </div>
      </aside>
    </div>
  );
}

function PinMoveLayer({ active, onMove }: { active: boolean; onMove: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(event) {
      if (!active) return;
      onMove(event.latlng.lat, event.latlng.lng);
    },
  });

  return null;
}

function StreetsView({
  leafletDue,
  markLeafleted,
  state,
}: {
  leafletDue: Array<{ street: Street; due: Date; score: number; days: number }>;
  markLeafleted: (street: Street) => void;
  state: AppState;
}) {
  const dueLookup = new Map(leafletDue.map((item) => [item.street.id, item]));
  const sorted = [...state.streets].sort(
    (a, b) => streetScore(b, state.customers, state.leafletDrops) - streetScore(a, state.customers, state.leafletDrops),
  );

  return (
    <section className="street-grid">
      {sorted.map((street) => {
        const active = state.customers.filter(
          (customer) => customer.status === "active" && normalise(customer.street) === normalise(street.name),
        );
        const cancelled = state.customers.filter(
          (customer) => customer.status === "cancelled" && normalise(customer.street) === normalise(street.name),
        );
        const score = streetScore(street, state.customers, state.leafletDrops);
        const due = dueLookup.get(street.id)?.due ?? nextLeafletDate(street);
        const monthly = active.reduce((sum, customer) => sum + monthlyRevenue(customer), 0);
        const yearly = active.reduce((sum, customer) => sum + yearlyRevenue(customer), 0);

        return (
          <article className="street-card" key={street.id}>
            <div className="street-card-top">
              <span className="tier-pill" style={{ backgroundColor: tierColors[street.tier] }}>{street.tier}</span>
              <button type="button" onClick={() => markLeafleted(street)}>Mark leafleted</button>
            </div>
            <h2>{street.name}</h2>
            <p>{street.area} · every {tierCadenceWeeks[street.tier] || "off"} weeks</p>
            <div className="street-stats">
              <span><strong>{active.length}</strong> active</span>
              <span><strong>{cancelled.length}</strong> cancelled</span>
              <span><strong>{score}</strong> score</span>
              <span><strong>{currency.format(monthly)}</strong> monthly</span>
              <span><strong>{currency.format(yearly)}</strong> yearly</span>
              <span><strong>{street.leafletCount}</strong> drops</span>
            </div>
            <footer>
              <span>{street.notes || "No notes"}</span>
              <strong>{due ? formatShortDate(format(due, "yyyy-MM-dd")) : "No leaflet"}</strong>
            </footer>
          </article>
        );
      })}
    </section>
  );
}

function CustomersView({
  customerQuery,
  customers,
  markJobDone,
  markMessageSent,
  messageTemplates,
  setCustomerQuery,
  updateCustomer,
}: {
  customerQuery: string;
  customers: Customer[];
  markJobDone: (customer: Customer) => void;
  markMessageSent: (customer: Customer) => void;
  messageTemplates: MessageTemplate[];
  setCustomerQuery: (value: string) => void;
  updateCustomer: (customerId: string, updates: Partial<Customer>) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Customer>>({});
  const quickTemplate = messageTemplates.find((template) => template.id === "template-quote-follow-up") ?? messageTemplates[0];

  function startEdit(customer: Customer) {
    setEditingId(customer.id);
    setDraft({
      name: customer.name,
      address: customer.address,
      area: customer.area,
      frequencyWeeks: customer.frequencyWeeks,
      price: customer.price,
      nextDueDate: customer.nextDueDate ?? format(nextJobDate(customer) ?? TODAY, "yyyy-MM-dd"),
      phone: customer.phone ?? "",
      source: customer.source,
      campaignId: customer.campaignId,
      status: customer.status,
      paymentStatus: customer.paymentStatus,
      routeDay: customer.routeDay,
      quoteReason: customer.quoteReason ?? "",
      notes: customer.notes ?? "",
    });
  }

  function saveEdit(customer: Customer) {
    updateCustomer(customer.id, draft);
    setEditingId(null);
    setDraft({});
  }

  return (
    <section className="panel full">
      <div className="searchbar">
        <Search size={18} />
        <input
          value={customerQuery}
          onChange={(event) => setCustomerQuery(event.target.value)}
          placeholder="Search customers, streets, areas, sources"
        />
      </div>
      <div className="customer-table">
        <div className="customer-table-head">
          <span>Name</span>
          <span>Address</span>
          <span>Job</span>
          <span>Actions</span>
        </div>
        {customers.map((customer) => (
          <article className="customer-record" key={customer.id}>
          <div className="customer-row">
            <span>
              <strong>{customer.name}</strong>
              <small>{customer.source}</small>
            </span>
            <span>
              {customer.address}
              <small>{customer.area} · {customer.routeDay}</small>
            </span>
            <span>
              {currency.format(customer.price)}
              <small>{formatShortDate(format(nextJobDate(customer) ?? TODAY, "yyyy-MM-dd"))} - every {customer.frequencyWeeks} weeks</small>
            </span>
            <span className="row-actions">
              <StatusBadge status={customer.status} />
              <small>{customer.paymentStatus}</small>
              <button type="button" className="icon-button small" onClick={() => startEdit(customer)} title="Edit job">
                <Pencil size={16} />
              </button>
              <button type="button" className="text-button" onClick={() => markJobDone(customer)}>
                Done today
              </button>
              {quickTemplate && customer.phone ? (
                <a className="text-button" href={messageLink(customer, quickTemplate)} onClick={() => markMessageSent(customer)}>
                  Message
                </a>
              ) : null}
            </span>
          </div>

          {editingId === customer.id && (
            <form
              className="edit-panel"
              onSubmit={(event) => {
                event.preventDefault();
                saveEdit(customer);
              }}
            >
              <label>
                Name
                <input value={draft.name ?? ""} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
              </label>
              <label>
                Address
                <input value={draft.address ?? ""} onChange={(event) => setDraft((current) => ({ ...current, address: event.target.value }))} />
              </label>
              <label>
                Area
                <input value={draft.area ?? ""} onChange={(event) => setDraft((current) => ({ ...current, area: event.target.value }))} />
              </label>
              <label>
                Phone
                <input value={draft.phone ?? ""} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} placeholder="07..." />
              </label>
              <label>
                Next due
                <input type="date" value={draft.nextDueDate ?? ""} onChange={(event) => setDraft((current) => ({ ...current, nextDueDate: event.target.value }))} />
              </label>
              <label>
                Frequency
                <select value={draft.frequencyWeeks ?? 4} onChange={(event) => setDraft((current) => ({ ...current, frequencyWeeks: Number(event.target.value) }))}>
                  <option value={1}>1 week</option>
                  <option value={2}>2 weeks</option>
                  <option value={4}>4 weeks</option>
                  <option value={6}>6 weeks</option>
                  <option value={8}>8 weeks</option>
                  <option value={12}>12 weeks</option>
                </select>
              </label>
              <label>
                Price
                <input type="number" min={0} value={draft.price ?? 0} onChange={(event) => setDraft((current) => ({ ...current, price: Number(event.target.value) }))} />
              </label>
              <label>
                Status
                <select value={draft.status ?? "active"} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as Customer["status"] }))}>
                  <option value="active">Active</option>
                  <option value="lead">Enquiry</option>
                  <option value="quoted">Quoted</option>
                  <option value="ignored">Ignored</option>
                  <option value="declined">Said no</option>
                  <option value="paused">Paused</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
              <label>
                Source
                <select value={draft.source ?? "Leaflet"} onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value, campaignId: campaignForSource(event.target.value) }))}>
                  {sourceOptions.map((source) => (
                    <option key={source}>{source}</option>
                  ))}
                </select>
              </label>
              <label>
                Payment
                <select value={draft.paymentStatus ?? "paid"} onChange={(event) => setDraft((current) => ({ ...current, paymentStatus: event.target.value as PaymentStatus }))}>
                  <option value="paid">Paid</option>
                  <option value="due">Due</option>
                  <option value="overdue">Overdue</option>
                  <option value="watch">Watch</option>
                </select>
              </label>
              <label>
                Route day
                <select value={draft.routeDay ?? "Monday"} onChange={(event) => setDraft((current) => ({ ...current, routeDay: event.target.value }))}>
                  <option>Monday</option>
                  <option>Tuesday</option>
                  <option>Wednesday</option>
                  <option>Thursday</option>
                  <option>Friday</option>
                  <option>Saturday</option>
                  </select>
                </label>
                <label>
                  Quote reason
                  <select value={draft.quoteReason ?? ""} onChange={(event) => setDraft((current) => ({ ...current, quoteReason: event.target.value }))}>
                    {quoteReasons.map((reason) => (
                      <option key={reason} value={reason}>{reason || "None"}</option>
                    ))}
                  </select>
                </label>
                <label className="edit-notes">
                Notes
                <input value={draft.notes ?? ""} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} />
              </label>
              <div className="edit-actions">
                <button type="submit" className="primary-action">
                  <Save size={16} />
                  Save
                </button>
                <button type="button" className="secondary-action" onClick={() => setEditingId(null)}>
                  <X size={16} />
                  Cancel
                </button>
              </div>
            </form>
          )}
          </article>
        ))}
      </div>
    </section>
  );
}

function AddView({
  addCustomer,
  customerForm,
  dropForm,
  logLeafletDrop,
  setCustomerForm,
  setDropForm,
  state,
}: {
  addCustomer: (event: React.FormEvent) => void;
  customerForm: typeof blankCustomer;
  dropForm: { streetId: string; amount: number; date: string; leafletVersion: string };
  logLeafletDrop: (event: React.FormEvent) => void;
  setCustomerForm: React.Dispatch<React.SetStateAction<typeof blankCustomer>>;
  setDropForm: React.Dispatch<React.SetStateAction<{ streetId: string; amount: number; date: string; leafletVersion: string }>>;
  state: AppState;
}) {
  return (
    <div className="form-grid">
      <section className="panel">
        <PanelHeader icon={Plus} title="Add Customer" />
        <form className="data-form" onSubmit={addCustomer}>
          <label>
            Name
            <input value={customerForm.name} onChange={(event) => setCustomerForm((form) => ({ ...form, name: event.target.value }))} required />
          </label>
          <label>
            Address
            <input value={customerForm.address} onChange={(event) => setCustomerForm((form) => ({ ...form, address: event.target.value }))} required />
          </label>
          <label>
            Phone
            <input value={customerForm.phone} onChange={(event) => setCustomerForm((form) => ({ ...form, phone: event.target.value }))} placeholder="07..." />
          </label>
          <label>
            Area
            <input value={customerForm.area} onChange={(event) => setCustomerForm((form) => ({ ...form, area: event.target.value }))} required />
          </label>
          <div className="split">
            <label>
              Frequency
              <select value={customerForm.frequencyWeeks} onChange={(event) => setCustomerForm((form) => ({ ...form, frequencyWeeks: Number(event.target.value) }))}>
                <option value={4}>4 weeks</option>
                <option value={6}>6 weeks</option>
                <option value={8}>8 weeks</option>
                <option value={12}>12 weeks</option>
              </select>
            </label>
            <label>
              Price
              <input type="number" min={0} value={customerForm.price} onChange={(event) => setCustomerForm((form) => ({ ...form, price: Number(event.target.value) }))} />
            </label>
          </div>
          <label>
            Source
            <select value={customerForm.source} onChange={(event) => setCustomerForm((form) => ({ ...form, source: event.target.value, campaignId: campaignForSource(event.target.value) ?? form.campaignId }))}>
              {sourceOptions.map((source) => (
                <option key={source}>{source}</option>
              ))}
            </select>
          </label>
          <label>
            Campaign
            <select value={customerForm.campaignId} onChange={(event) => setCustomerForm((form) => ({ ...form, campaignId: event.target.value }))}>
              <option value="">No campaign</option>
              {state.campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
              ))}
            </select>
          </label>
          <label>
            Next due date
            <input type="date" value={customerForm.nextDueDate} onChange={(event) => setCustomerForm((form) => ({ ...form, nextDueDate: event.target.value }))} />
          </label>
          <div className="split">
            <label>
              Status
              <select value={customerForm.status} onChange={(event) => setCustomerForm((form) => ({ ...form, status: event.target.value as Customer["status"] }))}>
              <option value="active">Active</option>
              <option value="lead">Enquiry</option>
              <option value="quoted">Quoted</option>
              <option value="ignored">Ignored</option>
              <option value="declined">Said no</option>
              <option value="paused">Paused</option>
              <option value="cancelled">Cancelled</option>
            </select>
            </label>
            <label>
              Payment
              <select value={customerForm.paymentStatus} onChange={(event) => setCustomerForm((form) => ({ ...form, paymentStatus: event.target.value as PaymentStatus }))}>
                <option value="paid">Paid</option>
                <option value="due">Due</option>
                <option value="overdue">Overdue</option>
                <option value="watch">Watch</option>
              </select>
            </label>
          </div>
          <label>
            Notes
            <input value={customerForm.notes} onChange={(event) => setCustomerForm((form) => ({ ...form, notes: event.target.value }))} placeholder="Quoted, said no, needs chase, gate code" />
          </label>
          <label>
            Quote reason
            <select value={customerForm.quoteReason} onChange={(event) => setCustomerForm((form) => ({ ...form, quoteReason: event.target.value }))}>
              {quoteReasons.map((reason) => (
                <option key={reason} value={reason}>{reason || "None"}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="primary-action">Add customer</button>
        </form>
      </section>

      <section className="panel">
        <PanelHeader icon={MapPinned} title="Log Leaflet Drop" />
        <form className="data-form" onSubmit={logLeafletDrop}>
          <label>
            Street
            <select value={dropForm.streetId} onChange={(event) => setDropForm((form) => ({ ...form, streetId: event.target.value }))}>
              {state.streets.map((street) => (
                <option key={street.id} value={street.id}>{street.area} · {street.name}</option>
              ))}
            </select>
          </label>
          <div className="split">
            <label>
              Date
              <input type="date" value={dropForm.date} onChange={(event) => setDropForm((form) => ({ ...form, date: event.target.value }))} />
            </label>
            <label>
              Amount
              <input type="number" min={1} value={dropForm.amount} onChange={(event) => setDropForm((form) => ({ ...form, amount: Number(event.target.value) }))} />
            </label>
          </div>
          <label>
            Leaflet
            <input value={dropForm.leafletVersion} onChange={(event) => setDropForm((form) => ({ ...form, leafletVersion: event.target.value }))} />
          </label>
          <button type="submit" className="primary-action">Log drop</button>
        </form>
      </section>
    </div>
  );
}

function MetricCard({ detail, icon: Icon, label, value }: { detail: string; icon: typeof Users; label: string; value: string }) {
  return (
    <article className="metric-card">
      <div className="metric-icon"><Icon size={20} /></div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function MetricMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-mini">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PanelHeader({ icon: Icon, title }: { icon: typeof Users; title: string }) {
  return (
    <div className="panel-header">
      <Icon size={18} />
      <h2>{title}</h2>
    </div>
  );
}

function ReminderList({ rows }: { rows: Array<{ title: string; detail: string; tone: "job" | "leaflet" | "payment" | "review" | "quote" }> }) {
  if (!rows.length) {
    return <p className="empty-state">Nothing urgent is waiting.</p>;
  }

  return (
    <div className="reminder-list">
      {rows.map((row, index) => (
        <div className={`reminder ${row.tone}`} key={`${row.title}-${index}`}>
          <AlertTriangle size={16} />
          <span>
            <strong>{row.title}</strong>
            <small>{row.detail}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: Customer["status"] }) {
  return <span className={`status-badge ${status}`}>{status}</span>;
}

function quoteLabel(status: Customer["status"]) {
  return {
    active: "active customer",
    cancelled: "cancelled",
    lead: "enquiry",
    quoted: "quoted",
    ignored: "ignored",
    declined: "said no",
    paused: "paused",
  }[status];
}

function Legend() {
  const tiers = Object.entries(tierColors) as Array<[Tier, string]>;
  return (
    <div className="legend">
      {tiers.map(([tier, color]) => (
        <span key={tier}><i style={{ backgroundColor: color }} />{tierLabels[tier]}</span>
      ))}
      <span><i style={{ backgroundColor: "#22c55e" }} />Active customer</span>
      <span><i style={{ backgroundColor: "#ef4444" }} />Cancelled</span>
      <span><i style={{ backgroundColor: "#111827" }} />Overdue payment</span>
    </div>
  );
}

function pageTitle(view: ViewKey) {
  return {
    dashboard: "Business dashboard",
    map: "Territory map",
    streets: "Street engine",
    customers: "Customer database",
    marketing: "Marketing tracker",
    add: "Add and log",
  }[view];
}

function buildStreetMarketingStats(street: Street, state: AppState) {
  const thisYear = TODAY.getFullYear();
  const related = state.customers.filter((customer) => normalise(customer.street) === normalise(street.name));
  const active = related.filter((customer) => customer.status === "active");
  const drops = state.leafletDrops.filter((drop) => drop.streetId === street.id);
  const leafletCustomers = related.filter((customer) => sourceMatches(customer, "leaflet") && customer.status === "active");
  const facebookCustomers = related.filter((customer) => sourceMatches(customer, "facebook") && customer.status === "active");
  const googleCustomers = related.filter((customer) => sourceMatches(customer, "google") && customer.status === "active");
  const quoted = related.filter((customer) => ["lead", "quoted", "ignored", "declined"].includes(customer.status));
  const reasons = Array.from(
    quoted.reduce((map, customer) => {
      const reason = customer.quoteReason || (customer.status === "ignored" ? "No reply" : customer.status === "declined" ? "No reason given" : "Open");
      map.set(reason, (map.get(reason) ?? 0) + 1);
      return map;
    }, new Map<string, number>()),
  ).map(([reason, count]) => ({ reason, count }));

  return {
    active: active.length,
    monthly: active.reduce((sum, customer) => sum + monthlyRevenue(customer), 0),
    yearly: active.reduce((sum, customer) => sum + yearlyRevenue(customer), 0),
    lifetime: active.reduce((sum, customer) => sum + lifetimeValue(customer), 0),
    thisYearDrops: drops.filter((drop) => new Date(`${drop.date}T12:00:00`).getFullYear() === thisYear).length,
    lastYearDrops: drops.filter((drop) => new Date(`${drop.date}T12:00:00`).getFullYear() === thisYear - 1).length,
    totalLeaflets: drops.reduce((sum, drop) => sum + drop.amount, 0),
    averageCustomersPerDrop: drops.length ? leafletCustomers.length / drops.length : 0,
    leafletCustomers: leafletCustomers.length,
    facebookCustomers: facebookCustomers.length,
    googleCustomers: googleCustomers.length,
    quotes: quoted.length,
    noReplies: quoted.filter((customer) => customer.status === "ignored" || customer.quoteReason === "No reply").length,
    saidNo: quoted.filter((customer) => customer.status === "declined").length,
    reasons,
  };
}

function buildMessageAudience(audience: string, state: AppState) {
  if (audience === "payments") {
    return state.customers.filter((customer) => ["due", "overdue"].includes(customer.paymentStatus));
  }

  if (audience === "reviews") {
    return state.customers.filter((customer) => {
      const days = differenceInCalendarDays(TODAY, new Date(`${customer.startDate}T12:00:00`));
      return customer.status === "active" && days >= 21;
    });
  }

  if (audience === "tomorrow") {
    const tomorrow = addDays(TODAY, 1);
    return state.customers.filter((customer) => {
      const due = nextJobDate(customer);
      return customer.status === "active" && Boolean(due) && differenceInCalendarDays(due!, tomorrow) === 0;
    });
  }

  if (audience === "phones") {
    return state.customers.filter((customer) => Boolean(customer.phone));
  }

  return state.customers.filter((customer) => chaseStatuses.includes(customer.status));
}

function buildCampaignStats(campaignId: string, state: AppState) {
  const related = state.customers.filter((customer) => customer.campaignId === campaignId);
  const active = related.filter((customer) => customer.status === "active");
  return {
    leads: related.length,
    customers: active.length,
    monthly: active.reduce((sum, customer) => sum + monthlyRevenue(customer), 0),
    yearly: active.reduce((sum, customer) => sum + yearlyRevenue(customer), 0),
    lifetime: active.reduce((sum, customer) => sum + lifetimeValue(customer), 0),
  };
}

function estimatedHourly(customer: Customer) {
  const minutes = customer.price <= 10 ? 20 : customer.price <= 15 ? 28 : customer.price <= 20 ? 35 : 45;
  return customer.price / (minutes / 60);
}

function routeDistance(customers: Customer[]) {
  if (!customers.length) return 0;
  let total = 0;
  let current: [number, number] = [53.7245, -0.4388];
  for (const customer of customers) {
    const next: [number, number] = [customer.lat, customer.lng];
    total += distanceKm(current, next);
    current = next;
  }
  return total;
}

type RoutePlan = {
  jobs: Customer[];
  optimised: Customer[];
  originalKm: number;
  optimisedKm: number;
  minutesSaved: number;
};

function buildDueJobsPlaceholder() {
  return {
    overdueJobs: [] as Array<{ customer: Customer; due: Date }>,
    tomorrowJobs: [] as Array<{ customer: Customer; due: Date }>,
    weekJobs: [] as Array<{ customer: Customer; due: Date }>,
  };
}
