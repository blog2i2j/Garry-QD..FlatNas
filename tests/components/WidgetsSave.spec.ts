import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import MemoWidget from "../../src/components/MemoWidget.vue";
import TodoWidget from "../../src/components/TodoWidget.vue";
import { useMainStore } from "../../src/stores/main";
import type { TodoItem } from "../../src/types";

describe("Widget Auto Save Logic", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("MemoWidget calls saveWidget on input change", async () => {
    const store = useMainStore();

    // Force isLogged to be true
    Object.defineProperty(store, "isLogged", { get: () => true });

    store.saveWidget = vi.fn().mockResolvedValue(undefined);

    const widget = reactive({
      id: "m1",
      type: "memo",
      data: "initial",
      enable: true,
      isPublic: false,
    });
    const wrapper = mount(MemoWidget, {
      props: { widget },
    });

    const textarea = wrapper.find("textarea");
    await textarea.setValue("new content");

    // Trigger debounce (1000ms)
    vi.advanceTimersByTime(2000);

    expect(store.saveWidget).toHaveBeenCalledWith("m1", "new content");
    expect(widget.data).toBe("new content");
  });

  it("MemoWidget ignores prop updates while focused to prevent rollback", async () => {
    const store = useMainStore();
    Object.defineProperty(store, "isLogged", { get: () => true });

    const widget = reactive({
      id: "m2",
      type: "memo",
      data: "initial",
      enable: true,
      isPublic: false,
    });
    const wrapper = mount(MemoWidget, {
      props: { widget },
    });

    const textarea = wrapper.find("textarea");

    // 1. Simulate user typing
    await textarea.setValue("user typed");
    expect(textarea.element.value).toBe("user typed");

    // 2. Simulate focus
    await textarea.trigger("focus");
    // Verify internal state if possible, or trust the trigger. 
    // We can't easily access isFocused ref from outside without defineExpose, 
    // but the behavior change is what we test.

    // 3. Simulate backend update (prop change)
    widget.data = "server update";
    await wrapper.vm.$nextTick();

    // 4. Verify content did NOT change to "server update"
    expect(textarea.element.value).toBe("user typed");

    // 5. Simulate blur
    await textarea.trigger("blur");

    // 6. Simulate another backend update
    widget.data = "server update 2";
    await wrapper.vm.$nextTick();

    // 7. Now it SHOULD update
    expect(textarea.element.value).toBe("server update 2");
  });

  it("TodoWidget calls saveWidget on add item", async () => {
    const store = useMainStore();
    Object.defineProperty(store, "isLogged", { get: () => true });
    store.saveWidget = vi.fn().mockResolvedValue(undefined);

    const widget = reactive<{
      id: string;
      type: string;
      data: TodoItem[];
      enable: boolean;
      isPublic: boolean;
    }>({ id: "t1", type: "todo", data: [], enable: true, isPublic: false });
    const wrapper = mount(TodoWidget, {
      props: { widget },
    });

    const input = wrapper.find('input[placeholder="添加待办..."]');
    await input.setValue("Task 1");
    await input.trigger("keyup.enter");

    // Trigger debounce (500ms)
    vi.advanceTimersByTime(1000);

    expect(store.saveWidget).toHaveBeenCalled();
    expect(widget.data).toHaveLength(1);
    const first = widget.data[0]!;
    expect(first.text).toBe("Task 1");
  });
});
