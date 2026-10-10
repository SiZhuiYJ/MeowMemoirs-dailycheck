// utils/smoothScroll.ts
export const smoothScrollTo = (
    element: HTMLElement,
    target: number,
    duration = 300
) => {
    const start = element.scrollTop
    const change = target - start
    const startTime = performance.now()

    const animateScroll = (currentTime: number) => {
        const elapsed = currentTime - startTime
        const progress = Math.min(elapsed / duration, 1) // 保证不超过1

        // 缓动函数：ease-in-out
        const easeInOutQuad = (t: number) =>
            t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2

        element.scrollTop = start + change * easeInOutQuad(progress)

        if (progress < 1) {
            requestAnimationFrame(animateScroll)
        }
    }

    requestAnimationFrame(animateScroll)
}