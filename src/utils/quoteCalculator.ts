import type { QuoteCalculatorConfig, QuoteFrequencyKey } from "../types";
import { defaultQuoteCalculatorConfig } from "../data/quoteCalculator";

export type QuoteQuantities = Record<string, number>;

export const quoteFrequencyLabels: Record<QuoteFrequencyKey, string> = {
  sixWeekly: "6-weekly",
  twelveWeekly: "12-weekly",
  oneOff: "One-off",
};

export const quoteFrequencyOrder: QuoteFrequencyKey[] = ["sixWeekly", "twelveWeekly", "oneOff"];

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatQuoteMoney(value: number) {
  return money.format(Number.isFinite(value) ? value : 0);
}

export function normaliseQuoteConfig(config?: Partial<QuoteCalculatorConfig>): QuoteCalculatorConfig {
  const savedItems = config?.items ?? [];

  return {
    items: defaultQuoteCalculatorConfig.items.map((defaultItem) => {
      const saved = savedItems.find((item) => item.id === defaultItem.id);
      return {
        ...defaultItem,
        ...saved,
        unitPrice: cleanNumber(saved?.unitPrice, defaultItem.unitPrice),
      };
    }),
    minimumCharge: cleanNumber(config?.minimumCharge, defaultQuoteCalculatorConfig.minimumCharge),
    frequencyMultipliers: {
      sixWeekly: cleanNumber(
        config?.frequencyMultipliers?.sixWeekly,
        defaultQuoteCalculatorConfig.frequencyMultipliers.sixWeekly,
      ),
      twelveWeekly: cleanNumber(
        config?.frequencyMultipliers?.twelveWeekly,
        defaultQuoteCalculatorConfig.frequencyMultipliers.twelveWeekly,
      ),
      oneOff: cleanNumber(config?.frequencyMultipliers?.oneOff, defaultQuoteCalculatorConfig.frequencyMultipliers.oneOff),
    },
  };
}

export function createZeroQuantities(config: QuoteCalculatorConfig): QuoteQuantities {
  return Object.fromEntries(config.items.map((item) => [item.id, 0]));
}

export function calculateQuote(config: QuoteCalculatorConfig, quantities: QuoteQuantities, frequency: QuoteFrequencyKey) {
  const lineTotals = Object.fromEntries(
    config.items.map((item) => [item.id, (quantities[item.id] ?? 0) * item.unitPrice]),
  );
  const rawBasePrice = Object.values(lineTotals).reduce((sum, value) => sum + value, 0);
  const hasItems = Object.values(quantities).some((quantity) => quantity > 0);
  const basePrice = hasItems ? Math.max(rawBasePrice, config.minimumCharge) : 0;
  const multiplier = config.frequencyMultipliers[frequency] ?? 1;
  const finalQuote = Math.round(basePrice * multiplier);

  return {
    lineTotals,
    rawBasePrice,
    basePrice,
    multiplier,
    finalQuote,
  };
}

function cleanNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}
