const VERSION = "1.0.3";

const PERIODS = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "total", label: "Total" },
];

class CathcartEnergyCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._period = "today";
    this._selected = null;
    this._stats = null;
    this._loadToken = 0;
  }

  static getStubConfig() {
    return { rate: "input_number.uk_electricity_unit_rate", devices: [] };
  }

  setConfig(config) {
    if (!config?.rate) throw new Error("cathcart-energy-card requires rate");
    if (!Array.isArray(config.devices) || !config.devices.length) {
      throw new Error("cathcart-energy-card requires devices");
    }
    this._config = config;
    this._stats = null;
    this._selected = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config || this._loading) return;
    const stamp = `${hass.states[this._config.rate]?.state}|${this._config.devices.map((device) => hass.states[device.energy]?.state).join("|")}`;
    const due = !this._fetchedAt || Date.now() - this._fetchedAt > 60000;
    if (!this._stats || due) {
      this._stamp = stamp;
      this._fetchedAt = Date.now();
      this._loading = true;
      this._load().finally(() => { this._loading = false; });
      return;
    }
    if (stamp !== this._stamp) {
      this._stamp = stamp;
      this._render();
    }
  }

  getCardSize() {
    return 10;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: 14, min_rows: 10 };
  }

  _num(entity) {
    const value = Number(this._hass?.states?.[entity]?.state);
    return Number.isFinite(value) ? value : null;
  }

  _rate() {
    return this._num(this._config.rate) ?? 0;
  }

  _escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  _money(value) {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value || 0);
  }

  _kwh(value) {
    const number = Number(value) || 0;
    return `${number.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kWh`;
  }

  _range() {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    if (this._period === "today") {
      return { start, period: "hour", buckets: this._hourBuckets(start) };
    }
    if (this._period === "week") {
      const monday = new Date(start);
      monday.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      return { start: monday, period: "day", buckets: this._dayBuckets(monday, 7) };
    }
    if (this._period === "month") {
      const first = new Date(start.getFullYear(), start.getMonth(), 1);
      const days = start.getDate();
      return { start: first, period: "day", buckets: this._dayBuckets(first, days) };
    }
    const first = new Date(start.getFullYear(), start.getMonth() - 5, 1);
    return { start: first, period: "month", buckets: this._monthBuckets(first, 6) };
  }

  _hourBuckets(start) {
    return Array.from({ length: 24 }, (_, hour) => {
      const date = new Date(start);
      date.setHours(hour);
      return { key: this._key(date, "hour"), label: hour % 6 === 0 ? String(hour) : "", date };
    });
  }

  _dayBuckets(start, count) {
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const label = this._period === "week"
        ? ["M", "T", "W", "T", "F", "S", "S"][index]
        : (index === 0 || date.getDate() % 5 === 0 ? String(date.getDate()) : "");
      return { key: this._key(date, "day"), label, date };
    });
  }

  _monthBuckets(start, count) {
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(start.getFullYear(), start.getMonth() + index, 1);
      return {
        key: this._key(date, "month"),
        label: date.toLocaleDateString("en-GB", { month: "short" }),
        date,
      };
    });
  }

  _key(date, period) {
    if (period === "hour") return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
    if (period === "day") return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    return `${date.getFullYear()}-${date.getMonth()}`;
  }

  async _load() {
    if (!this._hass || !this._config) return;
    const token = ++this._loadToken;
    const { start, period } = this._range();
    try {
      const result = await this._hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: start.toISOString(),
        statistic_ids: this._config.devices.map((device) => device.energy),
        period,
        types: ["change"],
      });
      if (token !== this._loadToken) return;
      this._stats = result || {};
      if (this._selected == null) this._selected = this._latestBucket();
      this._render();
    } catch (error) {
      if (token !== this._loadToken) return;
      console.error("cathcart-energy-card statistics failed", error);
      this._stats = {};
      this._render();
    }
  }

  _series() {
    const { period, buckets } = this._range();
    const devices = this._config.devices;
    const values = buckets.map(() => devices.map(() => 0));
    devices.forEach((device, deviceIndex) => {
      for (const row of this._stats?.[device.energy] || []) {
        const date = new Date(row.start);
        const key = this._key(date, period);
        const bucket = buckets.findIndex((item) => item.key === key);
        if (bucket >= 0) values[bucket][deviceIndex] += Math.max(0, Number(row.change) || 0);
      }
    });
    return { buckets, values };
  }

  _latestBucket() {
    if (!this._stats) return null;
    const { buckets, values } = this._series();
    for (let index = buckets.length - 1; index >= 0; index -= 1) {
      if (values[index].some((value) => value > 0)) return index;
    }
    const now = new Date();
    const current = buckets.findIndex((bucket) => bucket.key === this._key(now, this._range().period));
    return current >= 0 ? current : buckets.length - 1;
  }

  _periodTotal(deviceIndex) {
    if (this._period === "total") {
      const energy = this._num(this._config.devices[deviceIndex].energy);
      return energy ?? 0;
    }
    const { values } = this._series();
    return values.reduce((sum, bucket) => sum + (bucket[deviceIndex] || 0), 0);
  }

  _render() {
    if (!this.shadowRoot || !this._config) return;
    if (!this._hass || !this._stats) {
      this.shadowRoot.innerHTML = this._frame(`<div class="empty">Loading energy…</div>`);
      return;
    }
    const rate = this._rate();
    const devices = this._config.devices;
    const { buckets, values } = this._series();
    const totals = devices.map((_, index) => this._periodTotal(index));
    const periodKwh = totals.reduce((sum, value) => sum + value, 0);
    const maxShare = Math.max(...totals, 0);
    const maxBar = Math.max(...values.map((bucket) => bucket.reduce((sum, value) => sum + value, 0)), 0);
    const selected = this._selected != null && buckets[this._selected] ? this._selected : this._latestBucket();
    const selectedValues = selected == null ? [] : values[selected];
    const selectedKwh = selectedValues.reduce((sum, value) => sum + value, 0);
    const selectedLabel = selected == null ? "" : this._bucketLabel(buckets[selected].date);

    const bars = buckets.map((bucket, index) => {
      const total = values[index].reduce((sum, value) => sum + value, 0);
      const height = maxBar > 0 ? Math.max(total > 0 ? 4 : 0, (total / maxBar) * 100) : 0;
      const segments = devices.map((device, deviceIndex) => {
        const value = values[index][deviceIndex];
        const share = total > 0 ? (value / total) * 100 : 0;
        return `<i style="height:${share}%;background:${device.color}"></i>`;
      }).join("");
      return `<button type="button" class="bar ${index === selected ? "on" : ""}" data-bar="${index}" aria-label="${this._escape(bucket.label || "usage")}">
        <span style="height:${height}%">${segments}</span>
        <small>${this._escape(bucket.label)}</small>
      </button>`;
    }).join("");

    const legend = devices.map((device) => `<span><i style="background:${device.color}"></i>${this._escape(device.name)}</span>`).join("");

    const rows = devices.map((device, index) => {
      const kwh = totals[index];
      const width = maxShare > 0 ? Math.max(kwh > 0 ? 6 : 0, (kwh / maxShare) * 100) : 0;
      return `<button type="button" class="device" data-hash="${this._escape(device.hash || "")}">
        <ha-icon icon="${this._escape(device.icon || "mdi:flash")}"></ha-icon>
        <span class="copy">
          <strong>${this._escape(device.name)}</strong>
          <span class="track"><i style="width:${width}%;background:${device.color}"></i></span>
        </span>
        <span class="figures">
          <b>${this._kwh(kwh)}</b>
          <small>${this._money(kwh * rate)}</small>
        </span>
      </button>`;
    }).join("");

    const pence = (rate * 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const chartNote = this._period === "total"
      ? "Bars show recorded months. The total above is the full meter reading."
      : (selected == null ? "" : `${selectedLabel} · ${this._kwh(selectedKwh)} · ${this._money(selectedKwh * rate)}`);

    this.shadowRoot.innerHTML = this._frame(`
      <div class="tabs">
        ${PERIODS.map((period) => `<button type="button" data-period="${period.id}" class="${period.id === this._period ? "on" : ""}">${period.label}</button>`).join("")}
      </div>
      <div class="hero">
        <strong>${this._money(periodKwh * rate)}</strong>
        <p>${this._kwh(periodKwh)} · ${pence}p/kWh</p>
      </div>
      <div class="chart ${maxBar === 0 ? "empty-chart" : ""}" style="--bars:${buckets.length}">${bars}</div>
      <div class="legend">${legend}</div>
      <p class="note">${this._escape(chartNote)}</p>
      <div class="devices">${rows}</div>
      <p class="fine">UK price cap, 1 Oct–31 Dec 2026, GB average. Standing charge 54.83p/day is not included.</p>
    `);
    this._bind();
  }

  _bucketLabel(date) {
    if (this._period === "today") return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    if (this._period === "total") return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  }

  _bind() {
    this.shadowRoot.querySelectorAll("[data-period]").forEach((button) => {
      button.addEventListener("click", () => {
        this._period = button.dataset.period;
        this._selected = null;
        this._stats = null;
        this._fetchedAt = Date.now();
        this._loading = true;
        this._load().finally(() => { this._loading = false; });
      });
    });
    this.shadowRoot.querySelectorAll("[data-bar]").forEach((button) => {
      button.addEventListener("click", () => {
        this._selected = Number(button.dataset.bar);
        this._render();
      });
    });
    this.shadowRoot.querySelectorAll("[data-hash]").forEach((button) => {
      button.addEventListener("click", () => {
        const hash = button.dataset.hash;
        if (!hash) return;
        history.pushState(null, "", hash);
        window.dispatchEvent(new Event("location-changed"));
      });
    });
  }

  _frame(content) {
    return `<style>
      :host{display:block;min-width:0}
      ha-card{padding:16px 14px 12px;min-width:0}
      .tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
      .tabs button,.bar,.device{font:inherit;color:inherit;background:var(--secondary-background-color);border:0}
      .tabs button{border-radius:999px;min-height:34px;font-weight:650;min-width:0}
      .tabs button.on{background:#1a73e8;color:#fff}
      .hero{padding:16px 2px 8px}
      .hero strong{display:block;font-size:2.4rem;font-weight:750;letter-spacing:-.04em;line-height:.95}
      .hero p,.note,.fine{color:var(--secondary-text-color)}
      .hero p{margin:6px 0 0}
      .chart{height:148px;display:grid;grid-template-columns:repeat(var(--bars),minmax(0,1fr));gap:2px;align-items:end;padding:8px 2px 0;min-width:0}
      .bar{height:100%;min-width:0;display:grid;grid-template-rows:1fr auto;align-items:end;justify-items:center;background:transparent;padding:0;cursor:pointer}
      .bar span{width:70%;max-width:16px;min-height:2px;background:color-mix(in srgb,var(--divider-color) 80%,transparent);border-radius:7px 7px 3px 3px;display:flex;flex-direction:column-reverse;overflow:hidden}
      .bar i{display:block;width:100%}
      .bar small{height:16px;font-size:.62rem;color:var(--secondary-text-color);line-height:16px}
      .bar.on span{box-shadow:0 0 0 2px var(--primary-text-color)}
      .legend{display:flex;flex-wrap:wrap;gap:8px 12px;margin-top:4px;font-size:.78rem;color:var(--secondary-text-color)}
      .legend i{display:inline-block;width:8px;height:8px;border-radius:99px;margin-right:6px}
      .note{min-height:1.2em;margin:8px 0 0;font-size:.82rem}
      .devices{display:grid;gap:8px;margin-top:8px}
      .device{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;text-align:left;border-radius:14px;padding:10px 12px;cursor:pointer;min-width:0}
      .device ha-icon{color:#1a73e8}
      .copy{display:grid;gap:6px;min-width:0}
      .copy strong{font-size:.95rem}
      .track{display:block;height:7px;border-radius:99px;background:color-mix(in srgb,var(--divider-color) 75%,transparent);overflow:hidden}
      .track i{display:block;height:100%;border-radius:99px}
      .figures{display:grid;justify-items:end;gap:2px;white-space:nowrap}
      .figures b{font-size:.92rem}
      .figures small{color:var(--secondary-text-color)}
      .fine{margin:12px 0 0;font-size:.72rem}
      .empty{padding:28px 8px;text-align:center;color:var(--secondary-text-color)}
      @media(prefers-reduced-motion:reduce){*{transition:none!important}}
    </style><ha-card>${content}</ha-card>`;
  }
}

if (!customElements.get("cathcart-energy-card")) customElements.define("cathcart-energy-card", CathcartEnergyCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "cathcart-energy-card",
  name: "Cathcart Energy",
  description: "Appliance energy chart with UK price-cap cost",
  preview: true,
});
console.info(`%c CATHCART-ENERGY %c ${VERSION} `, "color:#fff;background:#1a73e8;font-weight:700", "color:#1a73e8;background:#fff;font-weight:700");
