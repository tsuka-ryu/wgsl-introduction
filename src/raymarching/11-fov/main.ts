// レイマーチング — 11 視野角を考慮したレイの定義
// wgld.org GLSL 連載 第11回「視野角を考慮したレイの定義」を WGSL に忠実移植。
// https://wgld.org/d/glsl/g011.html
//
// ★ 08 の targetDepth(遠近の強さ)を、ちゃんとした「画角(FOV)」として角度で明示する回。
//   絵は 10 とほぼ同じ(立体的な球)。変わるのはレイの向きの作り方だけ。
//
// ● 08 との違い:
//   08: カメラ基底で組む   ray = normalize(cSide*p.x + cUp*p.y + cDir*targetDepth)
//   11: FOV で直接組む     ray = normalize(vec3(sin(fov)*p.x, sin(fov)*p.y, -cos(fov)))
//   → カメラ基底(cSide/cUp/cDir)を省き、正面(-z)固定で「視野角」を明示。
//     基底版はカメラ回転に強い / FOV 版は画角を角度で直接いじれる、という別パラメータ化。
//
// ● 画角の仕組み:
//   angle = 60 度 → fov = angle * 0.5 * PI/180 = 半画角(ラジアン)。
//   画面端 p=(1,0) のレイ = (sin(fov), 0, -cos(fov)) は、前方(-z)から角度 fov だけ傾く。
//   → 端が中心から fov 傾く = 全体の視野角は 2*fov = angle(60度)。angle が大きいほど広角。
//   中心 p=(0,0) は (0,0,-cos(fov)) → 正規化して (0,0,-1) 真っ直ぐ前。
//   ※08 の targetDepth と対応: targetDepth = 1/tan(fov)(cot)。angle で直感的に画角指定できる版。
//
// マーチ・法線・ライティングは 10 と同じ。変数 distance→dist に改名。time/mouse は未使用。

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
    label: "raymarching 11 - fov",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const PI = 3.14159265;
      const angle = 60.0;                         // 視野角(度)
      const fov = angle * 0.5 * PI / 180.0;       // 半画角(ラジアン)
      const cPos = vec3f(0.0, 0.0, 2.0);          // カメラ位置 = レイ出発点
      const sphereSize = 1.0;
      const lightDir = vec3f(-0.577, 0.577, 0.577);

      fn distanceFunc(p: vec3f) -> f32 {
        return length(p) - sphereSize;
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

        // レイの向きを FOV で直接組む。端ほど前方から fov だけ傾く。
        let ray = normalize(vec3f(sin(fov) * p.x, sin(fov) * p.y, -cos(fov)));

        // マーチのループ (10 と同じ)。
        var dist = 0.0;
        var rLen = 0.0;
        var rPos = cPos;
        for (var i = 0; i < 16; i++) {
          dist = distanceFunc(rPos);
          rLen += dist;
          rPos = cPos + ray * rLen;
        }

        // 当たった点で法線を出して Lambert 拡散で陰影 (10 と同じ)。
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
    label: "raymarching 11 pipeline",
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
