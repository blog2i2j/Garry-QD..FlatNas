<script setup lang="ts">
import { watch, onMounted, ref } from "vue";
import { useStorage, useDebounceFn, useIntervalFn } from "@vueuse/core";
import type { WidgetConfig } from "@/types";
import { useMainStore } from "../stores/main";

const props = defineProps<{ widget: WidgetConfig }>();
const store = useMainStore();

const isFocused = ref(false);

const localData = ref("");
const localBackup = useStorage<string>(`flatnas-memo-backup-${props.widget.id}`, "");
let suppressSave = false;

const autoSave = useDebounceFn(async () => {
  if (!store.isLogged) return;
  Reflect.set(props.widget as unknown as Record<string, unknown>, "data", localData.value);
  await store.saveWidget(props.widget.id, localData.value);
  store.socket.emit("memo:update", {
    token: store.token || localStorage.getItem("flat-nas-token"),
    widgetId: props.widget.id,
    content: localData.value,
  });
}, 1000);

onMounted(() => {
  // 优先使用本地备份，其次才是服务端数据 (仅作为初始值，不再同步)
  if (localBackup.value) {
    localData.value = localBackup.value;
  } else if (props.widget.data) {
    localData.value = props.widget.data;
  }
});

watch(localData, (newVal) => {
  if (typeof newVal === "string") {
    localBackup.value = newVal;
    if (!suppressSave) autoSave();
  }
});

// Watch for prop changes (e.g. initial load or other reasons)
watch(
  () => props.widget.data,
  (newVal) => {
    if (typeof newVal === "string" && newVal !== localData.value) {
      // 如果正在编辑中，不接受来自服务端的更新，防止回滚
      if (isFocused.value) return;

      suppressSave = true;
      localData.value = newVal;
      localBackup.value = newVal;
      suppressSave = false;
    }
  },
  { immediate: true },
);

const handleScrollIsolation = (e: WheelEvent) => {
  const el = e.currentTarget as HTMLElement;
  const { scrollTop, scrollHeight, clientHeight } = el;
  const delta = e.deltaY;

  const isAtTop = scrollTop <= 0;
  const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1;

  if ((isAtTop && delta < 0) || (isAtBottom && delta > 0)) {
    e.preventDefault();
    e.stopPropagation();
  }
};

// --- Heartbeat / Polling Mechanism ---
// Active (Focused): Stop polling, broadcast updates (handled by autoSave).
// Inactive (Blurred): Start polling, receive updates.
const { pause, resume } = useIntervalFn(
  async () => {
    // Only poll if logged in and not focused
    if (store.isLogged && !isFocused.value) {
      try {
        const headers = store.getHeaders();
        const res = await fetch(`/api/widgets/${props.widget.id}`, { headers });
        if (res.ok) {
          const widgetData = await res.json();
          // Check if data changed
          if (
            widgetData &&
            typeof widgetData.data === "string" &&
            widgetData.data !== props.widget.data
          ) {
            // Update store, which triggers the watch handler below
            const w = store.widgets.find((w) => w.id === props.widget.id);
            if (w) w.data = widgetData.data;
          }
        }
      } catch (e) {
        console.error("Memo polling failed", e);
      }
    }
  },
  30000, // Poll every 30s
  { immediate: false },
);

watch(
  isFocused,
  (focused) => {
    if (focused) {
      pause();
    } else {
      resume();
    }
  },
  { immediate: true },
);
</script>

<template>
  <div
    class="w-full h-full p-4 rounded-2xl backdrop-blur border border-white/10 relative group"
    :class="!widget.textColor ? 'text-gray-700' : ''"
    :style="{
      backgroundColor: `rgba(254, 249, 195, ${widget.opacity ?? 0.9})`,
      color: widget.textColor,
    }"
  >
    <textarea
      :readonly="!store.isLogged"
      v-model="localData"
      @focus="isFocused = true"
      @blur="isFocused = false"
      @wheel="handleScrollIsolation"
      class="w-full h-full bg-transparent resize-none outline-none text-sm placeholder-gray-600 font-medium"
      :placeholder="store.isLogged ? '写点什么...' : '请先登录'"
    ></textarea>
  </div>
</template>
