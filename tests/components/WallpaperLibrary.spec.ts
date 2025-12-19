import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import WallpaperLibrary from "../../src/components/WallpaperLibrary.vue";

// Mock VueDraggable
vi.mock("vue-draggable-plus", () => ({
  VueDraggable: {
    template: "<div><slot></slot></div>",
  },
}));

describe("WallpaperLibrary.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(["wall1.jpg", "wall2.jpg"]),
    });
  });

  it("renders correctly when shown", async () => {
    const wrapper = mount(WallpaperLibrary, {
      props: {
        show: true,
        title: "Test Library",
      },
      global: {
        stubs: {
          Teleport: true,
        },
      },
    });

    expect(wrapper.find("h3").text()).toBe("Test Library");

    // Wait for fetch
    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Check if fetch was called
    expect(global.fetch).toHaveBeenCalledWith("/api/backgrounds");
    expect(global.fetch).toHaveBeenCalledWith("/api/mobile_backgrounds");
  });

  it("emits update:show when close is clicked", async () => {
    const wrapper = mount(WallpaperLibrary, {
      props: {
        show: true,
      },
      global: {
        stubs: {
          Teleport: true,
        },
      },
    });

    const closeBtn = wrapper
      .findAll("button")
      .find((b) => b.text().trim() === "✕");

    expect(closeBtn).toBeTruthy();
    await closeBtn!.trigger("click");

    expect(wrapper.emitted("update:show")).toBeTruthy();
    expect(wrapper.emitted("update:show")?.[0]).toEqual([false]);
  });
});
