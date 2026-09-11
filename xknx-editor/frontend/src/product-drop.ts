/** Accepting a catalog product dropped onto one of the left-dock trees.
 *
 * The catalog (centre dock) is the drag source. A drop creates the device, and optionally puts it
 * in a space, which is what makes dropping onto a room in the Buildings dock mean something more
 * than dropping onto the device list.
 *
 * The payload has its own MIME type so a product drag is never confused with the device drag the
 * overview uses to assign rooms: both would otherwise arrive as `text/plain`.
 */
import { api, ApiError } from "./api.js";
import { store } from "./store.js";
import { t as tr } from "./i18n.js";

export const PRODUCT_MIME = "application/x-xknx-product";

/** Whether this drag carries a catalog product, so a target can accept it and highlight. */
export function isProductDrag(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes(PRODUCT_MIME) ?? false;
}

/** Create the dropped product as a device, optionally inside `spaceId`. */
export async function dropProduct(
  e: DragEvent,
  spaceId: number | null = null,
): Promise<void> {
  const raw = e.dataTransfer?.getData(PRODUCT_MIME);
  if (!raw) return;
  const p = JSON.parse(raw) as { product_ref_id: string; name: string };
  try {
    const d = await api.post<{ id: number }>("api/devices", {
      product_ref_id: p.product_ref_id,
      name: p.name,
    });
    if (spaceId !== null)
      await api.patch(`api/devices/${d.id}`, { space_id: spaceId });
    await store.refresh();
    store.select(d.id);
    store.say(tr("Device added"), "success");
  } catch (err) {
    store.say(err instanceof ApiError ? err.message : String(err), "danger");
  }
}
