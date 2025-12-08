import { describe, it, expect, vi } from "vitest";
import { createApp } from "vue";
import { createPinia } from "pinia";
import SettingsModal from "@/components/SettingsModal.vue";

describe("SettingsModal", () => {
  it("imports and mounts without error", () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ groups: [], widgets: [], appConfig: {} }),
    });
    expect(SettingsModal).toBeDefined();
    const app = createApp(SettingsModal, { show: false });
    app.use(createPinia());
    const el = document.createElement("div");
    document.body.appendChild(el);
    app.mount(el);
    app.unmount();
    expect(true).toBe(true);
  });
});
