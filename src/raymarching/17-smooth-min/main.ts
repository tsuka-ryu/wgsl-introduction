// レイマーチング — 17 オブジェクト同士を補間して結合する (smooth min)
// wgld.org GLSL 連載「補間して結合」を WGSL に忠実移植。
// https://wgld.org/d/glsl/g016.html (連載の smooth min 回)
//
// ★ 15 の min は「一番近い方をカクッと選ぶ」→ 2物体の境界に角(エッジ)が立つ。
//   smooth min は境界を指数でなめらかに補間 → 2物体が水滴のように ぬるっと融合(メタボール的)。
//   ここではトーラスと平たい箱を smoothMin で結合。接合部がなめらかに繋がる。
//
// ● smooth min(指数版):
//     h = exp(-k*d1) + exp(-k*d2)
//     return -log(h) / k
//   - k = なめらかさの逆数(大きいほど鋭い=普通の min に近い / 小さいほど大きく融合)。ここは 8.0。
//   - なぜ融合するか: exp は小さい距離ほど大きい重みになり、両方が近い所では
//     2つの寄与が混ざる → 境界が丸くブレンドされる。-log(Σexp)/k は「なめらかな最小値」。
//   - min(a,b) の角ばった谷を、丸めた谷にする版。BoS 12章の距離場合成の発展(CSG の花形)。
//
// ● カメラが斜め上からの視点に変わる: cPos=(-3,3,3)、cDir/cUp は正規化済みの斜め向き。
//   平たい箱 (2.0 x 0.1 x 0.5) とトーラス (大1.5/管0.25) の融合を見やすい角度。
//
// WGSL メモ: exp/log は組み込み。max(abs(p)-vec3, 0) は max(..., vec3f(0))。変数 distance→dist。

import { fail } from "../../webgpu-fundamentals/util";

async function main() {
  // 1. アダプタとデバイスの取得
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) {
    fail("このブラウザは WebGPU に対応していません (Chrome / Edge 113+ など)。");
    return;
  }

  // 2. キャンバスを WebGPU 用に設定
  const canvas = document.querySelector("canvas")!;
  const context = canvas.getContext("webgpu")!;
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: presentationFormat });

  // 3. シェーダモジュール
  const module = device.createShaderModule({
    label: "raymarching 17 - smooth min",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const cPos = vec3f(-3.0,  3.0,  3.0);
      const cDir = vec3f( 0.577, -0.577, -0.577);
      const cUp  = vec3f( 0.577,  0.577, -0.577);
      const lightDir = vec3f(-0.577, 0.577, 0.577);

      // なめらかな最小値。k が大きいほど普通の min に近い(角が立つ)。
      fn smoothMin(d1: f32, d2: f32, k: f32) -> f32 {
        let h = exp(-k * d1) + exp(-k * d2);
        return -log(h) / k;
      }

      // 平たい箱 (2.0 x 0.1 x 0.5)。
      fn distFuncBox(p: vec3f) -> f32 {
        return length(max(abs(p) - vec3f(2.0, 0.1, 0.5), vec3f(0.0))) - 0.1;
      }

      // トーラス (大半径1.5 / 管0.25)。
      fn distFuncTorus(p: vec3f) -> f32 {
        let t = vec2f(1.5, 0.25);
        let r = vec2f(length(p.xy) - t.x, p.z);
        return length(r) - t.y;
      }

      // シーン = トーラスと箱を smoothMin でぬるっと結合。
      fn distFunc(p: vec3f) -> f32 {
        let d1 = distFuncTorus(p);
        let d2 = distFuncBox(p);
        return smoothMin(d1, d2, 8.0);
      }

      fn genNormal(p: vec3f) -> vec3f {
        let d = 0.0001;
        return normalize(vec3f(
          distFunc(p + vec3f(  d, 0.0, 0.0)) - distFunc(p + vec3f( -d, 0.0, 0.0)),
          distFunc(p + vec3f(0.0,   d, 0.0)) - distFunc(p + vec3f(0.0,  -d, 0.0)),
          distFunc(p + vec3f(0.0, 0.0,   d)) - distFunc(p + vec3f(0.0, 0.0,  -d))
        ));
      }

      @vertex fn vs(
        @builtin(vertex_index) vertexIndex : u32
      ) -> @builtin(position) vec4f {
        let pos = array(
          vec2f(-1.0,  3.0),
          vec2f( 3.0, -1.0),
          vec2f(-1.0, -1.0),
        );
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(
        @builtin(position) position: vec4f
      ) -> @location(0) vec4f {
        var p = (position.xy * 2.0 - u.resolution) / min(u.resolution.x, u.resolution.y);
        p.y = -p.y;

        let cSide = cross(cDir, cUp);
        let targetDepth = 1.0;
        let ray = normalize(cSide * p.x + cUp * p.y + cDir * targetDepth);

        var tmp = 0.0;
        var dist = 0.0;
        var dPos = cPos;
        for (var i = 0; i < 256; i++) {
          dist = distFunc(dPos);
          tmp += dist;
          dPos = cPos + tmp * ray;
        }

        var color: vec3f;
        if (abs(dist) < 0.001) {
          let normal = genNormal(dPos);
          let diff = clamp(dot(lightDir, normal), 0.1, 1.0);
          color = vec3f(1.0, 1.0, 1.0) * diff;
        } else {
          color = vec3f(0.0);
        }
        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "raymarching 17 pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: presentationFormat }],
    },
  });

  // 5. ユニフォームバッファ (resolution: vec2f)
  const uniformBufferSize = 4 * 4; // 16 バイト
  const uniformValues = new Float32Array(uniformBufferSize / 4);
  const kResolutionOffset = 0;

  const uniformBuffer = device.createBuffer({
    label: "uniforms (resolution)",
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    label: "uniforms bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  function render(device: GPUDevice) {
    uniformValues.set([canvas.width, canvas.height], kResolutionOffset);
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
      render(device);
    }
  });
  observer.observe(canvas);
}

main();
