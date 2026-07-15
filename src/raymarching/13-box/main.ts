// レイマーチング — 13 箱型のボックスモデル
// wgld.org GLSL 連載 第13回「箱型のボックスモデル」を WGSL に忠実移植。
// https://wgld.org/d/glsl/g013.html
//
// ★ 12 との違いは distanceFunc(距離関数)を「球」から「箱」に差し替えただけ。
//   マーチ・法線・ライティング・無限複製(trans)は 12 と完全に同じ。
//   → notes「距離関数=形の部品カタログ / 形を変える=距離関数を差し替えるだけ」の実演。
//
// ● 箱の距離関数(丸み付きボックス SDF):
//     q = abs(trans(p));                            // 対称性で第1象限へ折る(+ trans で無限複製)
//     return length(max(q - vec3(0.5), 0.0)) - 0.1; // 箱の外側までの距離 - 丸め半径
//   - vec3(0.5) = 箱の半径(各軸 ±0.5 の直方体)
//   - max(q - 0.5, 0): 各軸で「箱からはみ出した量」。箱の内側は 0。
//     はみ出しベクトルの length = 箱表面までのユークリッド距離(外部)。
//   - -0.1: 表面を膨らませて角を丸める(丸み半径)。
//   球 length(p)-r と同じ「点→表面までの距離を返す純関数」。中身の式が違うだけ。
//
// ● WGSL メモ: max(vec3, 0.0) は型が合わないので max(v, vec3f(0.0))。mod は 12 同様 floor 版。

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
    label: "raymarching 13 - box",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const PI = 3.14159265;
      const angle = 60.0;
      const fov = angle * 0.5 * PI / 180.0;
      const cPos = vec3f(0.0, 0.0, 2.0);
      const lightDir = vec3f(-0.577, 0.577, 0.577);

      // 無限複製の座標変換 (12 と同じ)。WGSL の % は負でズレるので floor 版。
      fn trans(p: vec3f) -> vec3f {
        return p - 4.0 * floor(p / 4.0) - 2.0;
      }

      // 箱の距離関数 (丸み付きボックス)。球から差し替えたのはこれだけ。
      fn distanceFunc(p: vec3f) -> f32 {
        let q = abs(trans(p));
        return length(max(q - vec3f(0.5, 0.5, 0.5), vec3f(0.0))) - 0.1;
      }

      fn getNormal(p: vec3f) -> vec3f {
        let d = 0.0001;
        return normalize(vec3f(
          distanceFunc(p + vec3f(  d, 0.0, 0.0)) - distanceFunc(p + vec3f( -d, 0.0, 0.0)),
          distanceFunc(p + vec3f(0.0,   d, 0.0)) - distanceFunc(p + vec3f(0.0,  -d, 0.0)),
          distanceFunc(p + vec3f(0.0, 0.0,   d)) - distanceFunc(p + vec3f(0.0, 0.0,  -d))
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

        let ray = normalize(vec3f(sin(fov) * p.x, sin(fov) * p.y, -cos(fov)));

        var dist = 0.0;
        var rLen = 0.0;
        var rPos = cPos;
        for (var i = 0; i < 64; i++) {
          dist = distanceFunc(rPos);
          rLen += dist;
          rPos = cPos + ray * rLen;
        }

        if (abs(dist) < 0.001) {
          let normal = getNormal(rPos);
          let diff = clamp(dot(lightDir, normal), 0.1, 1.0);
          return vec4f(vec3f(diff), 1.0);
        }
        return vec4f(vec3f(0.0), 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "raymarching 13 pipeline",
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
