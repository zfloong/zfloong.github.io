/**
 * 粒子背景模块 - 萤火虫风格
 * 使用 tsParticles 创建漂浮发光粒子效果
 * 纯 ESM 方式加载，无全局污染
 */

import { tsParticles } from "https://cdn.jsdelivr.net/npm/@tsparticles/engine@3.8.1/+esm";
import { loadBasic } from "https://cdn.jsdelivr.net/npm/@tsparticles/basic@3.8.1/+esm";

let particlesInitialized = false;

/**
 * 构建萤火虫粒子配置
 */
function buildConfig() {
  return {
    fpsLimit: 30,
    background: { color: "transparent" },
    particles: {
      number: { value: 28 },
      color: {
        value: ["#ffd700", "#ffec8b", "#ffb347", "#fbbf24", "#fff3c4"]
      },
      shape: { type: "circle" },
      opacity: {
        value: { min: 0.08, max: 0.6 },
        animation: {
          enable: true,
          speed: 1.2,
          minimumValue: 0.04,
          sync: false
        }
      },
      size: {
        value: { min: 1.5, max: 5 },
        animation: {
          enable: true,
          speed: 2.5,
          minimumValue: 1,
          sync: false
        }
      },
      shadow: {
        enable: true,
        color: "#ffd700",
        blur: 15,
        offset: { x: 0, y: 0 }
      },
      move: {
        enable: true,
        speed: { min: 0.08, max: 0.35 },
        direction: "none",
        random: true,
        straight: false,
        outModes: { default: "bounce" }
      }
    },
    detectRetina: true
  };
}

/**
 * 初始化萤火虫粒子背景
 */
async function initParticles() {
  if (particlesInitialized) return;
  const container = document.getElementById("particles-bg");
  if (!container) return;

  try {
    await loadBasic(tsParticles);
    const config = buildConfig();
    await tsParticles.load({ id: "particles-bg", options: config });
    particlesInitialized = true;
  } catch (err) {
    console.warn("粒子初始化失败:", err);
  }
}

export { initParticles };
