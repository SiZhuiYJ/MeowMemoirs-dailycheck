<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef } from 'vue';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollSmoother } from 'gsap/ScrollSmoother';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(ScrollTrigger, ScrollSmoother, SplitText);

type DemoTarget = {
    key: string;
    label: string;
    selector: string;
    position?: string;
};

const main = useTemplateRef('mainRef');

const demoTargets: DemoTarget[] = [
    { key: 'top', label: '回到顶部', selector: '#smooth-content', position: 'top top' },
    { key: 'a', label: '跳转到 A', selector: '.box-a', position: 'top top' },
    { key: 'b', label: '跳转到 B', selector: '.box-b', position: 'top top' },
    { key: 'c', label: '跳转到 C', selector: '.box-c', position: 'top top' },
    { key: 'd', label: '跳转到 D', selector: '.box-d', position: 'top top' },
    { key: 'e', label: '跳转到 E', selector: '.box-e', position: 'top top' },
];

const seeList = [
    { key: '24', label: '黎就是富婆', },
    { key: '25', label: '黎最好看', },
    { key: '26', label: '黎最腻害', },
    { key: '27', label: '黎嘎嘎乱杀', },
    { key: '28', label: '黎铲啦', },
]

let smoother: ScrollSmoother | null = null;
let ctx: gsap.Context | null = null;

const video4 = useTemplateRef('video4Ref');
const video3 = useTemplateRef('video3Ref');
const video2 = useTemplateRef('video2Ref');
const video1 = useTemplateRef('video1Ref');

let startTitle: SplitText | null = null;
let endTitle: SplitText | null = null;
let page1Text: SplitText | null = null;
let page2Text: SplitText | null = null;
let page3Text: SplitText | null = null;

const scrollTo = (selector: string, position: string = 'center center') => {
    if (!smoother)
        return;
    smoother.scrollTo(selector, true, position);
};

onMounted(() => {
    if (!main.value)
        return;

    ctx = gsap.context(() => {
        // create the smooth scroller FIRST!
        smoother = ScrollSmoother.create({
            smooth: 2, // seconds it takes to "catch up" to native scroll position
            effects: true, // look for data-speed and data-lag attributes on elements and animate accordingly
        });

        ScrollTrigger.create({
            trigger: '.box-a',
            start: 'top top',
            end: '+=600',
            scrub: true,
            markers: true,
            animation:
                gsap.timeline()
                    .fromTo('.box-img', { scale: 1 }, { scale: 0.8 })
                    .fromTo('.box-video', { width: '80%', height: '80vh', }, { width: '100%', height: '100vh', }, '<')
        });

        ScrollTrigger.create({
            trigger: '.box-b',
            start: 'top top',
            end: '+=5000',
            scrub: true,
            pin: true,
            markers: true,
            onUpdate(self) {
                const video = video4.value;
                if (!video) return;
                const dur = video.duration;
                if (isFinite(dur) && dur > 0) {
                    let target = self.progress * dur;
                    target = Math.min(Math.max(target, 0), dur);
                    video.currentTime = target;
                }
            },
            animation:
                gsap.timeline()
                    .to('.text-1', { top: '50%', opacity: 1 })
                    .to('.text-1', { top: '0', opacity: 0 })
                    .to('.text-2', { top: '60%', opacity: 1 })
                    .to('.text-2', { top: '40%', opacity: 0 })
        });

        const imgList = main.value?.querySelector<HTMLElement>('.img-list');
        const imgItems = gsap.utils.toArray<HTMLImageElement>('.img-list img');
        const imgGap = 40;
        const imgTimeline = gsap.timeline({ defaults: { ease: 'none' } });

        if (imgList && imgItems.length) {
            imgList.style.setProperty('--img-gap', `${imgGap}px`);

            const viewportWidth = window.innerWidth + 200;
            const startX = viewportWidth;
            const endX = -imgList.scrollWidth;
            const moveDistance = startX - endX;

            gsap.set(imgList, { x: startX });
            gsap.set(imgItems, { scale: 0.5, transformOrigin: 'center center' });

            imgTimeline.fromTo(imgList, { x: startX }, { x: endX, duration: 1 }, 0);

            imgItems.forEach((item) => {
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

                imgTimeline
                    .fromTo(
                        item,
                        { scale: 1.3 },
                        { scale: 1, duration: centerProgress - scaleInStart },
                        scaleInStart,
                    )
                    .to(
                        item,
                        { scale: 0.7, duration: scaleOutEnd - centerProgress },
                        centerProgress,
                    );
            });
        }

        ScrollTrigger.create({
            trigger: '.box-c',
            pin: true,
            start: 'top top',
            end: () => `+=${Math.max(400, imgItems.length * 450)}`,
            scrub: true,
            markers: true,
            animation: imgTimeline
        });

        startTitle = SplitText.create(".start-title", { type: "chars" });

        ScrollTrigger.create({
            trigger: '.start-title',
            start: `top-=${window.innerHeight * 1.2} top`,
            end: '+=1000',
            scrub: true,
            markers: true,
            animation:
                gsap.timeline()
                    .from(startTitle?.chars, {
                        rotationX: -100,
                        transformOrigin: "50% 50% -160px",
                        opacity: 0,
                        duration: 0.8,
                        ease: "power3",
                        stagger: 0.25
                    })
                    .fromTo('.start-title', { opacity: 1 }, { opacity: 0, duration: 0.5 }),
        });

        endTitle = SplitText.create(".end-title", { type: "chars" });

        ScrollTrigger.create({
            trigger: '.end-title',
            start: `top+=${Math.max(imgItems.length * 450 - 800)} top`,
            end: '+=800',
            scrub: true,
            markers: true,
            animation:
                gsap.timeline()
                    .from(endTitle?.chars, {
                        x: 150,
                        opacity: 0,
                        duration: 0.7,
                        ease: "power4",
                        stagger: 0.04
                    }),
        });

        page1Text = SplitText.create(".page1-text", { type: "lines" });
        page2Text = SplitText.create(".page2-text", { type: "chars" });
        page3Text = SplitText.create(".page3-text", { type: "chars" });

        ScrollTrigger.create({
            trigger: '.box-d',
            pin: true,
            start: 'top top',
            end: '+=2000',
            scrub: true,
            markers: true,
            animation:
                gsap.timeline()
                    .fromTo('.parallel-text', { opacity: 1 }, { opacity: 0 })
                    .fromTo('.video-1', { marginTop: '100vh' }, {
                        marginTop: 0,
                        onStart() {
                            if (video1.value) {
                                video1.value.currentTime = 0
                                video1.value.muted = true
                                video1.value.play()
                            }
                        }
                    }, '<')
                    .from(page1Text?.lines, {
                        rotationX: -100,
                        transformOrigin: "50% 50% -160px",
                        opacity: 0,
                        duration: 0.8,
                        ease: "power3",
                        stagger: 0.25
                    }, '>')
                    .fromTo('.page1', { duration: 0.8, left: 0 }, { left: '-100vw' }, '>')
                    .fromTo('.page2', { duration: 0.8, left: '100vw' }, {
                        left: 0, onStart() {
                            if (video2.value) {
                                video2.value.currentTime = 0
                                video2.value.muted = true
                                video2.value.play()
                            }
                        }
                    }, '<')
                    .from(page2Text?.chars, {
                        x: 150,
                        opacity: 0,
                        duration: 0.7,
                        ease: "power4",
                        stagger: 0.04
                    }, '>')
                    .fromTo('.page2', { duration: 0.8, left: 0 }, { left: '-100vw' }, '>')
                    .fromTo('.page3', { duration: 0.8, left: '100vw' }, {
                        left: 0, onStart() {
                            if (video3.value) {
                                video3.value.currentTime = 0
                                video3.value.muted = true
                                video3.value.play()
                            }
                        }
                    }, '<')
                    .from(page3Text?.chars, {
                        rotationX: -100,
                        transformOrigin: "50% 50% -160px",
                        opacity: 0,
                        duration: 0.8,
                        ease: "power3",
                        stagger: 0.25
                    }, '>')
        });


        ScrollTrigger.create({
            trigger: '.box-e',
            pin: true,
            start: 'top top',
            end: '+=800',
            scrub: true,
            markers: true,
            animation:
                gsap.timeline()
                    .fromTo('.cos-7', { scale: 0.4, zIndex: 1, left: "50%" }, { scale: 0.6, left: "8%" })
                    .fromTo('.cos-21', { scale: 0.6, zIndex: 2, left: "50%" }, { scale: 0.7, left: "22%" }, '<')
                    .fromTo('.cos-5', { scale: 0.8, zIndex: 3, left: "50%" }, { scale: 0.8, left: "36%" }, '<')
                    .fromTo('.cos-18', { scale: 1, zIndex: 4, }, { scale: 0.9, }, '<')
                    .fromTo('.cos-6', { scale: 0.8, zIndex: 3, left: "50%" }, { scale: 0.8, left: "64%" }, '<')
                    .fromTo('.cos-22', { scale: 0.6, zIndex: 2, left: "50%" }, { scale: 0.7, left: "78%" }, '<')
                    .fromTo('.cos-23', { scale: 0.4, zIndex: 1, left: "50%" }, { scale: 0.6, left: "92%" }, '<')
        });

        ScrollTrigger.create({
            trigger: '.cos',
            start: 'top top',
            end: '+=600',
            scrub: true,
            markers: true,
            animation:
                gsap.timeline()
                    .to(".cos-title", {
                        rotationX: 100,
                        transformOrigin: `50% 50% -${window.innerHeight * 0.5}`,
                        opacity: 0,
                        duration: 0.8,
                        ease: "power3",
                        stagger: 0.25
                    })
        });

        seeList.forEach(value => {
            const getParallaxDistance = () => window.innerHeight * 0.5;
            ScrollTrigger.create({
                trigger: `.see-${value.key}`,
                start: 'top bottom',
                end: 'bottom top',
                scrub: true,
                markers: true,
                invalidateOnRefresh: true,
                animation:
                    gsap.timeline({ defaults: { ease: 'none' } })
                        .fromTo(`.show-${value.key}`, {
                            transformOrigin: "50% 50%",
                            y: () => -getParallaxDistance()
                        }, {
                            y: () => 0,
                            duration: 0.5
                        })
                        .to(`.show-${value.key}`, {
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
    ctx = null;
    startTitle = null;
    endTitle = null;
    page1Text = null;
    page2Text = null;
    smoother = null;
});
</script>

<template>
    <div id="smooth-wrapper" ref="mainRef">
        <div id="smooth-content">
            <header class="header" style="display: none;">
                <h1 class="title">GreenSock ScrollSmoother on a Vue3 App</h1>
                <div class="button-group">
                    <button v-for="item in demoTargets" :key="item.key" class="button"
                        @click="scrollTo(item.selector, item.position)">
                        {{ item.label }}
                    </button>
                </div>
                <p>示例：点击上面的按钮体验「锚点跳转 + 平滑滚动 + ScrollTrigger 固定动画」。</p>
            </header>
            <div class="box box-a gradient-purple">
                <div class="box-img">
                    <img src="/gsap/yunnan/20.jpg" class="image-20" alt="">
                </div>
            </div>
            <div class="box box-b gradient-green">
                <div class="box-video">
                    <video src="/gsap/yunnan/4.mp4" ref="video4Ref" class="video-4">
                        您的浏览器不支持视频播放
                    </video>
                    <p class="text-1">
                        怎么看！<br>
                        怎么萌~
                    </p>
                    <p class="text-2">
                        绝世萌妹~
                    </p>
                </div>
            </div>
            <div class="box box-c gradient-green-2">
                <p class="start-title">一大波美图来袭~</p>
                <div class="img-list">
                    <img v-for="value in [1, 2, 3, 4, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]" :key="`yunnan-${value}`"
                        :src="`/gsap/yunnan/${value}.jpg`" :class="`image-${value}`" alt="" />
                </div>
                <p class="end-title">沉迷于美色之中了吧</p>
            </div>
            <div class="box box-d">
                <div class="parallel">

                    <div class="page1 gradient-orange">
                        <p class="parallel-text">
                            善舞
                        </p>
                        <video src="/gsap/yunnan/1.mp4" ref="video1Ref" class="video-1">
                            您的浏览器不支持视频播放
                        </video>
                        <p class="page1-text">
                            优美舞姿
                        </p>
                    </div>
                    <div class="page2 gradient-blue-2">
                        <video src="/gsap/yunnan/2.mp4" ref="video2Ref" class="video-2">
                            您的浏览器不支持视频播放
                        </video>
                        <p class="page2-text">
                            纵享丝滑
                        </p>
                    </div>
                    <div class="page3 gradient-blue">
                        <video src="/gsap/yunnan/3.mp4" ref="video3Ref" class="video-3">
                            您的浏览器不支持视频播放
                        </video>
                        <p class="page3-text">
                            放荡不羁
                        </p>
                    </div>
                </div>
            </div>
            <div class="box box-e gradient-red">
                <div class="cos">
                    <div class="cos-list">
                        <img v-for="value in [7, 21, 5, 18, 6, 22, 23]" :key="`yunnan-cos-${value}`"
                            :src="`/gsap/yunnan/${value}.jpg`" :class="`cos-${value}`" alt="" />
                    </div>
                    <p class="cos-title">
                        美少女COS
                    </p>
                </div>
            </div>
            <div v-for="item in seeList" :key="`see-${item.key}`" :class="`see-${item.key}`" class="see-item">
                <img :src="`/gsap/yunnan/${item.key}.jpg`" :class="`show-${item.key}`" alt="" />
                <p class="see-text">
                    {{ item.label }}
                </p>
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
    --gradient-macha: linear-gradient(114.41deg,
            var(--color-shockingly-green) 20.74%,
            var(--color-lt-green) 65.5%);
    --gradient-orange-crush: linear-gradient(111.45deg,
            var(--color-orangey) 19.42%,
            #f7bdf8 73.08%);
    --gradient-lipstick: linear-gradient(165.72deg,
            #f7bdf8 21.15%,
            #cd237f 81.93%);
    --gradient-purple-haze: linear-gradient(153.58deg,
            #f7bdf8 32.25%,
            #2f3cc0 92.68%);
    --gradient-skyfall: linear-gradient(131.77deg,
            #0a157a 30.82%,
            #15bfe4 81.82%);
    --gradient-emerald-city: linear-gradient(166.9deg,
            var(--color-shockingly-green) 53.19%,
            #0085d0 107.69%);
    --gradient-summer-fair: linear-gradient(144.02deg,
            var(--color-blue) 4.56%,
            var(--color-pink) 72.98%);
    --color-core-green: #dfffd1;
    --color-core-green-lt: #f3ffee;
    --color-core-gradient: radial-gradient(89.08% 84.62% at 16.54% 78.46%,
            #fbfefa 0%,
            #c9f6b4 39.58%,
            #abff84 77.6%,
            #2fee65 100%);
    --color-core-button-gradient: linear-gradient(114.41deg,
            #0ae448 20.74%,
            #abff84 65.5%);
    --color-core-heading-gradient: linear-gradient(180deg,
            #d6ffc3 0%,
            rgba(214, 255, 195, 0) 100%),
        #f3ffee;
    --color-core-intro-gradient: linear-gradient(144.5deg,
            #e8ffdd 65.09%,
            #7dea7b 122.73%),
        linear-gradient(311.31deg, #7ef89e 36.08%, #e5ffd9 106.98%);
    --color-text-purple: #d2ceff;
    --color-text-purple-lt: #dfdcff;
    --color-text-gradient: radial-gradient(129.03% 100% at 120.97% 81.45%,
            #dfdcff 27.08%,
            #a69eff 100%);
    --color-svg-tangerine: #ffe3c7;
    --color-svg-tangerine-lt: #fff0e0;
    --color-svg-gradient: radial-gradient(70.77% 70.77% at 0% 70.77%,
            #ffd9b0 0%,
            #fd9f3b 80.73%,
            #ff8709 100%);
    --color-svg-heading-gradient: linear-gradient(180deg,
            #ffbd77 0%,
            rgba(254, 197, 251, 0) 100%),
        #ffe4c7;
    --color-ui-blue: #bef3fe;
    --color-ui-blue-lt: #e1faff;
    --color-ui-blue-codeblk: #f6feff;
    --color-ui-text-gradient: linear-gradient(168.89deg,
            #fec5fb -21.3%,
            #00bae2 89.88%);
    --color-ui-code-blocktext-gradient: linear-gradient(142.91deg,
            #cef6ff 18.75%,
            #a6efff 54.93%);
    --color-ui-gradient: radial-gradient(78.77% 78.77% at 71.71% 30.77%,
            #f0fcff 0%,
            #9bedff 67.21%,
            #98ecff 76.04%,
            #5be1ff 84.9%,
            #00bae2 94.79%);
    --color-ui-gradient-background: linear-gradient(137.1deg,
            #ecfcff 27.5%,
            #a6efff 94.09%);
    --color-ui-gradient-flip-background: radial-gradient(140% 190% at 117.54% 131.12%,
            #f0fcff 0%,
            #9bedff 25.52%,
            #98ecff 42.71%,
            #5be1ff 60.94%,
            #00bae2 94.79%);
    --color-scroll-pink: #ffd7fd;
    --color-scroll-pink-lt: #ffe9fe;
    --color-scroll-gradient: linear-gradient(317.42deg,
            #ffe9fe 10.4%,
            #ff96f9 83.03%);
    --ease-in: cubic-bezier(0.755, 0.05, 0.855, 0.06);
    --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
    --ease-in-out: cubic-bezier(0.86, 0, 0.07, 1);
    --ease-out-quart: cubic-bezier(0.175, 0.79, 0.38, 0.905);
    --ease-in-out-quart: cubic-bezier(0.645, 0.045, 0.355, 1);
}

#smooth-content {
    background-color: #fff;
    overflow: visible;
    height: 25000px;
}

.box {
    height: 100vh;
    width: 100%;
    display: flex;
    justify-content: center;
}

.box-a {
    .box-img {
        display: flex;
        justify-content: center;
        height: 100vh;
        width: 100%;

        img {
            height: 100%;
            width: 100%;
            object-fit: cover;
        }
    }
}

.box-b {
    .box-video {
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

        .text-1 {
            position: absolute;
            top: 100rem;
            left: 11rem;
            opacity: 0;
            font-size: 4rem;
            color: #fff;
        }

        .text-2 {
            position: absolute;
            top: 30rem;
            right: 30%;
            opacity: 0;
            font-size: 8rem;
            color: #fff;
        }
    }
}

.box-c {
    justify-content: flex-start;
    overflow: hidden;

    .start-title {
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
    }

    .img-list {
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
            transform: scale(.5);
            transform-origin: center center;
        }
    }

    .end-title {
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
    }
}

.box-d {
    .parallel {
        height: 100%;
        width: 200%;
        position: relative;
        overflow: hidden;
        box-sizing: border-box;

        .parallel-text {
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
        }

        div {
            video {
                height: 80%;
                position: absolute;
                top: 10%;
                left: 10%;
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
            }
        }

        .page1 {
            position: absolute;
            left: 0;
            top: 0;
            height: 100%;
            width: 100%;
        }

        .page2 {
            position: absolute;
            left: 100vw;
            top: 0;
            height: 100%;
            width: 100%;
        }

        .page3 {
            position: absolute;
            left: 100vw;
            top: 0;
            height: 100%;
            width: 100%;
        }
    }
}

.box-e {
    .cos {
        height: 100%;
        width: 100%;

        .cos-title {
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

        .cos-list {
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

.see-item {
    height: 100vh;
    width: 100%;
    overflow: hidden;
    position: relative;

    img {
        height: 100%;
        width: 100%;
        object-fit: cover;
    }

    .see-text {
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
    }
}

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
