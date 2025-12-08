import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import SettingsModal from "../src/components/SettingsModal.vue";
import { useMainStore } from "../src/stores/main";

// Mock components
vi.mock("../src/components/IconUploader.vue", () => ({
  default: { template: '<div data-testid="icon-uploader"></div>' }
}));
vi.mock("../src/components/WallpaperLibrary.vue", () => ({
  default: { template: '<div data-testid="wallpaper-library"></div>' }
}));
vi.mock("../src/components/PasswordConfirmModal.vue", () => ({
  default: { template: '<div data-testid="password-confirm-modal"></div>' }
}));
// Mock vue-draggable-plus
vi.mock("vue-draggable-plus", () => ({
  VueDraggable: { template: '<div><slot></slot></div>' }
}));

describe("SettingsModal Color Reset", () => {
  it("resets title color to white when reset button is clicked", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useMainStore();
    
    // 初始化一个非白色的颜色
    store.appConfig.titleColor = "#ff0000";

    const wrapper = mount(SettingsModal, {
      props: {
        show: true
      },
      global: {
        plugins: [pinia]
      }
    });

    // 确保组件已渲染
    expect(wrapper.exists()).toBe(true);

    // 找到重置颜色按钮
    const resetButton = wrapper.find('button[title="重置颜色"]');
    expect(resetButton.exists()).toBe(true);

    // 点击按钮
    await resetButton.trigger("click");

    // 验证颜色是否重置为白色
    expect(store.appConfig.titleColor).toBe("#ffffff");
  });
});
