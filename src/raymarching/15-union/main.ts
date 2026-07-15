// レイマーチング — 15 重なりを考慮した描画 (min で和集合)
// wgld.org GLSL 連載 第15回「重なりを考慮した描画」を WGSL に忠実移植。
// (14「異なる形状」のトーラスもここで初出。)
// https://wgld.org/d/glsl/g015.html
//
// ★ ついに CSG(集合演算): 2つの距離関数を min で組んで「和集合(union)」を作る回。
//   notes「CSG 合成: min=和 / max=積 / max(d,-d)=差」の min=和 が実コードに。
//   物体=関数だから、複数物体 = 距離関数を min で合成するだけ(座標リストは0個)。
//
// ● 3つのプリミティブ:
//   - トーラス distFuncTorus (14 の形): t=(0.75, 0.25)=(大半径, 管の半径)。
//       r = vec2(length(p.xy) - t.x, p.z)  … xy面での中心円までの距離と z をペアに
//       return length(r) - t.y             … その2Dベクトルの長さ - 管の半径
//   - 床 distFuncFloor: 平面 y=-1 までの距離 = dot(p,(0,1,0)) + 1 = p.y + 1。
//       平面の SDF = 点と平面の符号付き距離(法線と内積 + オフセット)。
//   - distFunc = min(トーラス, 床) … 一番近い方 = 両方が同時に存在(和集合)。
//
// ● なぜ min が和集合か: 各点で「一番近い物体までの距離」を返すのが距離関数の定義。
//   2物体なら「近い方まで」= min(d1,d2)。マーチはこの min に沿って進むので、
//   トーラスにも床にも当たれる = 両方が1シーンに共存。
//
// ● カメラは 08 の基底形に戻る(11-13 の FOV 版から): cDir/cUp/cSide=cross, targetDepth=1。
//   床が遠くまで伸びるのでマーチを 256 回に増やす。変数名は原典に合わせ tmp/dPos。

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
    label: "raymarching 15 - union (min)",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const cPos = vec3f(0.0, 0.0,  3.0);
      const cDir = vec3f(0.0, 0.0, -1.0);
      const cUp  = vec3f(0.0, 1.0,  0.0);
      const lightDir = vec3f(-0.57, 0.57, 0.57);

      // トーラスの距離関数 (14 の形)。
      fn distFuncTorus(p: vec3f) -> f32 {
        let t = vec2f(0.75, 0.25);
        let r = vec2f(length(p.xy) - t.x, p.z);
        return length(r) - t.y;
      }

      // 床(平面 y=-1)の距離関数。
      fn distFuncFloor(p: vec3f) -> f32 {
        return dot(p, vec3f(0.0, 1.0, 0.0)) + 1.0;
      }

      // シーン = トーラス ∪ 床 = min(d1, d2)。
      fn distFunc(p: vec3f) -> f32 {
        let d1 = distFuncTorus(p);
        let d2 = distFuncFloor(p);
        return min(d1, d2);
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

        // カメラとレイ (基底形)。
        let cSide = cross(cDir, cUp);
        let targetDepth = 1.0;
        let ray = normalize(cSide * p.x + cUp * p.y + cDir * targetDepth);

        // マーチのループ (床が遠くまで伸びるので 256 回)。
        var tmp = 0.0;   // 継ぎ足した長さの合計
        var dist = 0.0;  // 現在の最短距離
        var dPos = cPos; // レイ先端位置
        for (var i = 0; i < 256; i++) {
          dist = distFunc(dPos);
          tmp += dist;
          dPos = cPos + tmp * ray;
        }

        // 当たり判定 + 陰影。
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
    label: "raymarching 15 pipeline",
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
