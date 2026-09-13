import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api, ApiError } from "../api.js";
import { icon } from "../icons.js";
import { store, type BusStatus, type Gateway } from "../store.js";
import { t as tr } from "../i18n.js";

const TYPES: [string, string][] = [
  ["auto", "Automatic"],
  ["tunneling", "Tunnelling (UDP)"],
  ["tunneling_tcp", "Tunnelling (TCP)"],
  ["tunneling_secure", "Tunnelling IP Secure (needs keyring)"],
  ["routing", "Routing (multicast)"],
  ["routing_secure", "Routing IP Secure (needs keyring)"],
];

/** Gateway control at the right of the menu bar: state, scan and pick a gateway, connect, settings. */
@customElement("xknx-gateway-menu")
export class GatewayMenu extends LitElement {
  static styles = css`
    sl-button::part(label) {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    :host {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .trigger {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--ha-divider);
      border-radius: 14px;
      padding: 3px 10px 3px 8px;
      background: transparent;
      color: var(--ha-text);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--ha-text-2);
    }
    .dot.CONNECTED {
      background: var(--ha-success);
    }
    .dot.CONNECTING {
      background: var(--ha-warning);
    }
    .name {
      max-width: 320px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 8px 0;
    }
    .row sl-input,
    .row sl-select {
      flex: 1;
    }
    .hint {
      color: var(--ha-text-2);
      font-size: 12px;
    }
    sl-menu-item .sub {
      color: var(--ha-text-2);
      font-size: 12px;
    }
  `;

  @state() private gateways: Gateway[] = [];
  @state() private scanning = false;
  @state() private busy = false;
  @state() private dialog = false;
  @state() private keyringPick = false;
  @state() private checking = false;
  @state() private keyringInfo = "";
  @state() private tunnelUsers: { user_id: number; address: string }[] = [];

  private async uploadKeyring(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    await this.act(async () => {
      const res = await fetch(
        `api/bus/keyring?name=${encodeURIComponent(file.name)}`,
        { method: "PUT", body: file },
      );
      const j = await res.json();
      if (!res.ok) throw new ApiError(res.status, j.error ?? res.statusText);
      const el = this.renderRoot.querySelector(
        "#s-keyring",
      ) as HTMLInputElement | null;
      if (el) el.value = j.settings.keyring_path;
    }, `Keyring stored as ${file.name}`).catch(() => undefined);
    input.value = "";
  }

  private async checkKeyring(): Promise<void> {
    this.checking = true;
    try {
      const r = await api.post<{
        ok: boolean;
        error?: string;
        project?: string;
        created_by?: string;
        backbone?: boolean;
        interfaces?: {
          type: string;
          individual_address: string;
          host: string | null;
          user_id: number | null;
        }[];
        devices?: string[];
        group_addresses?: number;
      }>("api/bus/keyring/check", {
        password: this.value("s-keypass"),
        keyring_path: this.value("s-keyring"),
      });
      if (!r.ok) {
        this.keyringInfo = `✗ ${r.error}`;
        return;
      }
      this.tunnelUsers = (r.interfaces ?? [])
        .filter((i) => i.user_id !== null)
        .map((i) => ({
          user_id: i.user_id as number,
          address: i.individual_address,
        }));
      const ifaces = (r.interfaces ?? [])
        .map(
          (i) =>
            `  ${i.individual_address}${i.host ? ` on ${i.host}` : ""} (${i.type}${i.user_id !== null ? `, user ${i.user_id}` : ""})`,
        )
        .join("\n");
      this.keyringInfo = `✓ Keyring "${r.project}" by ${r.created_by}: ${r.interfaces?.length ?? 0} tunnel interface(s), ${r.devices?.length ?? 0} secure device(s), ${r.group_addresses ?? 0} group keys${r.backbone ? ", backbone key" : ""}.\n${ifaces}`;
    } catch (e) {
      this.keyringInfo = `✗ ${e instanceof ApiError ? e.message : String(e)}`;
    } finally {
      this.checking = false;
    }
  }
  @state() private tick = 0;
  private unsubscribe = () => {};

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = store.subscribe(() => this.tick++);
    void store.refreshBus();
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    super.disconnectedCallback();
  }

  private async scan(): Promise<void> {
    this.scanning = true;
    try {
      this.gateways = (
        await api.post<{ gateways: Gateway[] }>("api/bus/scan", {})
      ).gateways;
      if (!this.gateways.length)
        store.say(tr("No KNX/IP gateways answered the search"), "primary");
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    } finally {
      this.scanning = false;
    }
  }

  private async act(fn: () => Promise<unknown>, done?: string): Promise<void> {
    this.busy = true;
    try {
      await fn();
      await store.refreshBus();
      if (done) store.say(done, "success");
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
      await store.refreshBus();
      throw e;
    } finally {
      this.busy = false;
    }
  }

  private pick(g: Gateway): void {
    const type = g.secure_tunnelling
      ? "tunneling_secure"
      : g.tunnelling_tcp
        ? "tunneling_tcp"
        : g.tunnelling
          ? "tunneling"
          : "routing";
    // Picking a gateway is meant as "use this one": save it and connect straight away, so the
    // bubble turns green without a second trip into the menu.
    void this.act(
      async () => {
        await api.post("api/bus/settings", {
          gateway_ip: g.ip,
          gateway_port: g.port,
          gateway_name: g.name,
          connection_type: type,
        });
        await api.post("api/bus/connect", {});
      },
      `${tr("Connected to")} ${g.name}`,
    ).catch(() => undefined);
  }

  private onMenu(e: CustomEvent<{ item: HTMLElement }>): void {
    const v = e.detail.item.getAttribute("value") ?? "";
    if (v === "scan") void this.scan();
    else if (v === "connect")
      void this.act(
        () => api.post("api/bus/connect", {}),
        "Connected to the bus",
      ).catch(() => undefined);
    else if (v === "disconnect")
      void this.act(
        () => api.post("api/bus/disconnect", {}),
        "Disconnected",
      ).catch(() => undefined);
    else if (v === "settings") {
      this.dialog = true;
      if (
        store.bus.settings.keyring_path &&
        store.bus.settings.keyring_password
      )
        window.setTimeout(() => this.checkKeyring(), 300);
    } else if (v === "monitor") store.setBottom("monitor");
    else if (v.startsWith("gw:")) {
      const g = this.gateways[Number(v.slice(3))];
      if (g) this.pick(g);
    }
  }

  private value(id: string): string {
    return (
      (this.renderRoot.querySelector(`#${id}`) as HTMLInputElement | null)
        ?.value ?? ""
    );
  }

  private saveSettings(connect = false): void {
    const auto =
      (this.renderRoot.querySelector("#s-auto") as HTMLInputElement | null)
        ?.checked ?? false;
    const password = this.value("s-keypass");
    const body: Record<string, unknown> = {
      connection_type: this.value("s-type"),
      gateway_ip: this.value("s-ip"),
      gateway_port: Number(this.value("s-port") || 3671),
      multicast_group: this.value("s-mcast") || "224.0.23.12",
      individual_address: this.value("s-ia"),
      keyring_path: this.value("s-keyring"),
      user_id: this.value("s-user") || "auto",
      auto_connect: auto,
    };
    if (password) body.keyring_password = password;
    void this.act(
      async () => {
        await api.post("api/bus/settings", body);
        if (connect) {
          await api.post("api/bus/connect", {});
        }
      },
      connect ? "Connected to the bus" : "Gateway settings saved",
    ).then(
      () => (this.dialog = false),
      () => undefined,
    );
  }

  render() {
    const b: BusStatus = store.bus;
    const s = b.settings;
    const ip = b.gateway?.ip || s.gateway_ip;
    const connectedLabel =
      [b.gateway?.name || s.gateway_name, ip].filter(Boolean).join(" · ") ||
      (s.connection_type.startsWith("routing")
        ? `Routing ${s.multicast_group}`
        : "Connected");
    const chosen =
      s.gateway_name ||
      s.gateway_ip ||
      (s.connection_type.startsWith("routing") ? "Routing" : "");
    // A chosen but unconnected gateway says so, since picking one and connecting are two steps
    // when auto-connect is off (a restart, a refused tunnel).
    const label =
      b.state === "CONNECTED"
        ? connectedLabel
        : b.state === "CONNECTING"
          ? `${chosen} · ${tr("connecting…")}`
          : chosen
            ? `${chosen} · ${b.retrying ? tr("reconnecting…") : tr("not connected")}`
            : tr("No gateway");
    return html`
      <sl-dropdown
        hoist
        placement="bottom-end"
        @sl-show=${() => this.gateways.length || this.scan()}
      >
        <button class="trigger" slot="trigger" title=${b.error ?? b.state}>
          <span class="dot ${b.state}"></span
          ><span class="name">${label}</span>${icon("down", 12)}
        </button>
        <sl-menu @sl-select=${this.onMenu}>
          ${
            b.error && b.state === "DISCONNECTED"
              ? html`<sl-menu-label
                    ><span
                      style="color:var(--ha-error);white-space:normal;display:block;max-width:360px"
                      >${b.error}</span
                    ></sl-menu-label
                  ><sl-divider></sl-divider>`
              : nothing
          }
          <sl-menu-item
            value="connect"
            ?disabled=${b.state !== "DISCONNECTED" || this.busy}
            >Connect${b.state === "DISCONNECTED" && s.gateway_ip ? html` <span class="sub">to ${s.gateway_name || s.gateway_ip}</span>` : nothing}</sl-menu-item
          >
          <sl-menu-item
            value="disconnect"
            ?disabled=${b.state === "DISCONNECTED"}
            >${tr("Disconnect")}</sl-menu-item
          >
          <sl-menu-item value="monitor">${tr("Group monitor")}</sl-menu-item>
          <sl-divider></sl-divider>
          <sl-menu-label>${tr("Gateways on the network")}</sl-menu-label>
          ${this.scanning ? html`<sl-menu-item disabled><sl-spinner style="font-size:14px"></sl-spinner>${tr("Scanning…")}</sl-menu-item>` : nothing}
          ${this.gateways.map(
            (g, i) =>
              html`<sl-menu-item
                value="gw:${i}"
                type="checkbox"
                ?checked=${s.gateway_ip === g.ip}
              >
                ${g.name || g.ip}<br /><span class="sub"
                  >${g.ip}:${g.port} · ${g.individual_address} ·
                  ${g.tunnelling ? (g.tunnelling_tcp ? "tunnel UDP/TCP" : "tunnel UDP") : ""}${g.routing ? " · routing" : ""}${g.secure_tunnelling ? " · IP Secure required" : ""}</span
                >
              </sl-menu-item>`,
          )}
          ${!this.scanning && !this.gateways.length ? html`<sl-menu-item disabled>${tr("None found yet")}</sl-menu-item>` : nothing}
          <sl-menu-item value="scan">${tr("Scan again")}</sl-menu-item>
          <sl-divider></sl-divider>
          <sl-menu-item value="settings"
            >${tr("Connection settings…")}</sl-menu-item
          >
        </sl-menu>
      </sl-dropdown>
      ${b.error && b.state === "DISCONNECTED" ? html`<sl-tooltip content=${b.error}><span class="hint" style="color:var(--ha-error)">${tr("error")}</span></sl-tooltip>` : nothing}
      <sl-dialog
        label=${tr("Connection settings")}
        ?open=${this.dialog}
        style="--width: 560px"
        @sl-after-hide=${() => (this.dialog = false)}
      >
        <div class="row">
          <sl-select
            id="s-type"
            label=${tr("Connection")}
            value=${s.connection_type}
            hoist
            >${TYPES.map(([v, l]) => html`<sl-option value=${v}>${l}</sl-option>`)}</sl-select
          >
        </div>
        <div class="row">
          <sl-input
            id="s-ip"
            label=${tr("Gateway IP")}
            value=${s.gateway_ip}
            placeholder="192.168.1.100"
          ></sl-input>
          <sl-input
            id="s-port"
            label="Port"
            type="number"
            value=${String(s.gateway_port)}
            style="max-width:110px"
          ></sl-input>
        </div>
        <div class="row">
          <sl-input
            id="s-mcast"
            label=${tr("Multicast group (routing)")}
            value=${s.multicast_group}
          ></sl-input>
          <sl-input
            id="s-ia"
            label=${tr("Own individual address (optional)")}
            value=${s.individual_address}
            placeholder="e.g. 4.1.250"
          ></sl-input>
        </div>
        <div class="row">
          <sl-input
            id="s-keyring"
            label=${tr("Keyring (.knxkeys) for IP Secure")}
            value=${s.keyring_path}
            placeholder="/config/keyrings/project.knxkeys"
          ></sl-input>
          <input
            id="s-keyfile"
            type="file"
            accept=".knxkeys"
            hidden
            @change=${this.uploadKeyring}
          />
          <sl-button
            size="small"
            style="margin-top:22px"
            ?loading=${this.busy}
            @click=${() => (this.renderRoot.querySelector("#s-keyfile") as HTMLInputElement).click()}
            >${icon("upload", 14)} ${tr("Upload")}</sl-button
          >
          <sl-button
            size="small"
            style="margin-top:22px"
            @click=${() => (this.keyringPick = true)}
            >${icon("open", 14)} ${tr("Browse /share")}</sl-button
          >
        </div>
        <div class="row">
          <sl-input
            id="s-keypass"
            label=${tr("Keyring password (set when the keyring was exported)")}
            type="password"
            value=""
            placeholder=${s.keyring_password ? tr("Stored; leave empty to keep it") : ""}
            help-text=${s.keyring_password ? tr("A password is stored. Type a new one to replace it; the stored one is never sent to the browser.") : ""}
            password-toggle
          ></sl-input>
          <sl-button
            size="small"
            style="margin-top:22px"
            ?loading=${this.checking}
            @click=${this.checkKeyring}
            >${tr("Check")}</sl-button
          >
        </div>
        ${this.keyringInfo ? html`<div class="hint" style="margin:-4px 0 8px;white-space:pre-line">${this.keyringInfo}</div>` : nothing}
        <div class="row">
          <sl-select
            id="s-user"
            label=${tr("Tunnel user (IP Secure)")}
            hoist
            value=${s.user_id === null ? "auto" : String(s.user_id)}
            help-text=${tr("Home Assistant's integration usually occupies the first user in the keyring; pick another one for the editor.")}
          >
            <sl-option value="auto"
              >${tr("Automatic (first in keyring)")}</sl-option
            >
            ${this.tunnelUsers.map((u) => html`<sl-option value=${String(u.user_id)}>${tr("User")} ${u.user_id} (${u.address})</sl-option>`)}
            ${s.user_id !== null && !this.tunnelUsers.some((u) => u.user_id === s.user_id) ? html`<sl-option value=${String(s.user_id)}>${tr("User")} ${s.user_id}</sl-option>` : nothing}
          </sl-select>
        </div>
        <div class="row">
          <sl-checkbox id="s-auto" ?checked=${s.auto_connect}
            >${tr("Connect automatically when the add-on starts")}</sl-checkbox
          >
        </div>
        <span class="hint"
          >${tr("Home Assistant's KNX integration usually holds one tunnel on your gateway. If the gateway has a single tunnel slot, disconnect the integration first or use routing. Stored in /config/settings.json.")}</span
        >
        <sl-button slot="footer" @click=${() => (this.dialog = false)}
          >${tr("Cancel")}</sl-button
        >
        <sl-button
          slot="footer"
          ?loading=${this.busy}
          @click=${() => this.saveSettings(false)}
          >${tr("Save")}</sl-button
        >
        <sl-button
          slot="footer"
          variant="primary"
          ?loading=${this.busy}
          @click=${() => this.saveSettings(true)}
          >Save &amp; connect</sl-button
        >
      </sl-dialog>
      <xknx-file-dialog
        label=${tr("Choose keyring")}
        ext=".knxkeys"
        confirmLabel="Use"
        ?open=${this.keyringPick}
        @file-chosen=${(e: CustomEvent<{ path: string }>) => {
          this.keyringPick = false;
          const el = this.renderRoot.querySelector(
            "#s-keyring",
          ) as HTMLInputElement | null;
          if (el) el.value = e.detail.path;
        }}
        @sl-after-hide=${() => (this.keyringPick = false)}
      ></xknx-file-dialog>
    `;
  }
}
