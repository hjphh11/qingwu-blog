/**
 * 声音场景：声场涟漪 + 浮尘。
 *
 * 涟漪用三个同心 `RingGeometry`，错相位向外扩散 —— 比「一堆随机跳动的柱子」
 * 更像声场，也不会在没人播歌时显得焦躁。
 *
 * ⚠️ 现在还**没有接真实音频**：`AnalyserNode` 与频谱要等第 8 条（声音页）。
 * 那一步只需把算出来的低频能量写进 `motion.beat`，这里的振幅会自动跟上去。
 * 先放一个极慢的呼吸振幅，保证「没播歌时场景是静的但不死」。
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { clampDelta } from '../../../lib/gl/store';
import Dust from '../Dust';
import LightShafts from '../LightShafts';

const RING_COUNT = 3;

export default function SoundScene({ dust }: { dust: number }) {
  const rings = useRef<(THREE.Mesh | null)[]>([]);

  /* useMemo 而不是 useRef(new ...)：useRef 的参数每次渲染都会求值，
     会白建 ShaderMaterial。 */
  const ringMaterial = useMemo(
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
        uniform float uAlpha;
        varying vec2 vUv;
        void main() {
          // RingGeometry 的 uv 在环向上是 u，径向是 v。这里只要一层均匀的淡色 + 软边
          float edge = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
          gl_FragColor = vec4(uColor, edge * uAlpha);
        }
      `,
      uniforms: {
        uColor: { value: new THREE.Color('#f6a5b8') },
        uAlpha: { value: 0.5 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      }),
    [],
  );

  useFrame((_s, delta) => {
    const d = clampDelta(delta);
    // 三个环各自错开 1/3 周期向外扩散：phase 到 1 时缩回 0 重新开始
    for (let i = 0; i < RING_COUNT; i++) {
      const m = rings.current[i];
      if (!m) continue;
      const phase = (performance.now() / 1000 / 6 + i / RING_COUNT) % 1;
      const s = 0.6 + phase * 6.2;
      m.scale.set(s, s, 1);
      // 越往外越淡，避免扩散到边缘时出现一个硬光圈
      m.rotation.z += d * 0.02 * (i % 2 === 0 ? 1 : -1);
    }
  });

  return (
    <>
      <LightShafts
        a={{ color: '#f6a5b8', intensity: 0.14, angle: 1.58, width: 0.14 }}
        b={{ color: '#e8b04b', intensity: 0.08, angle: 1.48, width: 0.11 }}
      />
      {Array.from({ length: RING_COUNT }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            rings.current[i] = el;
          }}
          position={[0, 0, -3.5]}
          material={ringMaterial}
        >
          <ringGeometry args={[0.86, 1, 96]} />
        </mesh>
      ))}
      <Dust count={dust} color="#f6a5b8" opacity={0.4} speed={0.9} spread={[22, 14, 12]} />
    </>
  );
}
