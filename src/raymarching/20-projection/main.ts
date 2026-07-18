// レイマーチング — 20 オブジェクトにテクスチャなどを投影する
// wgld.org GLSL 連載「オブジェクトにテクスチャなどを投影する」を WGSL に忠実移植。
// https://wgld.org/d/glsl/g019.html
//
// ★ 当たった点の world 座標 (dPos) から模様を計算 = ワールド空間テクスチャの投影。
//   ここでは dPos.x / dPos.z で市松(チェッカー)を作る → 床にも、その上のトーラスにも
//   同じ格子が回り込んで貼られる(平面に投影した模様を空間に固定している感じ)。
//
// ● 新要素:
//   ① マーチに早期 break(初登場): dist<0.001 になったら即ループ脱出。
//      これまでは固定回数まわしていた。当たった時点で止める最適化(無駄な反復を省く)。
//   ② 市松模様: u = 1 - floor(mod(dPos.x, 2)), v = 1 - floor(mod(dPos.z, 2))。
//      2 単位ごとに 0/1 が切り替わる。u,v のどちらか一方だけ 1 のセルを暗く → チェッカー。
//      色を「表面の world 座標の関数」にする = テクスチャ投影。
//   ③ マウスでトーラスを移動(距離関数の中で p.xz をずらす)。
//   ④ アスペクト正規化が min → max(縦横比の取り方違い。正方キャンバスでは同じ)。
//
// ● カメラは高い所 (0,5,5) から床を見下ろす。床 = 平面 y=-1、トーラスは大3.0/管1.0。
//
// WGSL メモ: swizzle 代入 (p.xz -= …) は不可なので成分ごと。mod は floor 版。

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
    label: "raymarching 20 - texture projection (checker)",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        mouse: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const cPos = vec3f(0.0, 5.0,  5.0);
      const cDir = vec3f(0.0, -0.707, -0.707);
      const cUp  = vec3f(0.0,  0.707, -0.707);
      const lightDir = vec3f(-0.57, 0.57, 0.57);

      // トーラス。マウスで xz 平面上を移動。大半径3.0 / 管1.0。
      fn distFuncTorus(p_in: vec3f) -> f32 {
        var p = p_in;
        let m = u.mouse * 2.0 - 1.0;   // 0〜1 → -1〜1
        p.x = p.x - m.x;
        p.z = p.z - m.y;
        let t = vec2f(3.0, 1.0);
        let r = vec2f(length(p.xz) - t.x, p.y);
        return length(r) - t.y;
      }

      // 床(平面 y=-1)。
      fn distFuncFloor(p: vec3f) -> f32 {
        return dot(p, vec3f(0.0, 1.0, 0.0)) + 1.0;
      }

      fn distFunc(p: vec3f) -> f32 {
        return min(distFuncTorus(p), distFuncFloor(p));
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
        // アスペクト正規化は max 版(原典に合わせる)。
        var p = (position.xy * 2.0 - u.resolution) / max(u.resolution.x, u.resolution.y);
        p.y = -p.y;

        let cSide = cross(cDir, cUp);
        let targetDepth = 1.0;
        let ray = normalize(cSide * p.x + cUp * p.y + cDir * targetDepth);

        // マーチのループ(早期 break 付き)。
        var tmp = 0.0;
        var dist = 0.0;
        var dPos = cPos;
        for (var i = 0; i < 256; i++) {
          dist = distFunc(dPos);
          if (dist < 0.001) { break; }   // 当たったら即脱出
          tmp += dist;
          dPos = cPos + tmp * ray;
        }

        var color: vec3f;
        if (abs(dist) < 0.001) {
          let normal = genNormal(dPos);
          var diff = clamp(dot(lightDir, normal), 0.1, 1.0);

          // world 座標から市松模様を投影(2 単位ごとに切替)。
          let uu = 1.0 - floor(dPos.x - 2.0 * floor(dPos.x / 2.0));
          let vv = 1.0 - floor(dPos.z - 2.0 * floor(dPos.z / 2.0));
          if ((uu == 1.0 && vv < 1.0) || (uu < 1.0 && vv == 1.0)) {
            diff = diff * 0.7;
          }

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
    label: "raymarching 20 pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: presentationFormat }],
    },
  });

  // 5. ユニフォームバッファ (resolution: vec2f, mouse: vec2f)
  const uniformBufferSize = 4 * 4; // 16 バイト
  const uniformValues = new Float32Array(uniformBufferSize / 4);
  const kResolutionOffset = 0;
  const kMouseOffset = 2;

  const uniformBuffer = device.createBuffer({
    label: "uniforms (resolution, mouse)",
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    label: "uniforms bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  // マウス座標 (0〜1)。トーラスの位置に使う。
  const mouse = { x: 0.5, y: 0.5 };
  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) / rect.width;
    mouse.y = (e.clientY - rect.top) / rect.height;
  });

  function render(device: GPUDevice) {
    uniformValues.set([canvas.width, canvas.height], kResolutionOffset);
    uniformValues.set([mouse.x, mouse.y], kMouseOffset);
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

  // マウスで動くので毎フレーム描画。
  const frame = () => {
    render(device);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
