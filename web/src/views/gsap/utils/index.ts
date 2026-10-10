// utils.ts
import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(SplitText);

export interface StoryPageData {
    id: number;
    videoIndex: number;
    headline?: string;
    text: string;
    gradientClass: string;
    textAnimType: 'lines' | 'chars';
}

/**
 * 构建分页故事轮播的 GSAP 时间轴
 * @param container 容器元素（.multipage-story）
 * @param pages 页面数据数组
 * @returns GSAP Timeline
 */
export const buildStoryTimeline = (
    container: HTMLElement,
    pages: StoryPageData[],
    pageRefs?: Record<number, HTMLElement>,
    videoRefs?: Record<number, HTMLVideoElement>,
    textRefs?: Record<number, HTMLElement>
): gsap.core.Timeline => {
    const timeline = gsap.timeline({ defaults: { ease: 'none' } });
    const pageCount = pages.length;

    // 存储每页的 SplitText 实例
    const splitInstances: SplitText[] = [];

    // 预先为每页创建 SplitText 实例
    pages.forEach((page, idx) => {
        const textElem = textRefs?.[idx] || container.querySelector<HTMLElement>(`.story-text-${idx}`);
        if (textElem) {
            const split = new SplitText(textElem, { type: page.textAnimType });
            splitInstances.push(split);
        } else {
            splitInstances.push(null as any);
        }
    });

    // 获取每页的 DOM 元素
    const pageElements: HTMLElement[] = [];
    const videoElements: HTMLVideoElement[] = [];
    for (let i = 0; i < pageCount; i++) {
        const pageElem = pageRefs?.[i] || container.querySelector<HTMLElement>(`.story-page-${i}`);
        if (pageElem) pageElements.push(pageElem);
        const videoElem = videoRefs?.[i] || container.querySelector<HTMLVideoElement>(`.story-video-${i}`);
        if (videoElem) videoElements.push(videoElem);
    }

    // 1. 隐藏大标题（仅第一页有）
    const headline = container.querySelector('.carousel-headline');
    if (headline) timeline.fromTo(headline, { opacity: 1 }, { opacity: 0 }, 0);

    // 2. 第一页视频入场动画
    if (videoElements[0]) {
        timeline.fromTo(
            videoElements[0],
            { marginTop: '100vh' },
            {
                marginTop: 0,
                onStart: () => {
                    const v = videoElements[0];
                    if (v) {
                        v.currentTime = 0;
                        v.muted = true;
                        v.play();
                    }
                },
            },
            '<'
        );
    }

    // 3. 第一页文字动画
    const firstSplit = splitInstances[0];
    const ageData = pages[0]
    if (ageData)
        if (firstSplit) {
            const targets = ageData.textAnimType === 'lines' ? firstSplit.lines : firstSplit.chars;
            timeline.from(
                targets,
                {
                    rotationX: -100,
                    transformOrigin: '50% 50% -160px',
                    opacity: 0,
                    duration: 0.8,
                    ease: 'power3',
                    stagger: 0.25,
                },
                '>'
            );
        }

    // 4. 循环处理页面切换（从第0页切换到第1页、第1页到第2页...）
    for (let i = 0; i < pageCount - 1; i++) {
        const pageElem = pageElements[i];
        const pageNextElem = pageElements[i + 1];
        if (pageElem && pageNextElem) {
            // 当前页滑出：left 从 0 到 -100vw
            timeline.fromTo(
                pageElem,
                { duration: 0.8, left: 0 },
                { left: '-100vw' },
                '>'
            );
            // 下一页滑入：left 从 100vw 到 0
            timeline.fromTo(
                pageNextElem,
                { duration: 0.8, left: '100vw' },
                {
                    left: 0,
                    onStart: () => {
                        const v = videoElements[i + 1];
                        if (v) {
                            v.currentTime = 0;
                            v.muted = true;
                            v.play();
                        }
                    },
                },
                '<'
            );
            // 下一页文字动画
            const nextSplit = splitInstances[i + 1];
            if (nextSplit) {
                const ageData = pages[i + 1]
                if (ageData) {
                    const targets = ageData.textAnimType === 'lines' ? nextSplit.lines : nextSplit.chars;
                    // 根据文字动画类型选择不同效果
                    if (ageData.textAnimType === 'lines') {
                        timeline.from(
                            targets,
                            {
                                rotationX: -100,
                                transformOrigin: '50% 50% -160px',
                                opacity: 0,
                                duration: 0.8,
                                ease: 'power3',
                                stagger: 0.25,
                            },
                            '>'
                        );
                    } else {
                        timeline.from(
                            targets,
                            {
                                x: 150,
                                opacity: 0,
                                duration: 0.7,
                                ease: 'power4',
                                stagger: 0.04,
                            },
                            '>'
                        );
                    }
                }
            }
        }
    }

    return timeline;
};

/**
 * 构建横向滚动画廊的 GSAP 时间轴
 * @param trackElement - 画廊滚动容器（.gallery-track）
 * @param imgGap - 图片之间的间距（px），默认 40
 * @returns GSAP Timeline
 */
export const buildGalleryTimeline = (trackElement: HTMLElement, imgGap: number = 40): gsap.core.Timeline => {
    const galleryItems = gsap.utils.toArray<HTMLImageElement>(trackElement.querySelectorAll('img'));
    if (!galleryItems.length) return gsap.timeline();

    const timeline = gsap.timeline({ defaults: { ease: 'none' } });

    // 设置 CSS 变量（用于样式中的 gap）
    trackElement.style.setProperty('--img-gap', `${imgGap}px`);

    // 计算移动距离
    const viewportWidth = window.innerWidth + 200;
    const startX = viewportWidth;
    const endX = -trackElement.scrollWidth;
    const moveDistance = startX - endX;

    // 初始状态
    gsap.set(trackElement, { x: startX });
    gsap.set(galleryItems, { scale: 0.5, transformOrigin: 'center center' });

    // 整体横向移动
    timeline.fromTo(trackElement, { x: startX }, { x: endX, duration: 1 }, 0);

    // 为每张图片添加基于滚动进度的缩放动画
    galleryItems.forEach((item) => {
        const itemCenter = item.offsetLeft + item.offsetWidth / 2;
        const centerProgress = gsap.utils.clamp(
            0,
            1,
            (startX + itemCenter - viewportWidth / 2) / moveDistance,
        );
        const scaleDuration = gsap.utils.clamp(
            0.08,
            0.18,
            ((item.offsetWidth + imgGap) / moveDistance) * 1.4,
        );
        const scaleInStart = Math.max(0, centerProgress - scaleDuration);
        const scaleOutEnd = Math.min(1, centerProgress + scaleDuration);

        timeline
            .fromTo(item, { scale: 1.3 }, { scale: 1, duration: centerProgress - scaleInStart }, scaleInStart)
            .to(item, { scale: 0.7, duration: scaleOutEnd - centerProgress }, centerProgress);
    });

    return timeline;
};

/**
 * 构建山脉图片叠化时间轴（示例，根据原有逻辑补充）
 * @param mountainImages - 图片编号数组
 * @returns GSAP Timeline
 */

export function buildCosTimeline(images: number[]) {
    const n = images.length;
    if (n < 3 || n % 2 === 0) {
        console.warn('建议使用奇数个且不少于3张图片，以获得最佳对称效果');
    }

    // 中间索引
    const mid = (n - 1) / 2;

    // 缩放范围（可调整）
    const minFromScale = 0.4;
    const maxFromScale = 1;
    const minToScale = 0.6;
    const maxToScale = 0.9;

    // 水平位置范围（%）
    const leftMin = 8;
    const leftMax = 92;
    const leftStep = (leftMax - leftMin) / (n - 1);

    const tl = gsap.timeline({ defaults: { ease: 'none' } });

    images.forEach((id, i) => {
        const distance = Math.abs(i - mid);

        // 起始缩放：中心最大1，边缘最小0.4（同原效果）
        const fromScale = minFromScale + (maxFromScale - minFromScale) * (mid - distance) / mid;
        // 终点缩放：中心0.9，边缘0.6
        const toScale = minToScale + (maxToScale - minToScale) * (mid - distance) / mid;

        // zIndex：中心最高，边缘最低
        const zIndex = Math.floor((n + 1) / 2) - distance;

        // 目标 left
        const targetLeft = `${leftMin + i * leftStep}%`;

        tl.fromTo(
            `.mountain-img-${id}`,
            {
                scale: fromScale,
                zIndex: zIndex,
                left: '50%',        // 所有图片起始堆叠居中
            },
            {
                scale: toScale,
                left: targetLeft,
            },
            i === 0 ? undefined : '<' // 第一个正常排，后续全部与前一个同时开始
        );
    });

    return tl;
}