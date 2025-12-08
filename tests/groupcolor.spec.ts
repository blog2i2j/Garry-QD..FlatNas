import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import GridPanel from '../src/components/GridPanel.vue'
import { useMainStore } from '../src/stores/main'

describe('Group title color CSS variable', () => {
  it('injects CSS var when appConfig changes', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ groups: [], widgets: [], appConfig: {} }),
    })
    const pinia = createPinia(); setActivePinia(pinia)
    const wrapper = mount(GridPanel, { global: { plugins: [pinia] } })
    const store = useMainStore()
    store.appConfig.groupTitleColor = '#ff4757'
    await wrapper.vm.$nextTick()
    const contentDiv = wrapper.find('.flex-1')
    const value = (contentDiv.element as HTMLElement).style.getPropertyValue('--group-title-color')
    expect(value).toBe('#ff4757')
  })
})

