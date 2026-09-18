/**
 * Hero 区流动光带背景（WebGL fragment shader）
 *
 * 完全参考 DeepSeek Harness 落地页的流体背景实现（dsh-plugin-backdrop 逆向项目）。
 * 算法、配色、参数均来自 fluid-shaders.js + fluid-background.js。
 *
 * 性能与健壮性：
 *   - 只在 hero 区域铺一块 canvas，不覆盖整页
 *   - DPR 上限 1.5
 *   - 标签页隐藏时停 rAF
 *   - WebGL 不可用 / 上下文丢失 → CSS 兜底渐变接管
 *   - 单 pass（无 flowmap），不需要鼠标交互
 */

const CONFIG = {
  scale: 1.77,          // 噪声尺度
  speed: 28,            // 时间速度（实际倍率 = speed/100 = 0.28）
  grain: 0.005,         // 颗粒感
  maxDpr: 1.5,
  targetFps: 60,
  minFrameGap: 1000 / 60,
  offsetX: -124,        // 噪声 X 偏移（/100 后 = -1.24）
  offsetY: -48,         // 噪声 Y 偏移（/100 后 = -0.48）
  // ── 5 色调色盘（DeepSeek 默认）──
  // '#000000', '#1A3870', '#204a7e', '#eed8aa', '#000000'
  color1: [0.000, 0.000, 0.000],
  color2: [0.102, 0.220, 0.439],
  color3: [0.125, 0.290, 0.494],
  color4: [0.933, 0.847, 0.667],
  color5: [0.000, 0.000, 0.000],
  // ── 效果参数（DeepSeek 默认）──
  lightX: 0.89,
  lightY: 0.46,
  lightCore: 0.14,
  lightHalo: 0.2,
  vignette: 0.38,
  bloomThreshold: 0.61,
  bloomRange: 0.18,
  bloomStrength: 0.4,
};

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

// Fragment shader 完全来自 dsh-plugin-backdrop/src/engine/fluid-shaders.js
// 去掉了鼠标交互部分（flowmap/distort/swirl/glow），其余原样保留
const FRAG = `#version 300 es
precision mediump float;
uniform float u_time;
uniform vec2  u_resolution;
uniform vec3  u_c1, u_c2, u_c3, u_c4, u_c5;
uniform float u_scale;
uniform vec2  u_offset;
uniform float u_grain;
uniform vec2  u_lightPos;
uniform float u_lightCore;
uniform float u_lightHalo;
uniform float u_vignette;
uniform float u_bloomThreshold;
uniform float u_bloomRange;
uniform float u_bloomStrength;
out vec4 fragColor;

vec3 mod289v3(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289v4(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289v4(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}

float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.);
  const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289v3(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.;
  vec4 s1=floor(b1)*2.+1.;
  vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);
  m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}

float hash(vec2 p){
  vec3 p3=fract(vec3(p.xyx)*.1031);
  p3+=dot(p3,p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}

// 原版 fbm：1 次迭代（简化版，性能优先）
float fbm(vec3 p){
  float v=0.,amp=.6;vec3 shift=vec3(100.);
  for(int i=0;i<1;i++){v+=amp*snoise(p);p=p*2.+shift;amp*=.4;}
  return v;
}

// 流体噪声：3 层 fbm 域扭曲
float fluidNoise(vec2 uv,float t){
  float n1=fbm(vec3(uv*.6,t*.06));
  float n2=fbm(vec3(uv*.6+5.2,t*.06+1.3));
  vec2 w1=vec2(n1,n2)*.6;
  float n3=fbm(vec3((uv+w1)*.7+1.7,t*.05+3.1));
  float n4=fbm(vec3((uv+w1)*.7+9.2,t*.05+5.7));
  vec2 w2=vec2(n3,n4)*.5;
  return fbm(vec3((uv+w1+w2)*.5,t*.04));
}

// 旋度场
vec2 curlish(vec2 uv,float t){
  float eps=.02;
  float n=snoise(vec3(uv*.8,t));
  float nx=snoise(vec3((uv+vec2(eps,0.))*.8,t));
  float ny=snoise(vec3((uv+vec2(0.,eps))*.8,t));
  return vec2(-(ny-n)/eps,(nx-n)/eps)*.003;
}

void main(){
  float aspect=u_resolution.x/u_resolution.y;
  vec2 uv=gl_FragCoord.xy/u_resolution;
  vec2 suv=vec2(uv.x*aspect,uv.y)*u_scale+u_offset;
  float t=u_time;

  // 旋度 + 流体噪声
  vec2 curl=curlish(suv,t*.04);
  vec2 uvD=suv+curl*12.;
  float f=fluidNoise(uvD,t);
  float swirl=snoise(vec3(uvD*.8+f*1.5,t*.035))*.5+.5;
  float n=f*.5+.5;

  // 5 色混合
  vec3 col=mix(u_c1,u_c2,smoothstep(.2,.5,n));
  col=mix(col,u_c3,smoothstep(.35,.65,n+swirl*.25));
  col=mix(col,u_c4,smoothstep(.6,.85,swirl)*.55);
  col=mix(col,u_c5,smoothstep(.5,.8,n*swirl)*.35);

  // 颗粒（跟随流体偏移）
  if(u_grain>0.0){
    vec2 flowOffset=(uvD-suv)*u_resolution.y;
    vec2 gp=floor((gl_FragCoord.xy+flowOffset)/5.0);
    float gr=hash(gp)*2.-1.;
    col+=gr*u_grain;
  }

  // 自发光 bloom
  float luma=dot(col,vec3(.299,.587,.114));
  float bloom=smoothstep(u_bloomThreshold-u_bloomRange,u_bloomThreshold+u_bloomRange,luma);
  col+=(col*.85+vec3(.15,.145,.13))*bloom*u_bloomStrength;

  // 虚拟光源（颜色是字面量：暖核 / 冷晕；强度和位置在 CONFIG.light* 上调）
  float ld=length((uv-u_lightPos)*vec2(aspect,1.));
  float core=exp(-ld*ld*4.5);
  float halo=exp(-ld*1.8);
  col+=vec3(1.,.97,.9)*core*u_lightCore+vec3(.72,.8,1.)*halo*u_lightHalo;

  // 暗角
  float vig=1.-smoothstep(.35,.75,length(uv-.5));
  col=mix(col*(1.-u_vignette),col,vig);

  fragColor=vec4(col,1.);
}`;

let gl = null;
let program = null;
let canvas = null;
let rafId = null;
let timerId = null;
let lastTime = 0;
let timeAcc = Math.random() * 1000;
let paused = false;
let initialized = false;
const U = {};
let frameCount = 0;
let lastError = null;

if (typeof window !== 'undefined') {
  window.__heroShader = {
    state: () => ({ frames: frameCount, time: +timeAcc.toFixed(3), paused, rafId, timerId, error: lastError }),
  };
}

function compile(glCtx, type, src) {
  const sh = glCtx.createShader(type);
  glCtx.shaderSource(sh, src);
  glCtx.compileShader(sh);
  if (!glCtx.getShaderParameter(sh, glCtx.COMPILE_STATUS)) {
    console.warn('[hero-shader] 着色器编译失败:', glCtx.getShaderInfoLog(sh));
    return null;
  }
  return sh;
}

export function initHeroShader() {
  // retryFetchData 会重跑整个 initPage，没有这个守卫每重试一次就多一块 canvas 和一个 rAF 循环
  if (initialized) return true;

  const host = document.getElementById('hero-shader');
  if (!host) return false;

  canvas = document.createElement('canvas');
  host.appendChild(canvas);

  gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) {
    canvas.remove();
    canvas = null;
    return false;
  }

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { canvas.style.display = 'none'; return false; }

  program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[hero-shader] 链接失败:', gl.getProgramInfoLog(program));
    canvas.style.display = 'none';
    return false;
  }
  gl.useProgram(program);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  // 静态 uniform
  U.scale = gl.getUniformLocation(program, 'u_scale');
  U.grain = gl.getUniformLocation(program, 'u_grain');
  U.time = gl.getUniformLocation(program, 'u_time');
  U.res = gl.getUniformLocation(program, 'u_resolution');
  U.offset = gl.getUniformLocation(program, 'u_offset');
  U.lightPos = gl.getUniformLocation(program, 'u_lightPos');
  U.lightCore = gl.getUniformLocation(program, 'u_lightCore');
  U.lightHalo = gl.getUniformLocation(program, 'u_lightHalo');
  U.vignette = gl.getUniformLocation(program, 'u_vignette');
  U.bloomThreshold = gl.getUniformLocation(program, 'u_bloomThreshold');
  U.bloomRange = gl.getUniformLocation(program, 'u_bloomRange');
  U.bloomStrength = gl.getUniformLocation(program, 'u_bloomStrength');

  gl.uniform1f(U.scale, CONFIG.scale);
  gl.uniform1f(U.grain, CONFIG.grain);
  gl.uniform2f(U.offset, CONFIG.offsetX / 100, CONFIG.offsetY / 100);
  gl.uniform2f(U.lightPos, CONFIG.lightX, CONFIG.lightY);
  gl.uniform1f(U.lightCore, CONFIG.lightCore);
  gl.uniform1f(U.lightHalo, CONFIG.lightHalo);
  gl.uniform1f(U.vignette, CONFIG.vignette);
  gl.uniform1f(U.bloomThreshold, CONFIG.bloomThreshold);
  gl.uniform1f(U.bloomRange, CONFIG.bloomRange);
  gl.uniform1f(U.bloomStrength, CONFIG.bloomStrength);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_c1'), CONFIG.color1);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_c2'), CONFIG.color2);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_c3'), CONFIG.color3);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_c4'), CONFIG.color4);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_c5'), CONFIG.color5);

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    canvas.style.display = 'none';
  });

  resize();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibility);

  lastTime = performance.now();
  schedule();
  initialized = true;
  return true;
}

function resize() {
  if (!gl || !canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxDpr);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  }
}

function onVisibility() {
  if (document.hidden) {
    stopLoop();
    paused = true;
  } else {
    paused = false;
    lastTime = performance.now();
    schedule();
  }
}

function render(dt) {
  if (!gl) return;
  // 时间公式与 dsh-plugin-backdrop 一致：speed/100 作为倍率
  timeAcc += dt * 0.001 * (CONFIG.speed / 100);
  frameCount++;
  gl.uniform1f(U.time, timeAcc);
  gl.uniform2f(U.res, canvas.width, canvas.height);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function schedule() {
  if (paused || !gl) return;
  if (rafId === null && timerId === null) {
    rafId = requestAnimationFrame(tick);
    timerId = setTimeout(() => {
      timerId = null;
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      tick(performance.now());
    }, 200);
  }
}

function stopLoop() {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  if (timerId !== null) { clearTimeout(timerId); timerId = null; }
}

function tick(now) {
  rafId = null;
  if (timerId !== null) { clearTimeout(timerId); timerId = null; }
  if (paused) return;
  try {
    const gap = now - lastTime;
    if (gap < CONFIG.minFrameGap) {
      if (timerId === null) {
        timerId = setTimeout(() => {
          timerId = null;
          if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
          tick(performance.now());
        }, CONFIG.minFrameGap - gap);
      }
      return;
    }
    const dt = Math.min(gap, 50);
    lastTime = now;
    resize();
    render(dt);
  } catch (e) {
    lastError = String((e && e.message) || e);
    console.warn('[hero-shader] 渲染异常:', e);
  }
  schedule();
}