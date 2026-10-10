import { defineStore } from "pinia";
import { ref, computed } from "vue";

export interface ThemePalette {
  colors: string[]; // [c1, c2, c3, c4]
  name?: string;
}

export const PRESET_PALETTES: ThemePalette[] = [
  { colors: ["#8EA88E", "#B3C6AB", "#ECE7DA", "#F1F1EB"] },
  { colors: ["#5E9EDE", "#468E76", "#FDF6E9", "#C2E0EA"] }, // Fixed #5E9RDE to #5E9EDE
  { colors: ["#438855", "#75B596", "#E5EFB3", "#FAF6E9"] },
  { colors: ["#A7C67E", "#DFEAA2", "#F9F6E9", "#FFFDF6"] },
  { colors: ["#ED843F", "#F4C17F", "#FCEEAE", "#FEFFD4"] },
];

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
}

function getLuminance(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export const useThemeStore = defineStore("theme", () => {
  const currentColors = ref<string[]>(PRESET_PALETTES[2].colors); // Default to config 3
  const customColors = ref<string[]>(PRESET_PALETTES[0].colors); // Default custom colors

  // Computed Semantic Colors
  const semantics = computed(() => {
    const colors = [...currentColors.value];
    // Sort by luminance
    const sorted = colors
      .map((c) => ({ color: c, lum: getLuminance(c) }))
      .sort((a, b) => b.lum - a.lum); // Descending (Lightest first)

    // Lightest -> Background
    const bg = sorted[0].color;

    // Second Lightest -> Surface / Elevated
    const surface = sorted[1].color;

    // Remaining two: Darkest -> Primary, Other -> Secondary
    const remaining = [sorted[2], sorted[3]].sort((a, b) => a.lum - b.lum); // Darker first
    const primary = remaining[0].color;
    const secondary = remaining[1].color;

    // Text Color calculation
    // If bg is dark (< 0.5), text is white. Else black/dark-grey.
    const bgLum = sorted[0].lum;
    const textColor = bgLum > 0.5 ? "#191919" : "#FFFFFF";
    const textMuted = bgLum > 0.5 ? "#666666" : "#CCCCCC";
    const border = bgLum > 0.5 ? "#e5e7eb" : "#374151";

    // Primary Light (for subtle backgrounds)
    const primaryRGB = hexToRgb(primary);
    const primaryLight = `rgba(${primaryRGB.r}, ${primaryRGB.g}, ${primaryRGB.b}, 0.1)`;

    return {
      primary,
      secondary,
      bg,
      surface,
      textColor,
      textMuted,
      border,
      primaryLight,
    };
  });

  const themeStyle = computed(() => {
    const s = semantics.value;
    return {
      "--theme-primary": s.primary,
      "--theme-primary-light": s.primaryLight,
      "--theme-secondary": s.secondary,
      "--bg-color": s.bg,
      "--bg-soft": s.primaryLight, // Add this
      "--bg-elevated": s.surface,
      "--text-color": s.textColor,
      "--text-muted": s.textMuted,
      "--border-color": s.border,

      // Mappings
      "--accent-color": s.primary,
      "--uni-color-primary": s.primary,
      "--uni-bg-color": s.bg,
      "--uni-text-color": s.textColor,
    };
  });

  function setPalette(colors: string[]) {
    if (colors.length < 4) return;
    currentColors.value = colors;
    uni.setStorageSync("theme_palette", JSON.stringify(colors));
    updateNavBarColor();
  }

  function setCustomPalette(colors: string[]) {
    if (colors.length < 4) return;
    customColors.value = colors;
    uni.setStorageSync("custom_theme_palette", JSON.stringify(colors));
  }

  function initTheme() {
    const stored = uni.getStorageSync("theme_palette");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length >= 4) {
          currentColors.value = parsed;
        }
      } catch (e) {
        // invalid storage
      }
    }

    const storedCustom = uni.getStorageSync("custom_theme_palette");
    if (storedCustom) {
      try {
        const parsed = JSON.parse(storedCustom);
        if (Array.isArray(parsed) && parsed.length >= 4) {
          customColors.value = parsed;
        }
      } catch (e) {
        // invalid storage
      }
    }
    updateNavBarColor();
  }

  function updateNavBarColor() {
    const s = semantics.value;
    const isDark = getLuminance(s.bg) < 0.5;

    // Skip update for pages that shouldn't follow theme (like login page)
    const pages = getCurrentPages();
    if (pages.length > 0) {
      const currentPage = pages[pages.length - 1];
      if (currentPage.route === "pages/auth/index") {
        return;
      }
    }

    // Wrap in try-catch because setNavigationBarColor might fail if page stack is not ready
    try {
      uni.setNavigationBarColor({
        frontColor: isDark ? "#ffffff" : "#000000",
        backgroundColor: s.bg,
        animation: {
          duration: 300,
          timingFunc: "easeIn",
        },
        fail: (err) => {
          // Ignore "page not found" errors during initial launch
          if (err.errMsg && !err.errMsg.includes("page not found")) {
            console.warn("Failed to set nav bar color", err);
          }
        },
      });
    } catch (e) {
      // Ignore
    }
  }

  return {
    currentColors,
    customColors,
    semantics,
    themeStyle,
    setPalette,
    setCustomPalette,
    initTheme,
    updateNavBarColor,
  };
});
