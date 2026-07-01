// The Book of Shaders — 13 fBm: domain warping (座標に fBm を注いで歪める / 雲・大理石)
// https://thebookofshaders.com/13/?lan=jp   (patriciogv 2015, 元ネタは iq の warping)
//
// 前回 (13-fbm) は fbm(st) を1回評価して濃淡にしただけ。今回は「fBm の出力を fBm の入力
// 座標にフィードバックする」= domain warping。関数を値として扱い、入力そのものを別の場で
// ねじ曲げる、という高階の一手。denotational に書くと:
//
//   f(st) = fbm( st + r(st) )                         ← 最終の見た目
//   r(st) = ( fbm(st + q + c1 + t·k1),                ← st を q でさらに歪めた座標で測る
//             fbm(st + q + c2 + t·k2) )
//   q(st) = ( fbm(st),  fbm(st + (1,1)) )             ← 最初の歪みベクトル場
//
// つまり fbm を3段ネスト:  f = fbm(st + fbm(st + fbm(st)))。
// noise の値(スカラー)を2本束ねてベクトル q,r を作り、それを座標の"ずらし"に使う。
// 座標を一様に動かすと絵は平行移動するだけだが、ずらし量を場所ごとに変える(=場でずらす)と
// 空間がぐにゃりと引き伸ばされ、渦を巻いた雲・大理石の縞になる。これが domain warping。
//
// ── fbm 本体の違い(13-fbm から) ──────────────────────────
//   octave ごとに座標を「2倍」だけでなく回転 rot も掛ける:
//       st = rot * st * 2.0 + shift;
//   value noise は整数格子に沿った縞(軸バイアス)が出やすい。各層を 0.5rad 回してから
//   重ねると格子の向きがずれ、方眼っぽさが消える。shift=(100,100) は各層を無相関な
//   遠くの領域へ飛ばして層どうしの相関を切る(乱数の"別の場所"を使う)ため。
//
// ── 色 ──────────────────────────────────────────────
//   f,q,r という3つの中間場を、それぞれ別の色へ mix で焼き込む(本のパレットのまま):
//     f*f を青緑↔カーキに / |q| を濃紺に / |r.x| を淡いシアンに。
//   最後に (f³+.6f²+.5f) で明暗にコントラストを付ける。t を r 側だけに入れて雲を流す。

import { fail } from "../../webgpu-fundamentals/util";

async function main() {
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) {
    fail("このブラウザは WebGPU に対応していません (Chrome / Edge 113+ など)。");
    return;
  }

  const canvas = document.querySelector("canvas")!;
  const context = canvas.getContext("webgpu")!;
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: presentationFormat });

  const module = device.createShaderModule({
    label: "book of shaders 13 - fbm domain warping",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const NUM_OCTAVES = 5;

      fn random(st: vec2f) -> f32 {
        return fract(sin(dot(st, vec2f(12.9898, 78.233))) * 43758.5453123);
      }

      // 2D value noise (Morgan McGuire @morgan3d) — 11-noise-2d と同じ
      fn noise(st: vec2f) -> f32 {
        let i = floor(st);
        let f = fract(st);
        let a = random(i);
        let b = random(i + vec2f(1.0, 0.0));
        let c = random(i + vec2f(0.0, 1.0));
        let d = random(i + vec2f(1.0, 1.0));
        let uu = f * f * (3.0 - 2.0 * f);
        return mix(a, b, uu.x) +
               (c - a) * uu.y * (1.0 - uu.x) +
               (d - b) * uu.x * uu.y;
      }

      // fBm: 各 octave で回転 rot を掛けて軸バイアスを消す版
      fn fbm(p: vec2f) -> f32 {
        var v = 0.0;
        var a = 0.5;
        var st = p; // ループで破壊するのでコピー
        let shift = vec2f(100.0);
        // mat2x2f は列優先: 第1列(cos,sin), 第2列(-sin,cos) = GLSL mat2(cos,sin,-sin,cos) と同じ
        let rot = mat2x2f(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
        for (var i = 0; i < NUM_OCTAVES; i = i + 1) {
          v += a * noise(st);
          st = rot * st * 2.0 + shift; // 2倍拡大 + 回転 + 遠方シフト
          a *= 0.5;
        }
        return v;
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        let t = u.time;

        // GLSL の y 下原点に合わせて反転してから 3 倍拡大
        var uv = position.xy / u.resolution;
        uv.y = 1.0 - uv.y;
        let st = uv * 3.0;

        var color = vec3f(0.0);

        // 1段目: 最初の歪みベクトル場 q
        var q = vec2f(0.0);
        q.x = fbm(st + 0.00 * t);
        q.y = fbm(st + vec2f(1.0));

        // 2段目: q で歪めた座標で測る歪み場 r (t で流す)
        var r = vec2f(0.0);
        r.x = fbm(st + 1.0 * q + vec2f(1.7, 9.2) + 0.15 * t);
        r.y = fbm(st + 1.0 * q + vec2f(8.3, 2.8) + 0.126 * t);

        // 3段目: r で歪めた座標での最終 fbm
        let f = fbm(st + r);

        // 3つの中間場をパレットへ焼き込む
        color = mix(vec3f(0.101961, 0.619608, 0.666667),
                    vec3f(0.666667, 0.666667, 0.498039),
                    clamp((f * f) * 4.0, 0.0, 1.0));
        color = mix(color, vec3f(0.0, 0.0, 0.164706), clamp(length(q), 0.0, 1.0));
        color = mix(color, vec3f(0.666667, 1.0, 1.0), clamp(length(vec2f(r.x)), 0.0, 1.0));

        // 明暗のコントラスト付け
        let shade = f * f * f + 0.6 * f * f + 0.5 * f;
        return vec4f(shade * color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "fbm warp pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
  });

  const uniformBufferSize = 4 * 4; // 16 バイト
  const uniformValues = new Float32Array(uniformBufferSize / 4);
  const kResolutionOffset = 0;
  const kTimeOffset = 2;

  const uniformBuffer = device.createBuffer({
    label: "uniforms (resolution, time)",
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    label: "uniforms bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  function render(device: GPUDevice, time: number) {
    uniformValues.set([canvas.width, canvas.height], kResolutionOffset);
    uniformValues[kTimeOffset] = time;
    device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

    const renderPassDescriptor: GPURenderPassDescriptor = {
      label: "canvas renderPass",
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: [0, 0, 0, 1],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    };
    const encoder = device.createCommandEncoder({ label: "encoder" });
    const pass = encoder.beginRenderPass(renderPassDescriptor);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const c = entry.target as HTMLCanvasElement;
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;
      c.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
      c.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));
    }
  });
  observer.observe(canvas);

  const frame = (timeMs: number) => {
    render(device, timeMs * 0.001);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
