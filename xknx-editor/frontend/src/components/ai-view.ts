import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api } from "../api.js";
import { store } from "../store.js";
import { t as tr } from "../i18n.js";

type Status = {
  mcp: { enabled: boolean; path: string; port: number | null; tools: string[] };
};

/** Centre-dock "AI": how to drive the editor from an LLM through the MCP server (the desktop app's AI tab). */
@customElement("xknx-ai-view")
export class AiView extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 8px 16px 16px;
      font-size: 13px;
      max-width: 90ch;
    }
    p {
      line-height: 1.5;
    }
    .muted {
      color: var(--ha-text-2);
    }
    .ok {
      color: var(--ha-success);
    }
    .warn {
      color: var(--ha-warning);
    }
    pre {
      background: color-mix(in srgb, var(--ha-text) 6%, transparent);
      padding: 10px 12px;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 12px;
    }
    code {
      font-family: ui-monospace, Menlo, Consolas, monospace;
    }
    .tools {
      columns: 3;
      column-gap: 24px;
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    .tools div {
      break-inside: avoid;
    }
    h4 {
      margin: 16px 0 6px;
      font-weight: 500;
    }
    .group {
      color: var(--ha-text-2);
      margin-top: 8px;
    }
  `;

  @state() private status: Status | null = null;
  private unsubscribe = () => {};

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = store.subscribe(() => this.requestUpdate());
    void api.get<Status>("api/status").then((s) => (this.status = s));
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    super.disconnectedCallback();
  }

  render() {
    const m = this.status?.mcp;
    const host = window.location.hostname || "homeassistant.local";
    const url = `http://${host}:${m?.port ?? "<add-on port>"}/mcp`;
    const groups = new Map<string, string[]>();
    for (const t of m?.tools ?? []) {
      const g = t.split("_")[0];
      groups.set(g, [...(groups.get(g) ?? []), t]);
    }
    return html`
      <p>
        The editor exposes everything it can do as tools for an LLM through the
        <strong>Model Context Protocol</strong>: open and edit the project,
        browse the catalog, connect to the bus, watch telegrams, program
        devices, recover from the bus. A model working through these tools acts
        exactly as a user clicking in this window, on the same live project and
        connection. Editing is undoable; programming and bus writes are not.
      </p>
      <p>
        Status:
        ${m ? (m.enabled ? html`<span class="ok">enabled</span>, ${m.tools.length} tools at <code>${url}</code>` : html`<span class="warn">disabled</span>. Set the add-on option <code>mcp_token</code> (Settings → Add-ons → XKNX Editor → Configuration) and restart the add-on.`) : "…"}
      </p>
      <h4>${tr("Connect a client")}</h4>
      <p>
        Every request needs
        <code>Authorization: Bearer &lt;mcp_token&gt;</code>. The endpoint
        listens on the add-on's own port on the Home Assistant host (not through
        Ingress), so it is reachable from your LAN. Treat the token as a
        password.
      </p>
      <p class="muted">
        Claude Desktop (<code>claude_desktop_config.json</code>) or any client
        that speaks Streamable HTTP:
      </p>
      <pre>
{
  "mcpServers": {
    "xknx-editor": {
      "type": "http",
      "url": "${url}",
      "headers": { "Authorization": "Bearer &lt;mcp_token&gt;" }
    }
  }
}</pre>
      <p class="muted">
        Home Assistant's own MCP client integration (<em
          >Settings → Devices &amp; services → Add integration → Model Context
          Protocol</em
        >) can also use this URL, which lets Assist talk to the editor.
      </p>
      <h4>${tr("Working with it")}</h4>
      <p>
        Good first prompts: "list the devices without an individual address",
        "which group addresses have no sender", "link object 1 of device 1.1.5
        to 1/2/3", "copy the kitchen actuator twice and create group addresses
        for it", "test before programming 1.1.7 and tell me what would change".
        Ask the model to read a value back after every change; the tool results
        are the ground truth.
      </p>
      ${
        m?.tools.length
          ? html`<h4>${tr("Tools")} (${m.tools.length})</h4>
              ${[...groups.entries()].map(
                ([g, names]) =>
                  html`<div class="group">${g}</div>
                    <div class="tools">
                      ${names.map((n) => html`<div>${n}</div>`)}
                    </div>`,
              )}`
          : nothing
      }
    `;
  }
}
