/** Relative-path API client (works under the Ingress prefix) plus the revision WebSocket. */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type ProjectInfo = {
  open: boolean;
  id?: string;
  name?: string;
  path?: string;
  group_address_style?: string;
  device_count?: number;
  can_undo?: boolean;
  can_redo?: boolean;
  saved_at?: string | null;
  recent?: { path: string; name: string; opened_at: string; open: boolean }[];
  revision: number;
};

export type DeviceSummary = {
  id: number;
  name: string;
  individual_address: string | null;
  /** The device's line ("4.1"), for one without an individual address. */
  line?: string | null;
  address: number | null;
  description?: string;
  product_name: string;
  hardware_name?: string;
  manufacturer_name: string;
  order_number: string;
  serial_number?: string;
  application_name?: string;
  application_id?: string;
  application_loaded: boolean;
  individual_address_loaded?: boolean;
  parameters_loaded?: boolean;
  communication_part_loaded?: boolean;
  last_download?: string | null;
  space_id?: number | null;
  room?: string;
  download_required?: boolean;
  resolved: boolean;
};

export type Segment = {
  id: number;
  number: number;
  medium_type: string;
  name: string;
  devices: DeviceSummary[];
  /** Bus load of the segment: what one power supply feeds. */
  device_count: number;
  /** Total draw in mA of the devices whose product data is in the catalog. */
  current_ma: number;
  /** Devices left out of `current_ma` because the catalog has no bus current for them. */
  unknown: number;
  /** Power supplies placed on this segment (listed, not summed: no rated output in the data). */
  power_supplies: string[];
};
export type Line = {
  id: number;
  address: number;
  name: string;
  segments: Segment[];
};
export type Area = { id: number; address: number; name: string; lines: Line[] };
export type Topology = {
  index: number;
  name: string;
  areas: Area[];
  unresolved: string[];
};

export type UiNode =
  | { type: "tab"; id: string | null; text: string; children: UiNode[] }
  | {
      type: "block";
      id: string;
      text: string;
      inline: boolean;
      layout: string;
      children: UiNode[];
    }
  | {
      type: "parameter";
      ref_id: string;
      label: string;
      value: string;
      default: string;
      widget: Widget;
      indent: number;
      suffix: string | null;
      access: string;
    }
  | { type: "com_object"; ref_id: string; number: number; name: string }
  | { type: "separator"; id: string; text: string | null }
  | { type: "button"; id: string; text: string };

export type Widget =
  | { type: "enum"; choices: { value: number; label: string; id: string }[] }
  | { type: "number" | "slider"; min: number; max: number; increment: number }
  | {
      type: "float" | "float_slider";
      min: number;
      max: number;
      increment: number | null;
    }
  | { type: "checkbox" }
  | { type: "text"; max_length: number | null }
  | { type: "time"; unit: string; min: number; max: number }
  | { type: "progress"; min: number; max: number }
  | { type: "date" }
  | { type: "ip" }
  | { type: "picture"; ref_id: string }
  | { type: "none" }
  | { type: "color" }
  | { type: "rawdata" };

export type ComObject = {
  ref_id: string;
  db_id: number | null;
  number: number;
  name: string;
  function_text: string;
  dpt_codes: string[];
  object_size: string;
  priority: string;
  flags: Record<string, boolean>;
  locked: Record<string, boolean>;
  links: {
    id: number;
    group_address_id: number;
    text: string;
    name: string;
    datapoint_type: string | null;
    is_sending: boolean;
  }[];
};

export type GroupAddress = {
  id: number;
  address: number;
  text: string;
  name: string;
  datapoint_type: string | null;
  links: number[];
  description: string;
};

export type GroupRange = {
  id: number;
  name: string;
  range_start: number;
  range_end: number;
  children: GroupRange[];
  group_addresses: GroupAddress[];
};

export type Product = {
  product_ref_id: string;
  hardware2program_ref_id: string;
  name: string | null;
  order_number: string | null;
  application_id: string | null;
  manufacturer_id: string;
  manufacturer_name: string | null;
  /** The application program's real name; the id alone means nothing to a reader. */
  application_name?: string;
  application_version?: number | null;
};

export type Job = {
  id: string;
  kind: string;
  status: string;
  progress: number | null;
  stage: string;
  result: unknown;
  error: string | null;
};

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),

  async waitJob(job: Job): Promise<Job> {
    let current = job;
    while (current.status === "queued" || current.status === "running") {
      await new Promise((r) => setTimeout(r, 500));
      current = await request<Job>("GET", `api/jobs/${current.id}`);
    }
    if (current.status === "failed")
      throw new ApiError(500, current.error ?? "job failed");
    return current;
  },
};

export type RevisionEvent = {
  type: "revision";
  revision: number;
  structural?: boolean;
  device?: number;
  project?: string | null;
};
export type JobEvent = { type: "job"; job: Job };
export type LogEntry = {
  id: number;
  time: string;
  level: string;
  logger: string;
  message: string;
};
export type LogEvent = { type: "log"; entry: LogEntry };
export type WsEvent =
  | RevisionEvent
  | JobEvent
  | LogEvent
  | { type: "bus"; bus: import("./store.js").BusStatus }
  | { type: "telegram"; telegram: import("./store.js").TelegramRecord }
  | { type: "hello"; revision: number }
  | { type: "ping" };

/** Opens the WebSocket next to the page and reconnects on drop; listeners get every event. */
export function connectEvents(onEvent: (event: WsEvent) => void): () => void {
  let socket: WebSocket | null = null;
  let closed = false;
  let timer: number | undefined;
  const url = () => {
    const base = new URL("ws", document.baseURI);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    return base.toString();
  };
  const open = () => {
    if (closed) return;
    socket = new WebSocket(url());
    socket.onmessage = (m) => onEvent(JSON.parse(m.data));
    socket.onclose = () => {
      if (!closed) timer = window.setTimeout(open, 2000);
    };
  };
  open();
  return () => {
    closed = true;
    window.clearTimeout(timer);
    socket?.close();
  };
}
