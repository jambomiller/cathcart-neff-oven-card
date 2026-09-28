const VERSION = "1.1.0";
const ACCENT = "#f57c00";
const RING_RADIUS = 58;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

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

const TIMER_PRESETS = [
  [0, "Off"],
  [900, "15 min"],
  [1800, "30 min"],
  [3600, "60 min"],
];

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
      progress: `sensor.${p}_bsh_common_option_programprogress`,
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

  _formatSeconds(value) {
    if (!Number.isFinite(value) || value <= 0) return "Off";
    const minutes = Math.round(value / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }

  _render() {
    if (!this.shadowRoot || !this._config) return;
    if (!this._hass) {
      this.shadowRoot.innerHTML = this._frame(`<div class="empty">Loading oven…</div>`);
      return;
    }

    const ids = this._ids();
    const status = this._statusKey();
    const statusLabel = STATUS_NAMES[status] || status;
    const online = this._val(ids.connected) === "on";
    const temp = this._num(ids.temperature);
    const doorOpen = this._val(ids.door) === "open" || this._val(ids.door) === "on";
    const programState = this._st(ids.programs);
    const program = programState?.state && !["unknown", "unavailable", "none", ""].includes(programState.state)
      ? programState.state
      : "";
    const options = programState?.attributes?.options || [];
    const timer = this._num(ids.timer) || 0;
    const remoteStart = this._val(ids.remoteStart) === "on";
    const startOk = this._available(ids.start);
    const stopOk = this._available(ids.stop);
    const running = ["run", "pause", "delayedstart", "aborting"].includes(status);
    const heating = ["run", "pause"].includes(status) || this._val(ids.preheat) === "on";
    const setpoint = this._st(ids.setpoint);
    const setpointValue = this._available(ids.setpoint) ? Number(setpoint.state) : null;
    const duration = this._st(ids.duration);
    const progress = this._num(ids.progress);
    const progressOk = progress !== null && this._available(ids.progress);
    const maximum = setpointValue && setpointValue > 0 ? setpointValue : Number(setpoint?.attributes?.max) || 250;
    const percentage = temp === null ? 0 : Math.max(0, Math.min(100, (temp / maximum) * 100));
    const offset = RING_CIRCUMFERENCE * (1 - percentage / 100);
    const programLabel = this._programLabel(program);
    const readout = programLabel === "No program" ? "— — —" : programLabel.slice(0, 12).toUpperCase();
    const tempText = temp === null ? "—" : String(Math.round(temp));

    const programOptions = options
      .map((value) => `<option value="${this._escape(value)}" ${value === program ? "selected" : ""}>${this._escape(this._programLabel(value))}</option>`)
      .join("");

    const powerState = this._st(ids.power);
    const powerBlock = this._available(ids.power)
      ? `<section>
          <label>Power<span class="section-value">${this._escape(this._powerLabel(powerState.state))}</span></label>
          <div class="select">
            <select id="power">${(powerState.attributes?.options || [])
              .map((value) => `<option value="${this._escape(value)}" ${value === powerState.state ? "selected" : ""}>${this._escape(this._powerLabel(value))}</option>`)
              .join("")}</select>
          </div>
        </section>`
      : "";

    const setpointBlock = this._available(ids.setpoint)
      ? `<section>
          <label>Target<span class="section-value" id="setpoint-value">${Math.round(setpointValue)} °C</span></label>
          <div class="range">
            <input id="setpoint" type="range" min="${setpoint.attributes?.min ?? 30}" max="${setpoint.attributes?.max ?? 250}" step="${setpoint.attributes?.step ?? 5}" value="${setpoint.state}">
          </div>
        </section>`
      : "";

    const durationBlock = this._available(ids.duration)
      ? `<section>
          <label>Duration<span class="section-value">${this._escape(this._formatSeconds(Number(duration.state)))}</span></label>
          <div class="range">
            <input id="duration" type="range" min="${duration.attributes?.min ?? 60}" max="${Math.min(duration.attributes?.max ?? 14400, 14400)}" step="60" value="${duration.state}">
          </div>
        </section>`
      : "";

    const timerPresets = TIMER_PRESETS.map(([seconds, text]) => {
      const active = seconds === 0 ? timer <= 0 : Math.abs(timer - seconds) < 30;
      return `<button type="button" data-timer="${seconds}" class="${active ? "on" : ""}">${text}</button>`;
    }).join("");

    const pills = [
      `<button type="button" class="pill ${doorOpen ? "warn" : "muted"}" disabled>${doorOpen ? "Door open" : "Door closed"}</button>`,
      `<button type="button" class="pill ${remoteStart ? "good" : "muted"}" disabled>${remoteStart ? "Remote start on" : "Remote start off"}</button>`,
      `<button type="button" class="pill ${this._val(ids.childLock) === "on" ? "on" : ""}" data-toggle="childLock">Child lock</button>`,
    ];
    if (this._available(ids.preheat)) {
      pills.push(`<button type="button" class="pill ${this._val(ids.preheat) === "on" ? "on" : ""}" data-toggle="preheat">Fast preheat</button>`);
    }

    this.shadowRoot.innerHTML = this._frame(`
      <div class="card status-${this._escape(status)}">
        <header>
          <div>
            <div class="title">${this._escape(this._config.title)}</div>
            <div class="subtitle">${this._escape(programLabel)}</div>
          </div>
          <span class="status ${online ? "good" : "bad"}"><span></span>${online ? "Online" : "Offline"}</span>
        </header>

        <div class="hero">
          <div class="visual ${heating ? "heating" : ""} ${doorOpen ? "door-open" : ""}">
            <svg viewBox="0 0 132 132" aria-hidden="true">
              <circle class="track" cx="66" cy="66" r="${RING_RADIUS}"></circle>
              <circle class="value" cx="66" cy="66" r="${RING_RADIUS}" stroke-dasharray="${RING_CIRCUMFERENCE.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"></circle>
            </svg>
            <div class="heat" aria-hidden="true"><i></i><i></i><i></i></div>
            <div class="appliance">
              <div class="fascia">
                <div class="knob ${heating ? "lit" : ""}"></div>
                <div class="readout">${this._escape(readout)}</div>
                <div class="logo">NEFF</div>
              </div>
              <div class="door">
                <div class="glow"></div>
                <div class="window">
                  <strong>${this._escape(tempText)}</strong>
                  <small>°C</small>
                </div>
                <div class="handle"></div>
              </div>
            </div>
          </div>
          <div class="summary">
            <div class="operation ${this._escape(status)}">${this._escape(statusLabel)}</div>
            <div class="program">${this._escape(programLabel)}</div>
            <div class="facts">
              ${setpointValue !== null ? `<div><span><small>Target</small><b>${Math.round(setpointValue)} °C</b></span></div>` : ""}
              <div><span><small>Door</small><b class="${doorOpen ? "warn" : ""}">${doorOpen ? "Open" : "Closed"}</b></span></div>
              <div><span><small>Timer</small><b>${this._escape(this._formatSeconds(timer))}</b></span></div>
              ${progressOk ? `<div><span><small>Progress</small><b>${Math.round(progress)} %</b></span></div>` : ""}
            </div>
          </div>
        </div>

        <div class="pills">${pills.join("")}</div>

        <section>
          <label>Program<span class="section-value">${this._escape(programLabel)}</span></label>
          <div class="select">
            <select id="program" ${options.length ? "" : "disabled"}>
              ${programOptions || `<option>No program</option>`}
            </select>
          </div>
        </section>

        <footer>
          <button class="action primary" data-press="start" ${startOk ? "" : "disabled"}>Start</button>
          <button class="action danger" data-press="stop" ${stopOk ? "" : "disabled"}>Stop</button>
        </footer>

        <section>
          <label>Timer<span class="section-value">${this._escape(this._formatSeconds(timer))}</span></label>
          <div class="range">
            <input id="timer" type="range" min="0" max="7200" step="60" value="${Math.min(timer, 7200)}">
          </div>
          <div class="segments four">${timerPresets}</div>
        </section>

        ${powerBlock}
        ${setpointBlock}
        ${durationBlock}

        ${!startOk && !running ? `<p class="hint">Start stays unavailable until Remote Start is enabled on the oven.</p>` : ""}
      </div>
    `);
    this._bind();
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
    this.shadowRoot.getElementById("setpoint")?.addEventListener("input", (event) => {
      const output = this.shadowRoot.getElementById("setpoint-value");
      if (output) output.textContent = `${event.target.value} °C`;
    });
    this.shadowRoot.getElementById("setpoint")?.addEventListener("change", (event) => {
      this._call("number", "set_value", { entity_id: ids.setpoint, value: Number(event.target.value) });
    });
    this.shadowRoot.getElementById("duration")?.addEventListener("change", (event) => {
      this._call("number", "set_value", { entity_id: ids.duration, value: Number(event.target.value) });
    });
    this.shadowRoot.querySelectorAll("[data-timer]").forEach((element) => {
      element.addEventListener("click", () => {
        this._call("number", "set_value", { entity_id: ids.timer, value: Number(element.dataset.timer) });
      });
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
      :host{display:block;container-type:inline-size;--accent:${ACCENT}}
      ha-card{overflow:hidden}
      .card{padding:20px;color:var(--primary-text-color)}
      header{display:flex;justify-content:space-between;gap:16px;margin-bottom:12px;align-items:flex-start}
      .title{font-size:1.25rem;font-weight:700}
      .subtitle,.program{color:var(--secondary-text-color);margin-top:3px}
      .status,.pill{border:0;border-radius:999px;background:var(--secondary-background-color);padding:7px 10px;display:inline-flex;align-items:center;gap:6px;color:inherit;white-space:nowrap;font:inherit}
      .status span{width:7px;height:7px;border-radius:50%;background:currentColor}
      .good{color:var(--success-color,#43a047)}
      .bad{color:var(--error-color,#db4437)}
      .warn{color:var(--warning-color,#f9a825)}
      .muted{color:var(--secondary-text-color)}
      .pill{cursor:pointer}
      .pill[disabled]{cursor:default}
      .pill.on{border:1px solid var(--accent);background:color-mix(in srgb,var(--accent) 12%,var(--secondary-background-color));color:var(--accent)}

      .hero{display:grid;grid-template-columns:180px 1fr;align-items:center;gap:20px;padding:4px 0 16px}
      .visual{width:168px;height:168px;position:relative;display:grid;place-items:center;margin:auto}
      .visual svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg)}
      circle{fill:none;stroke-width:8}
      .track{stroke:var(--divider-color)}
      .value{stroke:var(--accent);stroke-linecap:round;transition:stroke-dashoffset .4s}

      .heat{position:absolute;top:6px;display:flex;gap:6px;opacity:0;z-index:3}
      .heating .heat{opacity:1}
      .heat i{width:5px;height:16px;border-left:2px solid var(--accent);animation:heat 1.7s ease-in-out infinite}
      .heat i:nth-child(2){animation-delay:.35s}
      .heat i:nth-child(3){animation-delay:.7s}

      .appliance{width:92px;height:108px;position:relative;z-index:2;border-radius:8px;padding:6px 6px 7px;background:linear-gradient(180deg,#8d9096,#5c5f66 42%,#3b3e44);box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 8px 18px rgba(0,0,0,.28);display:grid;grid-template-rows:22px 1fr;gap:5px}
      .fascia{display:grid;grid-template-columns:18px 1fr auto;align-items:center;gap:5px;padding:0 2px}
      .knob{width:14px;height:14px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#f3f3f3,#8a8d93 55%,#2f3238);box-shadow:inset 0 0 0 1px rgba(0,0,0,.35)}
      .knob.lit{box-shadow:0 0 6px var(--accent),inset 0 0 0 1px rgba(0,0,0,.35);background:radial-gradient(circle at 35% 30%,#ffe0b2,#f57c00 60%,#6d3b00)}
      .readout{font:700 6px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;color:#d7dde6;background:#111418;border-radius:2px;padding:3px 4px;text-align:center;overflow:hidden;white-space:nowrap}
      .logo{font:800 7px/1 system-ui,sans-serif;letter-spacing:.16em;color:#eceff3}
      .door{position:relative;border-radius:4px;background:#111214;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);transform-origin:50% 100%;transition:transform .35s ease}
      .door-open .door{transform:perspective(240px) rotateX(-18deg) translateY(4px)}
      .glow{position:absolute;inset:8px 10px 18px;border-radius:3px;background:radial-gradient(circle,color-mix(in srgb,var(--accent) 42%,transparent),transparent 70%);opacity:0}
      .heating .glow{opacity:1;animation:glow 2s ease-in-out infinite}
      .window{position:absolute;inset:10px 12px 22px;display:grid;place-content:center;place-items:center;color:#fff;z-index:1;text-shadow:0 0 8px rgba(245,124,0,.45)}
      .window strong{font-size:1.35rem;font-weight:750;letter-spacing:-.04em;line-height:.9}
      .window small{font-size:.62rem;color:rgba(255,255,255,.72)}
      .handle{position:absolute;left:10px;right:10px;bottom:6px;height:5px;border-radius:99px;background:linear-gradient(180deg,#cfd3d8,#7d8188)}

      .operation{font-size:1.7rem;font-weight:750}
      .operation.run{color:var(--accent)}
      .operation.pause,.operation.delayedstart{color:var(--warning-color,#f9a825)}
      .operation.error{color:var(--error-color,#db4437)}
      .facts{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:18px}
      .facts>div{display:flex;align-items:center}
      .facts span{display:flex;flex-direction:column;gap:2px}
      .facts small{color:var(--secondary-text-color);font-size:.75rem}
      .facts b{font-weight:650}

      .pills{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:4px}
      section{border-top:1px solid var(--divider-color);padding-top:14px;margin-top:14px}
      section>label{display:flex;align-items:center;gap:7px;color:var(--secondary-text-color);font-size:.8rem;font-weight:650;margin-bottom:9px}
      .section-value{margin-left:auto;color:var(--primary-text-color)}
      .select select{width:100%;appearance:none;border:1px solid var(--divider-color);border-radius:12px;padding:12px 13px;background:var(--secondary-background-color);color:var(--primary-text-color)}
      .range input{accent-color:var(--accent);width:100%}
      .segments{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:9px}
      .segments.four{grid-template-columns:repeat(4,1fr)}
      .segments button{border:1px solid var(--divider-color);border-radius:11px;background:var(--secondary-background-color);color:inherit;cursor:pointer;padding:9px;font:inherit}
      .segments button.on{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,var(--secondary-background-color));color:var(--accent)}
      footer{display:flex;gap:9px;margin-top:18px}
      .action{flex:1;border:0;border-radius:12px;min-height:44px;display:flex;align-items:center;justify-content:center;font-weight:700;cursor:pointer;background:var(--secondary-background-color);color:inherit;font:inherit}
      .primary{background:var(--accent);color:#fff}
      .danger{color:var(--error-color,#db4437);background:color-mix(in srgb,var(--error-color,#db4437) 12%,var(--secondary-background-color))}
      button:disabled{opacity:.45;cursor:not-allowed}
      .hint{margin:14px 0 0;font-size:.78rem;color:var(--secondary-text-color)}
      .empty{padding:24px;color:var(--secondary-text-color);text-align:center}

      @keyframes heat{0%,100%{transform:translateY(4px);opacity:.2}50%{transform:translateY(-4px);opacity:1}}
      @keyframes glow{50%{transform:scale(1.08);opacity:.65}}
      @container(max-width:460px){
        .card{padding:16px}
        .hero{grid-template-columns:1fr;gap:8px}
        .visual{width:150px;height:150px}
        .summary{text-align:center}
        .operation{font-size:1.45rem}
        .facts,.pills{justify-content:center}
        .facts{margin-top:12px}
      }
      @container(max-width:340px){
        .facts{grid-template-columns:1fr}
        .segments.four{grid-template-columns:repeat(2,1fr)}
        footer{flex-direction:column}
      }
      @media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
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
