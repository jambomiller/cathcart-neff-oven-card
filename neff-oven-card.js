const VERSION = "1.0.0";

const PREFIX_HELPERS = {
  neff_b6ach7hg0b_68a40ec1362c_001: {
    status: "sensor.kitchen_oven_1_status",
    door: "sensor.kitchen_oven_1_door",
  },
  neff_b6ach7hg0b_68a40ec135d7_001: {
    status: "sensor.kitchen_oven_2_status",
    door: "sensor.kitchen_oven_2_door",
  },
};

const PROGRAM_NAMES = {
  "Cooking.Oven.Program.HeatingMode.HotAir": "Hot air",
  "Cooking.Oven.Program.HeatingMode.HotAirEco": "Hot air eco",
  "Cooking.Oven.Program.HeatingMode.HotAirGrilling": "Hot air grill",
  "Cooking.Oven.Program.HeatingMode.TopBottomHeating": "Top and bottom",
  "Cooking.Oven.Program.HeatingMode.TopBottomHeatingEco": "Top and bottom eco",
  "Cooking.Oven.Program.HeatingMode.PizzaSetting": "Pizza",
  "Cooking.Oven.Program.HeatingMode.IntensiveHeat": "Intensive",
  "Cooking.Oven.Program.HeatingMode.BottomHeating": "Bottom heat",
  "Cooking.Oven.Program.HeatingMode.SlowCook": "Slow cook",
  "Cooking.Oven.Program.HeatingMode.Preheat": "Preheat",
  "Cooking.Oven.Program.HeatingMode.PreHeating": "Preheat",
  "Cooking.Oven.Program.HeatingMode.KeepWarm": "Keep warm",
  "Cooking.Oven.Program.HeatingMode.Defrost": "Defrost",
  "Cooking.Oven.Program.HeatingMode.Desiccation": "Drying",
  "Cooking.Oven.Program.HeatingMode.FrozenHeatupSpecial": "Frozen food",
  "Cooking.Oven.Program.HeatingMode.GrillLargeArea": "Grill large",
  "Cooking.Oven.Program.HeatingMode.GrillSmallArea": "Grill small",
  "Cooking.Oven.Program.HeatingMode.PreheatOvenware": "Preheat cookware",
};

const STATUS_NAMES = {
  inactive: "Off",
  ready: "Ready",
  delayedstart: "Scheduled",
  run: "Running",
  pause: "Paused",
  actionrequired: "Needs attention",
  finished: "Finished",
  error: "Error",
  aborting: "Stopping",
  unknown: "Unknown",
};

const POWER_NAMES = {
  "BSH.Common.EnumType.PowerState.On": "On",
  "BSH.Common.EnumType.PowerState.Standby": "Standby",
  "BSH.Common.EnumType.PowerState.Off": "Off",
};

class NeffOvenCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._signature = "";
  }

  static getStubConfig() {
    return { type: "custom:neff-oven-card", title: "Oven", prefix: "" };
  }

  getCardSize() {
    return 8;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: 8, min_rows: 5 };
  }

  setConfig(config) {
    if (!config?.prefix) throw new Error("neff-oven-card requires prefix");
    this._config = { title: "Oven", ...config };
    this._signature = "";
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const signature = this._signatureNow();
    if (signature !== this._signature) {
      this._signature = signature;
      this._render();
    }
  }

  _ids() {
    const p = this._config.prefix;
    const helpers = PREFIX_HELPERS[p] || {};
    return {
      status: helpers.status,
      door: helpers.door,
      connected: `binary_sensor.${p}_connected`,
      temperature: `sensor.${p}_cooking_oven_status_currentcavitytemperature`,
      programs: `select.${p}_programs`,
      start: `button.${p}_start_pause`,
      stop: `button.${p}_stop`,
      timer: `number.${p}_bsh_common_setting_alarmclock`,
      childLock: `switch.${p}_bsh_common_setting_childlock`,
      power: `select.${p}_bsh_common_setting_powerstate`,
      setpoint: `number.${p}_cooking_oven_option_setpointtemperature`,
      duration: `number.${p}_bsh_common_option_duration`,
      preheat: `switch.${p}_cooking_oven_option_fastpreheat`,
      remoteStart: `binary_sensor.${p}_bsh_common_status_remotecontrolstartallowed`,
    };
  }

  _st(id) {
    return id ? this._hass?.states?.[id] : undefined;
  }

  _val(id) {
    return this._st(id)?.state;
  }

  _available(id) {
    const state = this._val(id);
    return Boolean(state && state !== "unknown" && state !== "unavailable");
  }

  _num(id) {
    const value = Number(this._val(id));
    return Number.isFinite(value) ? value : null;
  }

  _statusKey() {
    const raw = this._val(this._ids().status) || "unknown";
    return String(raw).split(".").pop().toLowerCase();
  }

  _programLabel(value) {
    if (!value || ["unknown", "unavailable", "none", ""].includes(value)) return "No program";
    if (PROGRAM_NAMES[value]) return PROGRAM_NAMES[value];
    return value.replace(/^Cooking\.Oven\.Program\.HeatingMode\./, "").replaceAll("_", " ");
  }

  _powerLabel(value) {
    return POWER_NAMES[value] || String(value || "").split(".").pop();
  }

  _signatureNow() {
    if (!this._hass || !this._config) return "";
    return JSON.stringify(
      Object.values(this._ids()).map((id) => {
        const state = this._st(id);
        return state
          ? [state.state, state.attributes?.options, state.attributes?.min, state.attributes?.max]
          : null;
      }),
    );
  }

  _escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  _call(domain, service, data) {
    this._hass.callService(domain, service, data);
  }

  _render() {
    if (!this.shadowRoot || !this._config) return;
    if (!this._hass) {
      this.shadowRoot.innerHTML = this._frame(`<div class="empty">Loading oven…</div>`);
      return;
    }

    const ids = this._ids();
    const status = this._statusKey();
    const online = this._val(ids.connected) === "on";
    const temp = this._num(ids.temperature);
    const doorOpen = this._val(ids.door) === "open" || this._val(ids.door) === "on";
    const programState = this._st(ids.programs);
    const program = programState?.state && programState.state !== "unknown" ? programState.state : "";
    const options = programState?.attributes?.options || [];
    const timer = this._num(ids.timer) || 0;
    const remoteStart = this._val(ids.remoteStart) === "on";
    const startOk = this._available(ids.start);
    const stopOk = this._available(ids.stop);
    const running = ["run", "pause", "delayedstart", "aborting"].includes(status);

    const programOptions = options
      .map((value) => `<option value="${this._escape(value)}" ${value === program ? "selected" : ""}>${this._escape(this._programLabel(value))}</option>`)
      .join("");

    const powerState = this._st(ids.power);
    const powerBlock = this._available(ids.power)
      ? `<label>Power<select id="power">${(powerState.attributes?.options || [])
          .map((value) => `<option value="${this._escape(value)}" ${value === powerState.state ? "selected" : ""}>${this._escape(this._powerLabel(value))}</option>`)
          .join("")}</select></label>`
      : "";

    const setpoint = this._st(ids.setpoint);
    const setpointBlock = this._available(ids.setpoint)
      ? `<label>Target <span>${Math.round(Number(setpoint.state))}°C</span><input id="setpoint" type="range" min="${setpoint.attributes?.min ?? 30}" max="${setpoint.attributes?.max ?? 200}" step="${setpoint.attributes?.step ?? 5}" value="${setpoint.state}"></label>`
      : "";

    const duration = this._st(ids.duration);
    const durationBlock = this._available(ids.duration)
      ? `<label>Duration <span>${this._formatSeconds(Number(duration.state))}</span><input id="duration" type="range" min="${duration.attributes?.min ?? 60}" max="${Math.min(duration.attributes?.max ?? 14400, 14400)}" step="60" value="${duration.state}"></label>`
      : "";

    const preheatBlock = this._available(ids.preheat)
      ? `<button class="chip ${this._val(ids.preheat) === "on" ? "on" : ""}" data-toggle="preheat">Fast preheat</button>`
      : "";

    this.shadowRoot.innerHTML = this._frame(`
      <div class="card status-${this._escape(status)}">
        <header>
          <div>
            <h2>${this._escape(this._config.title)}</h2>
            <p>${this._escape(STATUS_NAMES[status] || status)} · ${this._escape(this._programLabel(program))}</p>
          </div>
          <span class="pill ${online ? "good" : "bad"}">${online ? "Online" : "Offline"}</span>
        </header>
        <div class="hero">
          <div class="temp">${temp === null ? "—" : Math.round(temp)}<small>°C</small></div>
          <div class="meta">
            <span class="${doorOpen ? "warn" : ""}">${doorOpen ? "Door open" : "Door closed"}</span>
            <span class="${remoteStart ? "good" : "muted"}">${remoteStart ? "Remote start on" : "Remote start off"}</span>
          </div>
        </div>
        <label>Program
          <select id="program" ${options.length ? "" : "disabled"}>
            ${programOptions || `<option>No program</option>`}
          </select>
        </label>
        <div class="actions">
          <button class="primary" data-press="start" ${startOk ? "" : "disabled"}>Start</button>
          <button class="danger" data-press="stop" ${stopOk ? "" : "disabled"}>Stop</button>
        </div>
        <label>Timer <span>${this._formatSeconds(timer)}</span>
          <input id="timer" type="range" min="0" max="7200" step="60" value="${Math.min(timer, 7200)}">
        </label>
        ${powerBlock}
        ${setpointBlock}
        ${durationBlock}
        <div class="chips">
          <button class="chip ${this._val(ids.childLock) === "on" ? "on" : ""}" data-toggle="childLock">Child lock</button>
          ${preheatBlock}
        </div>
        ${!startOk && !running ? `<p class="hint">Start stays unavailable until Remote Start is enabled on the oven.</p>` : ""}
      </div>
    `);
    this._bind();
  }

  _formatSeconds(value) {
    if (!Number.isFinite(value) || value <= 0) return "Off";
    const minutes = Math.round(value / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }

  _bind() {
    const ids = this._ids();
    this.shadowRoot.getElementById("program")?.addEventListener("change", (event) => {
      this._call("select", "select_option", { entity_id: ids.programs, option: event.target.value });
    });
    this.shadowRoot.getElementById("power")?.addEventListener("change", (event) => {
      this._call("select", "select_option", { entity_id: ids.power, option: event.target.value });
    });
    this.shadowRoot.getElementById("timer")?.addEventListener("change", (event) => {
      this._call("number", "set_value", { entity_id: ids.timer, value: Number(event.target.value) });
    });
    this.shadowRoot.getElementById("setpoint")?.addEventListener("change", (event) => {
      this._call("number", "set_value", { entity_id: ids.setpoint, value: Number(event.target.value) });
    });
    this.shadowRoot.getElementById("duration")?.addEventListener("change", (event) => {
      this._call("number", "set_value", { entity_id: ids.duration, value: Number(event.target.value) });
    });
    this.shadowRoot.querySelector('[data-press="start"]')?.addEventListener("click", () => {
      if (this._available(ids.start)) this._call("button", "press", { entity_id: ids.start });
    });
    this.shadowRoot.querySelector('[data-press="stop"]')?.addEventListener("click", () => {
      if (this._available(ids.stop) && globalThis.confirm("Stop the oven program?")) {
        this._call("button", "press", { entity_id: ids.stop });
      }
    });
    this.shadowRoot.querySelector('[data-toggle="childLock"]')?.addEventListener("click", () => {
      this._call("switch", "toggle", { entity_id: ids.childLock });
    });
    this.shadowRoot.querySelector('[data-toggle="preheat"]')?.addEventListener("click", () => {
      if (this._available(ids.preheat)) this._call("switch", "toggle", { entity_id: ids.preheat });
    });
  }

  _frame(content) {
    return `<style>
      :host{display:block}
      ha-card{overflow:hidden;border-radius:18px}
      .card{padding:16px 16px 14px;display:grid;gap:12px;color:var(--primary-text-color)}
      header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
      h2{margin:0;font-size:1.15rem;font-weight:700}
      header p{margin:4px 0 0;color:var(--secondary-text-color);font-size:.9rem}
      .pill,.chip{border:0;border-radius:999px;padding:6px 10px;font:inherit;background:var(--secondary-background-color);color:inherit}
      .good{color:var(--success-color,#43a047)}.bad{color:var(--error-color,#db4437)}.warn{color:var(--warning-color,#f9a825)}.muted{color:var(--secondary-text-color)}
      .hero{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;padding:4px 0 2px}
      .temp{font-size:3rem;font-weight:750;letter-spacing:-.04em;line-height:.9}
      .temp small{font-size:1.1rem;margin-left:2px;color:var(--secondary-text-color)}
      .meta{display:grid;gap:4px;text-align:right;font-size:.85rem}
      label{display:grid;gap:6px;font-size:.78rem;font-weight:650;color:var(--secondary-text-color)}
      label span{margin-left:auto;color:var(--primary-text-color)}
      label{grid-template-columns:1fr auto}
      label select,label input{grid-column:1/-1}
      select{appearance:none;border:1px solid var(--divider-color);border-radius:12px;padding:12px;background:var(--secondary-background-color);color:var(--primary-text-color)}
      input[type=range]{accent-color:#f57c00;width:100%}
      .actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .primary,.danger{min-height:44px;border:0;border-radius:12px;font:inherit;font-weight:700;cursor:pointer}
      .primary{background:#f57c00;color:#fff}
      .danger{background:color-mix(in srgb,var(--error-color,#db4437) 12%,var(--secondary-background-color));color:var(--error-color,#db4437)}
      button:disabled{opacity:.45;cursor:not-allowed}
      .chips{display:flex;flex-wrap:wrap;gap:8px}
      .chip{cursor:pointer}
      .chip.on{background:color-mix(in srgb,#f57c00 18%,var(--secondary-background-color));color:#f57c00}
      .hint{margin:0;font-size:.78rem;color:var(--secondary-text-color)}
      .empty{padding:24px;color:var(--secondary-text-color);text-align:center}
      .status-run .temp{color:#f57c00}
    </style><ha-card>${content}</ha-card>`;
  }
}

if (!customElements.get("neff-oven-card")) customElements.define("neff-oven-card", NeffOvenCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "neff-oven-card",
  name: "Neff Oven Card",
  description: "Home Connect Alt card for Neff ovens",
  preview: true,
});
console.info(`%c NEFF-OVEN-CARD %c ${VERSION} `, "color:#fff;background:#f57c00;font-weight:700", "color:#f57c00;background:#fff;font-weight:700");
