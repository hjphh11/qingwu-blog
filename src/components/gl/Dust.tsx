/**
 * 浮尘（光里的尘埃）。
 *
 * ── 为什么用 Points 而不是文档里写的 InstancedBufferGeometry ──
 * v6 §4.2 写的是 `InstancedBufferGeometry`。两者都能做到「顶点着色器漂移、CPU 零开销」，
 * 但一颗尘埃用 instanced quad 要 4~6 个顶点，用 `Points` 只要 1 个 —— 12 万粒子下这是
 * 50 万 vs 12 万的顶点差。而尘埃只需要「一个软圆点」，不需要旋转/拉伸，
 * `Points` + 片元里按 `gl_PointCoord` 画圆完全够用。
 * 所以这里选 Points，理由是可测量的顶点数，不是图省事。
 *
 * ── 关键约束 ──
 * 位置/速度全部在**一次性 attribute** 里生成，之后每帧只更新 `uTime` 一个 uniform。
 * 千万别在 useFrame 里遍历粒子改 position —— 那才是真正的 CPU 开销来源。
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { scroll as glScroll, clampDelta, reduceMotion } from '../../lib/gl/store';

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uScroll;
  uniform float uSpread;
  uniform float uSpeed;

  attribute float aSeed;
  attribute float aSize;

  varying float vAlpha;
  varying float vSeed;

  void main() {
    vSeed = aSeed;

    vec3 p = position;

    // 漂移：每颗尘埃用自己的相位，避免整片同步「呼吸」（那样一眼就看出是程序生成的）
    float t = uTime * uSpeed;
    p.x += sin(t * 0.31 + aSeed * 43.7) * 0.55;
    p.y += sin(t * 0.22 + aSeed * 17.3) * 0.42;
    p.z += cos(t * 0.19 + aSeed * 29.1) * 0.48;

    // 滚动视差：越近的尘埃（aSeed 大的）走得越多，形成纵深
    p.y -= uScroll * (0.6 + aSeed * 1.8);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    /* 近大远小。
       ⚠️ 这里的系数是**踩过的坑**：最初写 320，结果近处粒子的 gl_PointSize 被算到几百像素，
       12 万个直径几百像素的粉点叠在一起 → 整屏泛白，再叠上 Bloom 直接变成一片死白。
       目标尺寸是「细尘」：典型距离下 1~3px。所以系数取 12，并把结果夹在 0.5~4px，
       防止个别离相机极近的粒子忽然变成一个光斑。 */
    float dist = max(-mv.z, 1.0);
    gl_PointSize = clamp(uPixelRatio * aSize * 12.0 / dist, 0.5, 4.0);

    // 远处淡出，否则能看到「粒子方盒」的硬边界
    float depthFade = 1.0 - smoothstep(14.0, 34.0, -mv.z);
    vAlpha = depthFade * (0.35 + aSeed * 0.65);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;

  varying float vAlpha;
  varying float vSeed;

  void main() {
    // 圆点：按到中心的距离做软边，硬边的方形点会像噪点而不像尘埃
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    float soft = 1.0 - smoothstep(0.25, 1.0, r);

    // 少数尘埃更亮（当作反光的那几颗），全靠 seed 决定，不需要额外 attribute
    float glint = step(0.94, vSeed) * 0.9 + 0.35;

    gl_FragColor = vec4(uColor, soft * vAlpha * uOpacity * glint);
  }
`;

type Props = {
  count: number;
  /** 空间尺寸。x 铺满视口宽，z 给纵深 */
  spread?: [number, number, number];
  color?: string;
  opacity?: number;
  speed?: number;
};

export default function Dust({
  count,
  spread = [26, 16, 12],
  color = '#f6a5b8',
  opacity = 0.55,
  speed = 1,
}: Props) {
  const pointsRef = useRef<THREE.Points>(null);

  /* 一次性生成几何。依赖里只放 count / spread —— 换句话说：
     只要粒子数不变，这份 attribute 就永远不重建。 */
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const size = new Float32Array(count);

    const [sx, sy, sz] = spread;
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * sx;
      pos[i * 3 + 1] = (Math.random() - 0.5) * sy;
      /* 纵深全部铺在相机**前方远处**：相机在 z=6，所以 z 取 [-2-sz, -2]。
         早期写成「以 -1 为中心」会让一部分粒子跑到相机背后/贴脸，
         透视一放大就成了占满屏幕的光斑。 */
      pos[i * 3 + 2] = -2 - Math.random() * sz;
      seed[i] = Math.random();
      // 尺寸分布偏小：绝大多数是细尘，少数稍大，否则会像下雪
      size[i] = 0.5 + Math.pow(Math.random(), 2.6) * 1.7;
    }

    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    // 手动算包围盒会把 12 万个点全扫一遍，且我们永远不做视锥剔除判断（它本来就在相机前）
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);
    return g;
  }, [count, spread[0], spread[1], spread[2]]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: 1 },
          uScroll: { value: 0 },
          uSpread: { value: spread[0] },
          // 减动效：速度归零 → 尘埃还在（画面不空），但不再漂
          uSpeed: { value: reduceMotion() ? 0 : speed },
          uColor: { value: new THREE.Color(color) },
          uOpacity: { value: opacity },
        },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
      }),
    [color, opacity, speed, spread[0]],
  );

  useFrame((state, delta) => {
    const u = material.uniforms;
    u.uTime.value += clampDelta(delta);
    u.uPixelRatio.value = state.gl.getPixelRatio();
    // 滚动值来自 store 的 motion（只写不通知），这里读最新值即可
    u.uScroll.value = glScroll.progress;
  });

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
}
