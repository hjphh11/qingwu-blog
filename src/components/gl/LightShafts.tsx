/**
 * 光柱（体积光的背景层）。
 *
 * ── 为什么不用锥体几何 ────────────────────────────────────────
 * 最初用 `ConeGeometry` + 自定义着色器做光锥，试了三版都不对：
 *   1. 菲涅耳式（边缘亮）→ 一个边缘发光的**硬三角形**；
 *   2. 改成中心亮（|dot|）→ 变成掠射亮线：锥面接近与视线平行时，
 *      一长条表面挤到极少数像素上，加色混合把那里烧成一条锐利的光带（Bloom 后尤其刺眼）；
 *   3. 用 smoothstep 在掠射区归零 → 亮线还在，而且暴露出真正的病根：
 *      **只要是个几何体，它的轮廓边就会在画面里读成一条「墙」**。
 *
 * 所以改成**全屏 shader**：没有任何几何轮廓，光柱纯粹由「到某条直线的距离」定义，
 * 天然是软的、不会出硬边，而且只要 1 个 draw call。
 * 代价是它只有 2D 的观感 —— 但它本来就是背景氛围，纵深交给浮尘与相机视差去做。
 */

import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { clampDelta, reduceMotion } from '../../lib/gl/store';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform vec2  uAspect;      // (宽高比, 1) —— 让角度不被拉伸
  uniform float uTime;
  uniform vec3  uColorA;      // 主光
  uniform vec3  uColorB;      // 辅光
  uniform float uIntensityA;
  uniform float uIntensityB;
  uniform float uAngleA;
  uniform float uAngleB;
  uniform float uWidthA;
  uniform float uWidthB;

  varying vec2 vUv;

  /* 到「过点 o、方向 dir 的直线」的垂直距离 */
  float distToLine(vec2 p, vec2 o, float angle) {
    vec2 dir = vec2(cos(angle), sin(angle));
    vec2 nrm = vec2(-dir.y, dir.x);
    return abs(dot(p - o, nrm));
  }

  /* 一条光柱：核心 + 两层柔边，避免只有一个 smoothstep 时的「色带」 */
  float shaft(float d, float w, float soft) {
    float inner = smoothstep(w, w - soft, d);
    float outer = smoothstep(w * 2.6, 0.0, d) * 0.45;
    return inner + outer;
  }

  void main() {
    // 把 uv 换成「以画面中心为原点、按宽高比校正」的坐标
    vec2 p = (vUv - 0.5) * vec2(uAspect.x, 1.0);

    // 轻微呼吸，两条不同相位
    float breatheA = 0.9 + 0.1 * sin(uTime * 0.42);
    float breatheB = 0.9 + 0.1 * sin(uTime * 0.33 + 2.1);

    float a = shaft(distToLine(p, vec2(-0.34, 0.0), uAngleA), uWidthA, uWidthA * 1.4) * uIntensityA * breatheA;
    float b = shaft(distToLine(p, vec2( 0.36, 0.0), uAngleB), uWidthB, uWidthB * 1.4) * uIntensityB * breatheB;

    // 垂直衰减：越往下越淡，光是从上方照进来的
    float falloff = mix(1.0, 0.25, smoothstep(0.15, -0.55, p.y));
    a *= falloff;
    b *= falloff;

    vec3 color = uColorA * a + uColorB * b;
    float alpha = clamp(a + b, 0.0, 1.0);

    /* 加色混合是 src * srcAlpha + dst，所以最终贡献 = rgb * alpha。
       而我们要的贡献就是 color 本身（已经是 A*a + B*b 加权过的），
       于是 rgb 要除回 alpha。不除的话交叉处会二次变暗。 */
    gl_FragColor = vec4(color / max(alpha, 0.0001), alpha);
  }
`;

type Shaft = {
  color: string;
  intensity: number;
  angle: number;
  width: number;
};

type Props = {
  a: Shaft;
  b: Shaft;
  /** 距离相机的深度，决定平面要铺多大 */
  depth?: number;
};

export default function LightShafts({ a, b, depth = 26 }: Props) {
  const { size, camera } = useThree();

  /* 平面要盖住当前视口在 depth 处的截面，否则相机视差一动就会露边。
     多给 1.6 倍余量：相机视差与滚动推进都会让画面平移。 */
  const planeSize = useMemo(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const vFov = (cam.fov * Math.PI) / 180;
    const h = 2 * Math.tan(vFov / 2) * depth * 1.6;
    return [h * (size.width / Math.max(size.height, 1)), h] as const;
  }, [camera, depth, size.width, size.height]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uAspect: { value: new THREE.Vector2(1, 1) },
          uTime: { value: 0 },
          uColorA: { value: new THREE.Color(a.color) },
          uColorB: { value: new THREE.Color(b.color) },
          uIntensityA: { value: a.intensity },
          uIntensityB: { value: b.intensity },
          uAngleA: { value: a.angle },
          uAngleB: { value: b.angle },
          uWidthA: { value: a.width },
          uWidthB: { value: b.width },
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    [a.color, a.intensity, a.angle, a.width, b.color, b.intensity, b.angle, b.width],
  );

  useFrame((state, delta) => {
    const u = material.uniforms;
    if (!reduceMotion()) u.uTime.value += clampDelta(delta);
    // 视口比例要在 resize 之后同步，否则光柱角度会被拉伸
    u.uAspect.value.set(size.width / Math.max(size.height, 1), 1);
  });

  return (
    <mesh position={[0, 0, -depth]} material={material} frustumCulled={false}>
      <planeGeometry args={[planeSize[0], planeSize[1]]} />
    </mesh>
  );
}
