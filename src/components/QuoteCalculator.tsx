import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, RotateCcw, Save, Settings2 } from "lucide-react";
import type { QuoteCalculatorConfig, QuoteFrequencyKey } from "../types";
import {
  calculateQuote,
  createZeroQuantities,
  formatQuoteMoney,
  normaliseQuoteConfig,
  quoteFrequencyLabels,
  quoteFrequencyOrder,
} from "../utils/quoteCalculator";

type QuoteCalculatorProps = {
  config: QuoteCalculatorConfig;
  onSaveConfig: (config: QuoteCalculatorConfig) => void;
};

export function QuoteCalculator({ config, onSaveConfig }: QuoteCalculatorProps) {
  const [quantities, setQuantities] = useState(() => createZeroQuantities(config));
  const [frequency, setFrequency] = useState<QuoteFrequencyKey>("sixWeekly");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftConfig, setDraftConfig] = useState(() => normaliseQuoteConfig(config));
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    setDraftConfig(normaliseQuoteConfig(config));
  }, [config]);

  const quote = useMemo(() => calculateQuote(config, quantities, frequency), [config, frequency, quantities]);

  function changeQuantity(itemId: string, delta: number) {
    setQuantities((current) => ({
      ...current,
      [itemId]: Math.max(0, (current[itemId] ?? 0) + delta),
    }));
  }

  function resetQuote() {
    setQuantities(createZeroQuantities(config));
  }

  function updateUnitPrice(itemId: string, value: string) {
    setDraftConfig((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === itemId ? { ...item, unitPrice: Number(value) } : item)),
    }));
  }

  function updateMinimumCharge(value: string) {
    setDraftConfig((current) => ({ ...current, minimumCharge: Number(value) }));
  }

  function updateMultiplier(key: QuoteFrequencyKey, value: string) {
    setDraftConfig((current) => ({
      ...current,
      frequencyMultipliers: {
        ...current.frequencyMultipliers,
        [key]: Number(value),
      },
    }));
  }

  function savePrices() {
    const nextConfig = normaliseQuoteConfig(draftConfig);
    onSaveConfig(nextConfig);
    setSavedMessage("Prices saved");
    window.setTimeout(() => setSavedMessage(""), 2600);
  }

  return (
    <div className="quote-calculator">
      <section className="panel quote-panel">
        <div className="quote-toolbar">
          <div>
            <h2>Window quote</h2>
            <span>{quoteFrequencyLabels[frequency]} pricing</span>
          </div>
          <button className="secondary-action quote-settings-toggle" type="button" onClick={() => setSettingsOpen((open) => !open)}>
            <Settings2 size={18} />
            <span>Edit Prices</span>
          </button>
        </div>

        <div className="frequency-selector" aria-label="Frequency">
          {quoteFrequencyOrder.map((key) => (
            <button
              className={frequency === key ? "active" : ""}
              key={key}
              onClick={() => setFrequency(key)}
              type="button"
            >
              {quoteFrequencyLabels[key]}
            </button>
          ))}
        </div>

        <div className="quote-items">
          {config.items.map((item) => {
            const quantity = quantities[item.id] ?? 0;
            return (
              <article className="quote-item-row" key={item.id}>
                <div className="quote-item-info">
                  <strong>{item.name}</strong>
                  <span>{formatQuoteMoney(item.unitPrice)}</span>
                </div>
                <div className="quote-stepper">
                  <button type="button" onClick={() => changeQuantity(item.id, -1)} aria-label={`Decrease ${item.name}`}>
                    <Minus size={24} />
                  </button>
                  <strong>{quantity}</strong>
                  <button type="button" onClick={() => changeQuantity(item.id, 1)} aria-label={`Increase ${item.name}`}>
                    <Plus size={24} />
                  </button>
                </div>
                <strong className="quote-line-total">{formatQuoteMoney(quote.lineTotals[item.id] ?? 0)}</strong>
              </article>
            );
          })}
        </div>

        <div className="quote-summary">
          <div>
            <span>Base Price</span>
            <strong>{formatQuoteMoney(quote.basePrice)}</strong>
          </div>
          <div>
            <span>Multiplier</span>
            <strong>x{quote.multiplier}</strong>
          </div>
        </div>

        <div className="final-quote">
          <span>Final Quote</span>
          <strong>£{quote.finalQuote}</strong>
        </div>

        <button className="secondary-action quote-reset" type="button" onClick={resetQuote}>
          <RotateCcw size={18} />
          <span>Reset Quote</span>
        </button>
      </section>

      {settingsOpen && (
        <section className="panel quote-settings-panel">
          <div className="quote-toolbar">
            <div>
              <h2>Settings / Edit Prices</h2>
              <span>Saved pricing</span>
            </div>
            {savedMessage && <strong className="save-confirmation">{savedMessage}</strong>}
          </div>

          <div className="quote-settings-list">
            {draftConfig.items.map((item) => (
              <label className="quote-price-field" key={item.id}>
                <span>{item.name}</span>
                <input
                  type="number"
                  min="0"
                  step="0.05"
                  inputMode="decimal"
                  value={Number.isFinite(item.unitPrice) ? item.unitPrice : ""}
                  onChange={(event) => updateUnitPrice(item.id, event.target.value)}
                />
              </label>
            ))}
          </div>

          <div className="quote-settings-grid">
            <label className="quote-price-field">
              <span>Minimum Charge</span>
              <input
                type="number"
                min="0"
                step="0.5"
                inputMode="decimal"
                value={Number.isFinite(draftConfig.minimumCharge) ? draftConfig.minimumCharge : ""}
                onChange={(event) => updateMinimumCharge(event.target.value)}
              />
            </label>

            {quoteFrequencyOrder.map((key) => (
              <label className="quote-price-field" key={key}>
                <span>{quoteFrequencyLabels[key]} multiplier</span>
                <input
                  type="number"
                  min="0"
                  step="0.05"
                  inputMode="decimal"
                  value={Number.isFinite(draftConfig.frequencyMultipliers[key]) ? draftConfig.frequencyMultipliers[key] : ""}
                  onChange={(event) => updateMultiplier(key, event.target.value)}
                />
              </label>
            ))}
          </div>

          <button className="primary-action quote-save-button" type="button" onClick={savePrices}>
            <Save size={18} />
            <span>Save Prices</span>
          </button>
        </section>
      )}
    </div>
  );
}
