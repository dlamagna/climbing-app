import { describe, expect, it, vi } from "vitest";
import { hardRefresh } from "./hardRefresh";

describe("hardRefresh", () => {
  it("unregisters workers, deletes caches, then reloads", async () => {
    const order: string[] = [];
    await hardRefresh({
      serviceWorker: { getRegistrations: async () => [{ unregister: async () => void order.push("unreg") }] },
      caches: { keys: async () => ["a", "b"], delete: async (k) => void order.push("del " + k) },
      reload: () => order.push("reload"),
    });
    expect(order).toEqual(["unreg", "del a", "del b", "reload"]);
  });

  it("still reloads when APIs are missing or fail", async () => {
    const reload = vi.fn();
    await hardRefresh({
      serviceWorker: { getRegistrations: async () => { throw new Error("x"); } },
      reload,
    });
    expect(reload).toHaveBeenCalledOnce();
  });
});
