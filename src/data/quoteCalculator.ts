import type { QuoteCalculatorConfig } from "../types";

export const defaultQuoteCalculatorConfig: QuoteCalculatorConfig = {
  items: [
    { id: "small-window", name: "Small window", unitPrice: 1 },
    { id: "standard-window", name: "Standard window", unitPrice: 1.5 },
    { id: "large-window", name: "Large window", unitPrice: 2 },
    { id: "bay-window", name: "Bay window", unitPrice: 3 },
    { id: "standard-door", name: "Standard door", unitPrice: 1.5 },
    { id: "patio-french-doors", name: "Patio/French doors", unitPrice: 2.5 },
    { id: "lower-storey-velux", name: "Lower-storey Velux", unitPrice: 2.5 },
    { id: "conservatory-panel-window", name: "Conservatory panel/window", unitPrice: 1.25 },
  ],
  minimumCharge: 10,
  frequencyMultipliers: {
    sixWeekly: 1,
    twelveWeekly: 1.5,
    oneOff: 2,
  },
};
