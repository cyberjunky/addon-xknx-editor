/** Tiny shared state: current project info, revision, selection, dock tabs. Views subscribe and refetch. */
import { api, connectEvents, type ProjectInfo, type WsEvent } from "./api.js";

type Listener = () => void;
export type LeftTab = "buildings" | "topology" | "devices" | "group-addresses";
export type CenterTab =
  | "editor"
  | "overview"
  | "masslink"
  | "tools"
  | "recover"
  | "secure"
  | "docs"
  | "ai";
export type RightTab = "history" | "project" | "health";
export type BottomTab = "monitor" | "catalog";
export type Gateway = {
  name: string;
  ip: string;
  port: number;
  individual_address: string;
  tunnelling: boolean;
  tunnelling_tcp: boolean;
  routing: boolean;
  secure_tunnelling: boolean;
  secure_routing: boolean;
};
export type BusStatus = {
  state: "CONNECTED" | "CONNECTING" | "DISCONNECTED";
  error: string | null;
  connected_since: string | null;
  gateway: Gateway | null;
  telegrams: number;
  decoding?: {
    project: boolean;
    addresses: number;
    with_dpt: number;
    from_objects: number;
  };
  settings: {
    connection_type: string;
    gateway_ip: string;
    gateway_port: number;
    gateway_name: string;
    multicast_group: string;
    individual_address: string;
    keyring_path: string;
    keyring_password: string;
    user_id: number | null;
    local_ip: string;
    auto_connect: boolean;
  };
};
export type TelegramRecord = {
  id: number;
  time: string;
  direction: string;
  source: string;
  destination: string;
  destination_kind: string;
  destination_name?: string;
  destination_dpt?: string | null;
  apci: string;
  raw: string;
  value: unknown;
  unit: string | null;
};
const EMPTY_BUS: BusStatus = {
  state: "DISCONNECTED",
  error: null,
  connected_since: null,
  gateway: null,
  telegrams: 0,
  settings: {
    connection_type: "auto",
    gateway_ip: "",
    gateway_port: 3671,
    gateway_name: "",
    multicast_group: "224.0.23.12",
    individual_address: "",
    keyring_path: "",
    keyring_password: "",
    user_id: null,
    local_ip: "",
    auto_connect: false,
  },
};

class Store {
  project: ProjectInfo = { open: false, revision: 0 };
  revision = 0;
  selectedDevice: number | null = null;
  selectedGroupAddress: number | null = null;
  focus: "device" | "ga" | "space" | "line" = "device";
  selectedLine: { area: number; line: number | null } | null = null;
  selectedSpace: number | null = null;
  catalogQuery: { text: string; manufacturer: string } | null = null;
  /** Saved search the device overview is showing, from the Buildings dock. Durable rather than
   * one-shot: the overview may already be mounted, in which case nothing would consume it. */
  overviewIssue: "download" | "unassigned" | null = null;
  left: LeftTab = "topology";
  center: CenterTab = "editor";
  right: RightTab = "project";
  bottom: BottomTab = "monitor";
  bottomOpen = false;
  rightOpen = true;
  toast: { message: string; variant: "primary" | "success" | "danger" } | null =
    null;
  bus: BusStatus = EMPTY_BUS;
  telegrams: TelegramRecord[] = [];
  private listeners = new Set<Listener>();
  private stop: (() => void) | null = null;

  start(): void {
    void this.refresh();
    this.stop ??= connectEvents((e) => this.onEvent(e));
    try {
      const saved = JSON.parse(localStorage.getItem("xknx.layout") ?? "{}");
      for (const k of [
        "left",
        "center",
        "right",
        "bottom",
        "bottomOpen",
        "rightOpen",
      ] as const) {
        if (saved[k] !== undefined)
          (this as unknown as Record<string, unknown>)[k] = saved[k];
      }
      if ((this.center as string) === "topology") this.center = "editor";
      // The catalog has lived in the left dock and then the centre; a layout saved back then
      // would restore a tab that no longer exists there and leave the pane blank.
      if ((this.left as string) === "catalog") this.left = "devices";
      if ((this.center as string) === "catalog") this.center = "editor";
    } catch {
      /* no saved layout */
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(): void {
    for (const fn of this.listeners) fn();
  }

  async refreshBus(): Promise<void> {
    try {
      this.bus = await api.get<BusStatus>("api/bus");
    } catch {
      /* backend restarting */
    }
    this.notify();
  }

  async refresh(): Promise<void> {
    this.project = await api.get<ProjectInfo>("api/project");
    this.revision = this.project.revision;
    if (!this.project.open) this.selectedDevice = null;
    this.notify();
  }

  setLeft(tab: LeftTab): void {
    this.left = tab;
    this.persist();
  }

  setCenter(tab: CenterTab): void {
    this.center = tab;
    this.persist();
  }

  setRight(tab: RightTab): void {
    this.right = tab;
    this.rightOpen = true;
    this.persist();
  }

  setBottom(tab: BottomTab): void {
    this.bottom = tab;
    this.bottomOpen = true;
    this.persist();
  }

  toggleBottom(): void {
    this.bottomOpen = !this.bottomOpen;
    this.persist();
  }

  toggleRight(): void {
    this.rightOpen = !this.rightOpen;
    this.persist();
  }

  /** Compatibility with views written against the first single-view navigation. */
  setView(view: string): void {
    if (view === "project") {
      this.setLeft("topology");
      this.setCenter("editor");
    } else if (view === "catalog") this.setBottom("catalog");
    else if (view === "group-addresses") this.setLeft("group-addresses");
    else if (view === "buildings") this.setLeft("buildings");
  }

  /** Show the device overview, optionally narrowed to one of the saved searches. */
  showOverview(issue: "download" | "unassigned" | null = null): void {
    this.overviewIssue = issue;
    this.setCenter("overview");
  }

  openCatalog(text: string, manufacturer = ""): void {
    this.catalogQuery = { text, manufacturer };
    this.setBottom("catalog");
  }

  select(device: number | null): void {
    this.selectedDevice = device;
    if (device !== null) {
      this.center = "editor";
      this.focus = "device";
      if (this.left !== "devices") this.left = "topology";
    }
    this.notify();
  }

  selectLine(area: number, line: number | null): void {
    this.selectedLine = { area, line };
    this.center = "editor";
    this.focus = "line";
    this.notify();
  }

  selectSpace(id: number | null): void {
    this.selectedSpace = id;
    if (id !== null) {
      this.center = "editor";
      this.focus = "space";
      this.left = "buildings";
    } else if (this.focus === "space") this.focus = "device";
    this.notify();
  }

  selectGroupAddress(id: number | null): void {
    this.selectedGroupAddress = id;
    if (id !== null) {
      this.center = "editor";
      this.focus = "ga";
      this.left = "group-addresses";
    } else if (this.focus === "ga") this.focus = "device";
    this.notify();
  }

  say(
    message: string,
    variant: "primary" | "success" | "danger" = "primary",
  ): void {
    this.toast = { message, variant };
    this.notify();
    window.setTimeout(() => {
      this.toast = null;
      this.notify();
    }, 4000);
  }

  private persist(): void {
    try {
      localStorage.setItem(
        "xknx.layout",
        JSON.stringify({
          left: this.left,
          center: this.center,
          right: this.right,
          bottom: this.bottom,
          bottomOpen: this.bottomOpen,
          rightOpen: this.rightOpen,
        }),
      );
    } catch {
      /* storage unavailable */
    }
    this.notify();
  }

  private onEvent(e: WsEvent): void {
    if (e.type === "revision") {
      this.revision = e.revision;
      void this.refresh();
    } else if (e.type === "bus") {
      this.bus = e.bus;
      this.notify();
    } else if (e.type === "telegram") {
      this.telegrams.push(e.telegram);
      if (this.telegrams.length > 1000)
        this.telegrams.splice(0, this.telegrams.length - 1000);
      this.notify();
    }
  }
}

export const store = new Store();
