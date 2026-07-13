// レイマーチング — 10 法線の算出と簡単なライティング
// wgld.org GLSL 連載 第10回「法線の算出と簡単なライティング」を WGSL に忠実移植。
// https://wgld.org/d/glsl/g010.html
//
// ★ 09 の白い円が、これで立体的な「球」に見える回。マーチ本体は 09 と同じで、
//   当たった後に「法線」を出して陰影(明るい/暗い)を付けるのが追加点。
//   第0回スライド56-60 / notes「陰影」の「値 f(p)=マーチ / 勾配 ∇f=法線」の後半がついに動く。
//
// ● 法線 = 距離場の勾配 ∇f (どんな形でも同じ計算で出る):
//     getNormal は各軸に ±d だけずらして距離関数の差分を取る = 数値微分(中心差分)。
//     f が一番急に増える向き = 表面からまっすぐ外向き = 法線。正規化して長さ1に。
//     → 距離関数を差し替えても、この関数は1バイトも変えずに法線が出る(全形共通)。
//     §4 頂点メッシュ 05 の「数値的法線(隣接点サンプリング)」と発想が同じ(対象が頂点→距離場)。
//
// ● ライティング (Lambert 拡散):
//     diff = clamp(dot(lightDir, normal), 0.1, 1.0)
//     光の向きと法線の内積 = 面が光にどれだけ正対してるか。正対=明るい(1)、横向き=暗い。
//     clamp の下限 0.1 = 裏側を真っ黒にしない環境光。この diff を明るさにして球を陰影づけ。
//
// WGSL メモ: 09 と同じく変数 distance → dist に改名(組み込み distance() 衝突回避)。
//   原典は time/mouse を宣言するが未使用。ここは resolution のみ。

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

  // 3. シェーダモジュール (頂点は 01 と同じフルスクリーン三角形)
  const module = device.createShaderModule({
    label: "raymarching 10 - normal & lighting",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const sphereSize = 1.0;
      // 光の向き (正規化済み: 1/√3 ≒ 0.577)。左上手前から差す。
      const lightDir = vec3f(-0.577, 0.577, 0.577);

      // 距離関数: 原点中心・半径 sphereSize の球。
      fn distanceFunc(p: vec3f) -> f32 {
        return length(p) - sphereSize;
      }

      // 法線 = 距離場の勾配 ∇f。各軸に ±d ずらした差分 (中心差分の数値微分)。
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

        // カメラ (09 と同じ)。
        let cPos  = vec3f(0.0, 0.0,  2.0);
        let cDir  = vec3f(0.0, 0.0, -1.0);
        let cUp   = vec3f(0.0, 1.0,  0.0);
        let cSide = cross(cDir, cUp);
        let targetDepth = 1.0;
        let ray = normalize(cSide * p.x + cUp * p.y + cDir * targetDepth);

        // マーチのループ (09 と同じ)。
        var dist = 0.0;
        var rLen = 0.0;
        var rPos = cPos;
        for (var i = 0; i < 16; i++) {
          dist = distanceFunc(rPos);
          rLen += dist;
          rPos = cPos + ray * rLen;
        }

        // 当たった点で法線を出して Lambert 拡散で陰影。
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
    label: "raymarching 10 pipeline",
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
