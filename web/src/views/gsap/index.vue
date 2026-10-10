<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef, ref } from 'vue';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollSmoother } from 'gsap/ScrollSmoother';
import { SplitText } from 'gsap/SplitText';
import { buildStoryTimeline, buildGalleryTimeline, buildCosTimeline } from './utils';
import { useDynamicRefs, useDVideoRefs, useDTextRefs } from './composables/useDynamicRefs';
const { refs, setRef } = useDynamicRefs();
const { vRefs, setVRef } = useDVideoRefs();
const { tRefs, setTRef } = useDTextRefs();

gsap.registerPlugin(ScrollTrigger, ScrollSmoother, SplitText);

type DemoTarget = {
    key: string;
    label: string;
    selector: string;
    position?: string;
};

interface StoryPages {
    id: number;
    videoIndex: number;
    headline: string;
    text: string;
    gradientClass: string;
    textAnimType: 'lines' | 'chars';
}

const main = useTemplateRef('mainRef');

// 创建分页故事的 SplitText 实例
const demoTargets: DemoTarget[] = [
    { key: 'top', label: '回到顶部', selector: '#smooth-content', position: 'top top' },
    { key: 'a', label: '跳转到 A', selector: '.hero-block', position: 'top top' },
    { key: 'b', label: '跳转到 B', selector: '.video-narrative', position: 'top top' },
    { key: 'c', label: '跳转到 C', selector: '.scrolling-gallery', position: 'top top' },
    { key: 'd', label: '跳转到 D', selector: '.story-carousel', position: 'top top' },
    { key: 'e', label: '跳转到 E', selector: '.mountain-reveal', position: 'top top' },
];

// 故事页面数据：每页的视频编号、标题文本、背景渐变类、文字动画类型等
const storyPages = ref<StoryPages[]>([
    {
        id: 0,
        videoIndex: 16,
        headline: '民族风情',
        text: '丽江古城 · 夜色与歌',
        gradientClass: 'gradient-orange',
        textAnimType: 'lines',   // SplitText 类型：lines 或 chars
    },
    {
        id: 1,
        videoIndex: 44,
        headline: '',
        text: '大理洱海 · 风与自由',
        gradientClass: 'gradient-blue-2',
        textAnimType: 'chars',
    },
    {
        id: 2,
        videoIndex: 57,
        headline: '',
        text: '香格里拉 · 云上牧歌',
        gradientClass: 'gradient-blue',
        textAnimType: 'chars',
    },
]);

const video1 = useTemplateRef('video1Ref');

const galleryRef = useTemplateRef('galleryRef')

const galleryTrackRef = useTemplateRef('galleryTrackRef')

const multipageStoryRef = useTemplateRef('multipageStoryRef');

// 创建画廊的 SplitText 实例
const galleryImages = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20];

// 创建山峰的 SplitText 实例
const mountainImages = [31, 32, 33, 34, 35, 36, 37];

// 视频列表，包含需要在分页故事中使用的视频编号
const videoList = ref([16, 44, 54, 56, 57, 114, 114, 116, 177, 179, 180, 181, 334, 335, 337, 341, 342, 344, 350, 365, 371]);

// 创建查看的 SplitText 实例
const seeList = [
    { key: '48', label: '清晨的大理洱海' },
    { key: '58', label: '玉龙雪山的云海' },
    { key: '66', label: '香格里拉草原' },
    { key: '75', label: '雨后的丽江古城' },
    { key: '84', label: '西双版纳夜色' },
];

// 创建视频的 SplitText 实例
const seeVideoList = [
    { key: 53, label: '渡海缆车' },
    { key: 54, label: '玉龙雪山' },
    { key: 55, label: '出发啦~' }
];

// 创建 ScrollSmoother 实例
let smoother: ScrollSmoother | null = null;

// 创建 GSAP 上下文，以便在组件卸载时正确清理动画和 ScrollTrigger 实例
let ctx: gsap.Context | null = null;

// 画廊标题和分页故事的 SplitText 实例
let startTitle: SplitText | null = null;
let endTitle: SplitText | null = null;

// 画廊文字动画的 SplitText 实例
let page1Text: SplitText | null = null;
let page2Text: SplitText | null = null;
let page3Text: SplitText | null = null;

// 创建动画的 SplitText 实例
const scrollTo = (selector: string, position: string = 'center center') => {
    if (!smoother) return;
    smoother.scrollTo(selector, true, position);
};

onMounted(() => {
    if (!main.value) return;

    ctx = gsap.context(() => {
        // 创建 ScrollSmoother 实例
        smoother = ScrollSmoother.create({
            smooth: 2,// 平滑滚动的时间（秒）
            effects: true, // 是否启用 GSAP 效果
        });

        const verticalEl = main.value?.querySelector<HTMLElement>('.vertical');
        const getVerticalTextWidth = () => Math.ceil(verticalEl?.scrollWidth || 0);
        const getVerticalTextHeight = () => Math.ceil(verticalEl?.scrollHeight || 0);

        if (verticalEl)
            verticalEl.style.width = `${getVerticalTextWidth()}px`;

        // 第一个区块：图片缩放
        ScrollTrigger.create({
            trigger: '.hero-block',
            start: 'top top',
            end: '+=2000',
            pin: true,
            scrub: true,
            markers: true,
            invalidateOnRefresh: true,
            animation: gsap
                .timeline()
                .fromTo('.hero-img-container .boundary', { left: '100%', }, { left: '0%', }, '>')
                .fromTo('.hero-img-container', { width: '0', }, { width: '100%', }, '<')
                .fromTo('.hero-img-container .boundary', { width: '4px', }, { width: '0', }, '>')
                .fromTo('.horizontal .boundary', { width: '0%' }, { width: '100%' }, '>')
                .fromTo('.top-expand .text', { marginTop: '60px' }, { marginTop: '0' }, '>')
                .fromTo('.botton-expand .text', { marginBottom: '60px' }, { marginBottom: '0' }, '<')
                .fromTo('.horizontal .boundary', { width: '100%', marginTop: '0' }, { width: '50%', marginTop: '-60px' }, '>')
                .fromTo('.top-expand .text', { height: '60px' }, { height: '0' }, '<')
                .fromTo('.botton-expand', { height: '60px' }, { height: '0' }, '>')
                .fromTo('.horizontal .boundary', { width: '50%', rotation: 0, }, { width: '0', rotation: 90, ease: "back.inOut(1.7)", }, '>')
                .fromTo('.vertical .boundary', { height: '0' }, { height: () => `${getVerticalTextHeight()}px`, ease: "back.inOut(1.7)", }, '>')
                .fromTo('.vertical .right-expand', { width: '0' }, { width: () => `${getVerticalTextWidth() + 2}px`, }, '>')
                .fromTo('.hero-image', { scale: 1 }, { scale: 0.8 }, '>')
            // .fromTo('.video-player', { width: '80%', height: '80vh' }, { width: '100%', height: '100vh' }, '<')
        });

        // 第二个区块：视频+文字动画
        ScrollTrigger.create({
            trigger: '.video-narrative',
            start: 'top top',
            end: '+=1500',
            scrub: true,
            pin: true,
            markers: true,
            onUpdate(self) {
                const video = video1.value;
                if (!video) return;
                const dur = video.duration;
                if (isFinite(dur) && dur > 0) {
                    let target = self.progress * dur;
                    target = Math.min(Math.max(target, 0), dur);
                    video.currentTime = target;
                }
            },
            animation: gsap.timeline()
                .to('.narrative-text-first', { top: '50%', opacity: 1 })
                .to('.narrative-text-first', { top: '0', opacity: 0 })
                .to('.narrative-text-second', { top: '60%', opacity: 1 })
                .to('.narrative-text-second', { top: '40%', opacity: 0 })
        });

        // 第三个区块：横向滚动画廊
        if (galleryTrackRef.value) {
            const galleryTimeline = buildGalleryTimeline(galleryTrackRef.value, 40);
            const galleryImagesCount = galleryImages.length; // 获取图片数量

            ScrollTrigger.create({
                trigger: galleryRef.value,
                pin: true,
                start: 'top top',
                end: () => `+=${Math.max(400, galleryImagesCount * 450)}`, // 使用 galleryImagesCount
                scrub: true,
                markers: true,
                animation: galleryTimeline,
            });
        }

        // 画廊开始标题动画
        startTitle = SplitText.create(".gallery-title-start", { type: "chars" });
        ScrollTrigger.create({
            trigger: '.gallery-title-start',
            start: `top-=${window.innerHeight * 1.2} top`,
            end: '+=1000',
            scrub: true,
            markers: true,
            animation: gsap.timeline()
                .from(startTitle?.chars, {
                    rotationX: -100,
                    transformOrigin: "50% 50% -160px",
                    opacity: 0,
                    duration: 0.8,
                    ease: "power3",
                    stagger: 0.25
                })
                .fromTo('.gallery-title-start', { opacity: 1 }, { opacity: 0, duration: 0.5 }),
        });

        const totalImages = galleryImages.length || 0; // 再次获取或复用上面的变量

        // 画廊结束标题动画
        endTitle = SplitText.create(".gallery-title-end", { type: "chars" });
        ScrollTrigger.create({
            trigger: '.gallery-title-end',
            start: `top+=${Math.max(totalImages * 450 - 800, 0)} top`,
            end: '+=800',
            scrub: true,
            markers: true,
            animation: gsap.timeline()
                .from(endTitle?.chars, {
                    x: 150,
                    opacity: 0,
                    duration: 0.7,
                    ease: "power4",
                    stagger: 0.04
                }),
        });

        // 分页故事轮播
        if (multipageStoryRef.value && storyPages.value.length) {

            const storyTimeline = buildStoryTimeline(
                multipageStoryRef.value,
                storyPages.value,
                refs.value,
                vRefs.value,
                tRefs.value
            );

            ScrollTrigger.create({
                trigger: '.story-carousel',
                pin: true,
                start: 'top top',
                end: '+=2000',
                scrub: true,
                markers: true,
                animation: storyTimeline,
            });
        }

        // 第五区块：雪山与峡谷
        const cosTimeline = buildCosTimeline(mountainImages);

        ScrollTrigger.create({
            trigger: '.mountain-reveal',
            pin: true,
            start: 'top top',
            end: '+=800',
            scrub: true,
            markers: true,
            animation: cosTimeline
        });

        // 雪山标题动画
        ScrollTrigger.create({
            trigger: '.mountain-reveal',
            start: 'top top',
            end: '+=600',
            scrub: true,
            markers: true,
            animation: gsap.timeline()
                .to(".mountain-headline", {
                    rotationX: 100,
                    transformOrigin: `50% 50% -${window.innerHeight * 0.5}`,
                    opacity: 0,
                    duration: 0.8,
                    ease: "power3",
                    stagger: 0.25
                })
        });

        // 视差滚动区块（图片）
        seeList.forEach(value => {
            const getParallaxDistance = () => window.innerHeight * 0.5;
            ScrollTrigger.create({
                trigger: `.scenery-block-${value.key}`,
                start: 'top bottom',
                end: 'bottom top',
                scrub: true,
                markers: true,
                invalidateOnRefresh: true,
                animation: gsap.timeline({ defaults: { ease: 'none' } })
                    .fromTo(`.scenery-img-${value.key}`, {
                        transformOrigin: "50% 50%",
                        y: () => -getParallaxDistance()
                    }, {
                        y: () => 0,
                        duration: 0.5
                    })
                    .to(`.scenery-img-${value.key}`, {
                        y: () => getParallaxDistance(),
                        duration: 0.5
                    })
            });
        });

        // 视差滚动区块（视频）
        seeVideoList.forEach(value => {
            const getParallaxDistance = () => window.innerHeight * 0.5;
            ScrollTrigger.create({
                trigger: `.scenery-block-${value.key}`,
                start: 'top bottom',
                end: 'bottom top',
                scrub: true,
                markers: true,
                invalidateOnRefresh: true,
                animation: gsap.timeline({ defaults: { ease: 'none' } })
                    .fromTo(`.scenery-video-${value.key}`, {
                        transformOrigin: "50% 50%",
                        y: () => -getParallaxDistance()
                    }, {
                        onStart() {
                            const videoContext = vRefs.value[value.key];
                            if (videoContext) {
                                videoContext.muted = true;
                                videoContext.play();
                            }
                        },
                        y: () => 0,
                        duration: 0.5
                    })
                    .to(`.scenery-video-${value.key}`, {
                        y: () => getParallaxDistance(),
                        duration: 0.5
                    })
            });
        });

    }, main.value);
});

onUnmounted(() => {
    ctx?.revert();
    startTitle?.revert();
    endTitle?.revert();
    page1Text?.revert();
    page2Text?.revert();
    page3Text?.revert();
    ctx = null;
    startTitle = null;
    endTitle = null;
    page1Text = null;
    page2Text = null;
    page3Text = null;
    smoother = null;
});
</script>

<template>
    <div id="smooth-wrapper" ref="mainRef">
        <div id="smooth-content">
            <header class="header">
                <h1 class="title">GreenSock ScrollSmoother on a Vue3 App</h1>
                <div class="button-group">
                    <button v-for="item in demoTargets" :key="item.key" class="button"
                        @click="scrollTo(item.selector, item.position)">
                        {{ item.label }}
                    </button>
                </div>
                <p>示例：点击上面的按钮体验「锚点跳转 + 平滑滚动 + ScrollTrigger 固定动画」。</p>
            </header>

            <!-- 区块 A：图片缩放 -->
            <div class="hero-block gradient-purple">
                <div class="hero-image">
                    <div class="hero-img-container">
                        <img src="/gsap/yunnan/tourism/t-1.jpg" class="hero-img" alt="">
                        <span class="boundary"></span>
                    </div>

                    <!-- 横向展开文字 -->
                    <div class="expand-text horizontal">
                        <span class="top-expand">
                            <p class="text">云南不只有风景，</p>
                        </span>
                        <span class="boundary"></span>
                        <span class="botton-expand">
                            <p class="text">还有每一张旅途里的笑脸。</p>
                        </span>
                    </div>
                    <!-- 纵向展开文字 -->
                    <div class="expand-text vertical">
                        <span class="right-expand">
                            <p class="text">
                                云南不只有风景，<br>
                                还有每一张旅途里的笑脸。
                            </p>
                        </span>
                        <span class="boundary"></span>
                    </div>
                </div>
            </div>

            <!-- 区块 B：视频叙述 -->
            <div class="video-narrative gradient-green">
                <div class="video-player">
                    <video :src="`/gsap/yunnan/tourism/t-350.mp4`" ref="video1Ref" class="narrative-video"
                        preload="auto" muted playsinline>
                        您的浏览器不支持视频播放
                    </video>
                    <p class="narrative-text-first">云南不只有风景，<br>还有每一张旅途里的笑脸。</p>
                    <p class="narrative-text-second">从昆明出发，一路向南。</p>
                </div>
            </div>

            <!-- 区块 C：横向滚动画廊 -->
            <div ref="galleryRef" class="scrolling-gallery gradient-green-2">
                <p class="gallery-title-start">云南100张旅拍，开始滚动放映</p>
                <div ref="galleryTrackRef" class="gallery-track">
                    <img v-for="value in galleryImages" :key="`yunnan-gallery-${value}`"
                        :src="`/gsap/yunnan/tourism/t-${value}.jpg`" :class="`gallery-img-${value}`" alt="云南旅拍" />
                </div>
                <p class="gallery-title-end">下一站：把风景走成故事</p>
            </div>

            <!-- 区块 D：分页故事 -->
            <div class="story-carousel">
                <div ref="multipageStoryRef" class="multipage-story">
                    <div v-for="(page, idx) in storyPages" :key="page.id" :ref="setRef(idx)"
                        :class="['story-page', `story-page-${idx}`, page.gradientClass]" :data-index="idx">
                        <p v-if="page.headline" class="carousel-headline">{{ page.headline }}</p>
                        <video :src="`/gsap/yunnan/tourism/t-${page.videoIndex}.mp4`" :ref="setVRef(idx)"
                            :class="`story-video-${idx}`" muted playsinline />
                        <p :ref="setTRef(idx)" :class="`story-text-${idx}`">{{ page.text }}</p>
                    </div>
                </div>
            </div>

            <!-- 区块 E：雪山与峡谷（叠加图） -->
            <div class="mountain-reveal gradient-red">
                <div class="mountain-stack">
                    <div class="mountain-images-stack">
                        <img v-for="value in mountainImages" :key="`yunnan-cos-${value}`"
                            :src="`/gsap/yunnan/tourism/t-${value}.jpg`" :class="`mountain-img-${value}`" alt="云南风景" />
                    </div>
                    <p class="mountain-headline">雪山与峡谷</p>
                </div>
            </div>

            <!-- 视差图片区块 -->
            <div v-for="item in seeList" :key="`see-${item.key}`" :class="`scenery-block-${item.key}`"
                class="scenery-item">
                <img :src="`/gsap/yunnan/tourism/t-${item.key}.jpg`" :class="`scenery-img-${item.key}`" alt="云南风景" />
                <p class="scenery-caption">{{ item.label }}</p>
            </div>

            <!-- 视差视频区块 -->
            <div v-for="item in seeVideoList" :key="`see-${item.key}`" :class="`scenery-block-${item.key}`"
                class="scenery-item">
                <video :ref="setVRef(item.key)" :src="`/gsap/yunnan/tourism/t-${item.key}.mp4`"
                    :class="`scenery-video-${item.key}`" muted loop playsinline alt="云南风景" />
                <p class="scenery-caption">{{ item.label }}</p>
            </div>
        </div>
    </div>
</template>

<style scoped lang="scss">
#smooth-wrapper {
    --color-shockingly-green: #0ae448;
    --color-just-black: #0e100f;
    --color-surface-white: #fffce1;
    --color-pink: #fec5fb;
    --color-shockingly-pink: #f100cb;
    --color-orangey: #ff8709;
    --color-lilac: #9d95ff;
    --color-lt-green: #abff84;
    --color-blue: #00bae2;
    --color-grey: gray;
    --color-surface75: #bbbaa6;
    --color-surface50: #7c7c6f;
    --color-surface25: #42433d;
    --gradient-macha: linear-gradient(114.41deg, var(--color-shockingly-green) 20.74%, var(--color-lt-green) 65.5%);
    --gradient-orange-crush: linear-gradient(111.45deg, var(--color-orangey) 19.42%, #f7bdf8 73.08%);
    --gradient-lipstick: linear-gradient(165.72deg, #f7bdf8 21.15%, #cd237f 81.93%);
    --gradient-purple-haze: linear-gradient(153.58deg, #f7bdf8 32.25%, #2f3cc0 92.68%);
    --gradient-skyfall: linear-gradient(131.77deg, #0a157a 30.82%, #15bfe4 81.82%);
    --gradient-emerald-city: linear-gradient(166.9deg, var(--color-shockingly-green) 53.19%, #0085d0 107.69%);
    --gradient-summer-fair: linear-gradient(144.02deg, var(--color-blue) 4.56%, var(--color-pink) 72.98%);
    --color-core-green: #dfffd1;
    --color-core-green-lt: #f3ffee;
    --color-core-gradient: radial-gradient(89.08% 84.62% at 16.54% 78.46%, #fbfefa 0%, #c9f6b4 39.58%, #abff84 77.6%, #2fee65 100%);
    --color-core-button-gradient: linear-gradient(114.41deg, #0ae448 20.74%, #abff84 65.5%);
    --color-core-heading-gradient: linear-gradient(180deg, #d6ffc3 0%, rgba(214, 255, 195, 0) 100%), #f3ffee;
    --color-core-intro-gradient: linear-gradient(144.5deg, #e8ffdd 65.09%, #7dea7b 122.73%), linear-gradient(311.31deg, #7ef89e 36.08%, #e5ffd9 106.98%);
    --color-text-purple: #d2ceff;
    --color-text-purple-lt: #dfdcff;
    --color-text-gradient: radial-gradient(129.03% 100% at 120.97% 81.45%, #dfdcff 27.08%, #a69eff 100%);
    --color-svg-tangerine: #ffe3c7;
    --color-svg-tangerine-lt: #fff0e0;
    --color-svg-gradient: radial-gradient(70.77% 70.77% at 0% 70.77%, #ffd9b0 0%, #fd9f3b 80.73%, #ff8709 100%);
    --color-svg-heading-gradient: linear-gradient(180deg, #ffbd77 0%, rgba(254, 197, 251, 0) 100%), #ffe4c7;
    --color-ui-blue: #bef3fe;
    --color-ui-blue-lt: #e1faff;
    --color-ui-blue-codeblk: #f6feff;
    --color-ui-text-gradient: linear-gradient(168.89deg, #fec5fb -21.3%, #00bae2 89.88%);
    --color-ui-code-blocktext-gradient: linear-gradient(142.91deg, #cef6ff 18.75%, #a6efff 54.93%);
    --color-ui-gradient: radial-gradient(78.77% 78.77% at 71.71% 30.77%, #f0fcff 0%, #9bedff 67.21%, #98ecff 76.04%, #5be1ff 84.9%, #00bae2 94.79%);
    --color-ui-gradient-background: linear-gradient(137.1deg, #ecfcff 27.5%, #a6efff 94.09%);
    --color-ui-gradient-flip-background: radial-gradient(140% 190% at 117.54% 131.12%, #f0fcff 0%, #9bedff 25.52%, #98ecff 42.71%, #5be1ff 60.94%, #00bae2 94.79%);
    --color-scroll-pink: #ffd7fd;
    --color-scroll-pink-lt: #ffe9fe;
    --color-scroll-gradient: linear-gradient(317.42deg, #ffe9fe 10.4%, #ff96f9 83.03%);
    --ease-in: cubic-bezier(0.755, 0.05, 0.855, 0.06);
    --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
    --ease-in-out: cubic-bezier(0.86, 0, 0.07, 1);
    --ease-out-quart: cubic-bezier(0.175, 0.79, 0.38, 0.905);
    --ease-in-out-quart: cubic-bezier(0.645, 0.045, 0.355, 1);
}

#smooth-content {
    background-color: #fff;
    overflow: visible;
    height: 30000px;
}

// 通用区块样式
.hero-block,
.video-narrative,
.scrolling-gallery,
.story-carousel,
.mountain-reveal {
    height: 100vh;
    width: 100%;
    display: flex;
    justify-content: center;
}

.expand-text,
.expand-text {
    position: absolute;
    display: flex;
}

.horizontal {
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    flex-direction: column;
    align-items: center;
    width: 100vw;

    .top-expand,
    .botton-expand {
        overflow: hidden;
        height: 60px;
        display: flex;
        justify-content: center;


        .text {
            color: #fff;
            font-size: 40px;
            font-weight: bold;
            height: 60px;
            overflow: hidden;
        }
    }

    .boundary {
        height: 4px;
        width: 100%;
        border-radius: 2px;
        background-color: #fff;
    }

    .top-expand {
        align-items: flex-start;

    }

    .botton-expand {
        align-items: flex-end;
    }
}

.vertical {
    width: fit-content;
    max-width: calc(100vw - 40px);
    left: 20px;
    bottom: 20px;
    flex-direction: row-reverse;
    justify-content: flex-start;
    align-items: center;

    .right-expand {
        display: flex;
        justify-content: flex-end;
        overflow: hidden;
        width: fit-content;
        height: auto;
        max-width: 100%;
        padding-left: 2px;

        .text {
            width: fit-content;
            height: auto;
            color: #fff;
            font-size: 40px;
            font-weight: bold;
            white-space: nowrap;
        }
    }

    .boundary {
        width: 4px;
        border-radius: 2px;
        background-color: #fff;
    }
}


// 区块 A
.hero-block {
    .hero-image {
        display: flex;
        justify-content: flex-end;
        height: 100vh;
        width: 100%;
        position: relative;

        .hero-img-container {
            // 右居中
            display: flex;
            justify-content: flex-end;
            align-items: center;
            width: 100%;
            height: 100%;
            overflow: hidden;

            img {
                height: 100vh;
                width: 100vw;
                object-fit: cover;
                transform-origin: right center;
            }

            .boundary {
                position: absolute;
                height: 100%;
                width: 4px;
                background-color: #fff;
            }
        }
    }
}

// 区块 B
.video-narrative {
    .video-player {
        display: flex;
        justify-content: center;
        height: 100vh;
        width: 100%;
        position: relative;

        video {
            height: 100%;
            width: 100%;
            object-fit: cover;
        }

        .narrative-text-first,
        .narrative-text-second {
            position: absolute;
            opacity: 0;
            font-size: 4rem;
            color: #fff;
        }

        .narrative-text-first {
            top: 100rem;
            left: 11rem;
        }

        .narrative-text-second {
            top: 30rem;
            right: 30%;
            font-size: 8rem;
        }
    }
}

// 区块 C
.scrolling-gallery {
    justify-content: flex-start;
    overflow: hidden;
    position: relative;

    .gallery-title-start,
    .gallery-title-end {
        font-size: 4rem;
        color: #000;
        position: absolute;
        top: 50%;
        left: 0;
        right: 0;
        transform: translateY(-50%);
        margin-inline: auto;
        width: fit-content;
        max-width: 100%;
        z-index: 2;
    }

    .gallery-track {
        --img-gap: 40px;
        --img-width: clamp(260px, 42vw, 520px);
        display: flex;
        align-items: center;
        height: 100vh;
        width: max-content;
        gap: var(--img-gap);
        position: relative;
        will-change: transform;

        img {
            flex: 0 0 var(--img-width);
            width: var(--img-width);
            height: 90%;
            object-fit: cover;
            transform: scale(0.5);
            transform-origin: center center;
        }
    }

    .gallery-title-end {
        top: auto;
        bottom: 50%;
        transform: translateY(50%);
    }
}

// 区块 D
.story-carousel {
    .multipage-story {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden; // 保证超出部分不可见

        .story-page {
            position: absolute;
            top: 0;
            left: 0; // 所有页面初始位置都是 0
            width: 100%;
            height: 100%;
            transition: none; // 动画由 GSAP 控制 left 值
            will-change: left;

            video {
                height: 80%;
                position: absolute;
                top: 10%;
                left: 10%;
                object-fit: cover;
            }

            p {
                font-size: 4rem;
                color: #000;
                position: absolute;
                top: 50%;
                left: 40%;
                right: 0;
                transform: translateY(-50%);
                margin-inline: auto;
                width: fit-content;
                max-width: 60%;
                font-family: serif;
                z-index: 2;
            }

            // 大标题（仅第一页有）
            .carousel-headline {
                font-size: 20vw;
                background: linear-gradient(to right, yellow, lime, aqua);
                background-clip: text;
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                position: absolute;
                top: 50%;
                left: 0;
                right: 0;
                transform: translateY(-50%);
                margin-inline: auto;
                width: fit-content;
                max-width: 100%;
                text-align: center;
            }
        }
    }
}

// 区块 E
.mountain-reveal {
    .mountain-stack {
        height: 100%;
        width: 100%;
        position: relative;

        .mountain-headline {
            font-size: 15vw;
            background: linear-gradient(to right, yellow, lime, aqua);
            background-clip: text;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            position: absolute;
            top: 50%;
            left: 0;
            right: 0;
            transform: translateY(-50%);
            margin-inline: auto;
            width: fit-content;
            max-width: 100%;
            z-index: 999;
        }

        .mountain-images-stack {
            height: 100%;
            position: relative;

            img {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                margin-inline: auto;
                height: 80%;
                width: 25%;
                object-fit: cover;
            }
        }
    }
}

// 视差区块通用样式
.scenery-item {
    height: 100vh;
    width: 100%;
    overflow: hidden;
    position: relative;

    img,
    video {
        height: 100%;
        width: 100%;
        object-fit: cover;
    }

    .scenery-caption {
        font-size: 10vw;
        color: #fff;
        position: absolute;
        top: 50%;
        left: 0;
        right: 0;
        transform: translateY(-50%);
        margin-inline: auto;
        width: fit-content;
        max-width: 100%;
        text-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
    }
}

video {
    transform: translateZ(0);
    will-change: transform;
}

// 渐变色背景类（保持不变）
.gradient-green {
    background: var(--gradient-macha);
    background-blend-mode: color-dodge;
}

.gradient-green-2 {
    background: var(--gradient-emerald-city);
    background-blend-mode: color-dodge;
}

.gradient-orange {
    background: var(--gradient-orange-crush);
    background-blend-mode: color-dodge;
}

.gradient-purple {
    background: var(--gradient-purple-haze);
    background-blend-mode: color-dodge;
}

.gradient-blue-2 {
    background: var(--gradient-summer-fair);
    background-blend-mode: color-dodge;
}

.gradient-blue {
    background: var(--color-ui-gradient);
    background-blend-mode: color-dodge;
}

.gradient-red {
    background: var(--gradient-lipstick);
    background-blend-mode: color-dodge;
}
</style>