// useDynamicRefs.ts
export function useDynamicRefs() {
    const refs = ref<Record<number, HTMLElement>>({})
    const setRef = (key: number) => (el: any) => {
        console.log('setRef', key, el)
        if (el) refs.value[key] = el
    }
    return { refs, setRef }
}
export function useDVideoRefs() {
    const vRefs = ref<Record<number, HTMLVideoElement>>({})
    const setVRef = (key: number) => (el: any) => {
        console.log('setVRef', key, el)
        if (el) vRefs.value[key] = el
    }
    return { vRefs, setVRef }
}

export function useDTextRefs() {
    const tRefs = ref<Record<number, HTMLElement>>({})
    const setTRef = (key: number) => (el: any) => {
        console.log('setTRef', key, el)
        if (el) tRefs.value[key] = el
    }
    return { tRefs, setTRef }
}
