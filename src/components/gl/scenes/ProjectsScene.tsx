/**
 * 项目/关于场景：展厅顶光 + 一道缓慢横扫的镭射光。
 *
 * 关键工程判断（v6 §4.4）：**不要每张卡一个 WebGL 上下文**。移动端浏览器通常只允许
 * 8~16 个上下文，两个以上就开始丢。所以「镭射闪卡」的箔膜与光扫都走 CSS，
 * 这里只负责整个展厅的氛围光 —— 一道垂直顶光 + 一条横扫的光带。
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { clampDelta } from '../../../lib/gl/store';
import Dust from '../Dust';
import LightShafts from '../LightShafts';

export default function ProjectsScene({ dust }: { dust: number }) {
  const sweepRef = useRef<THREE.Mesh>(null);

  /* useMemo 而不是 useRef(new ShaderMaterial(...))：useRef 的**参数每次渲染都会求值**，
     那样每次 render 都会白建一个 ShaderMaterial（且永不 dispose）。 */
  const sweepMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uTime;
          varying vec2 vUv;
          void main() {
            // 横向软边（两端透明）+ 纵向极淡，做成一条光带而不是一块板
            float x = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.5, vUv.x);
            float y = smoothstep(0.0, 0.45, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
            float flicker = 0.85 + 0.15 * sin(uTime * 1.7);
            gl_FragColor = vec4(uColor, x * y * 0.55 * flicker);
          }
        `,
        uniforms: {
          uColor: { value: new THREE.Color('#e8b04b') },
          uTime: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  useFrame((_s, delta) => {
    const mat = sweepMaterial;
    mat.uniforms.uTime.value += clampDelta(delta);
    const m = sweepRef.current;
    if (!m) return;
    // 6.5s 走一个来回。太快会像故障，太慢就不像「扫」
    m.position.x = Math.sin(mat.uniforms.uTime.value * 0.48) * 6.5;
  });

  return (
    <>
      {/* 展厅顶光：近乎垂直，窄而亮 */}
      <LightShafts
        a={{ color: '#ffd9b0', intensity: 0.26, angle: 1.5708, width: 0.07 }}
        b={{ color: '#f6a5b8', intensity: 0.10, angle: 1.44, width: 0.12 }}
      />
      <mesh ref={sweepRef} position={[0, 0.5, -2.2]} rotation={[0, 0, 0]} material={sweepMaterial}>
        <planeGeometry args={[14, 0.9]} />
      </mesh>
      <Dust count={dust} color="#e8b04b" opacity={0.34} speed={0.6} spread={[24, 14, 12]} />
    </>
  );
}
