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
    });

    expect(wrapper.find("h3").text()).toBe("Test Library");

    // Wait for fetch
    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Check if fetch was called
    expect(global.fetch).toHaveBeenCalledWith("/api/backgrounds");
  });

  it("emits update:show when close is clicked", async () => {
    const wrapper = mount(WallpaperLibrary, {
      props: {
        show: true,
      },
    });

    // Find the close overlay or button
    // Based on component code, clicking self (overlay) emits update:show
    await wrapper.trigger("click");

    expect(wrapper.emitted("update:show")).toBeTruthy();
    expect(wrapper.emitted("update:show")?.[0]).toEqual([false]);
  });
});
