// レイマーチング — 21 レイマーチングソフトシャドウ (卒業制作)
// wgld.org GLSL 連載 全20回の最終回「レイマーチングソフトシャドウ」を WGSL 化。
// https://wgld.org/d/glsl/g020.html
//
// ★ これまでの集大成: 20 のトーラス+床+市松に、影・スペキュラ・光アニメを足す。
//   影の核心 = 「当たった点から光源へ 2本目のレイ(シャドウレイ)を飛ばす」。
//   途中で何かに遮られていれば影、遮られなければ光が届く。ぼかしも入れて柔らかい影に。
//
// ● genShadow(ro, rd): ソフトシャドウ(iq のスフィアトレース影)。
//   当たり点 ro から光方向 rd へマーチ。当たる前に、各ステップで
//   r = min(r, 距離 * 16 / 進んだ長さ) を追跡 = 「シャドウレイが遮蔽物にどれだけ掠めたか」。
//     - 遮蔽物にぶつかった(h<0.001) → 完全な影 shadowCoef(0.5)
//     - 掠めただけ → r が小さくなり半影(ペナンブラ)= 柔らかい影の縁
//     - 何にも近づかず抜けた → r≈1 = 影なし
//   16 は影の柔らかさ係数(大きいほどシャープ)。ハード影なら「当たった=影」の 0/1 だけ。
//   ※ ro を法線方向へ 0.001 押し出すのは、自分自身の表面に即ヒットして真っ黒になるのを防ぐため。
//
// ● 追加のライティング: スペキュラ(Blinn-Phong の半ベクトル)。
//   halfLE = normalize(light - ray)、spec = pow(clamp(dot(halfLE, normal),0,1), 50) = ハイライト。
//   光は time で左右に揺れる: light = normalize(lightDir + vec3(sin(time),0,0))。
//
// ※ genShadow 本体は原典の該当関数がフェッチできなかったため wgld 標準実装で再構成。
//   その他(トーラス/床/市松/カメラ)は 20 と同じ。距離関数の前段でマウスでトーラス移動。

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
    label: "raymarching 21 - soft shadow (graduation)",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
        mouse: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const cPos = vec3f(0.0, 5.0,  5.0);
      const cDir = vec3f(0.0, -0.707, -0.707);
      const cUp  = vec3f(0.0,  0.707, -0.707);
      const lightDir = vec3f(-0.57, 0.57, 0.57);

      // トーラス(マウスで xz 移動、大3.0/管1.0)。
      fn distFuncTorus(p_in: vec3f) -> f32 {
        var p = p_in;
        let m = u.mouse * 2.0 - 1.0;
        p.x = p.x - m.x;
        p.z = p.z - m.y;
        let t = vec2f(3.0, 1.0);
        let r = vec2f(length(p.xz) - t.x, p.y);
        return length(r) - t.y;
      }

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

      // ソフトシャドウ: ro から光方向 rd へシャドウレイをマーチ。
      fn genShadow(ro: vec3f, rd: vec3f) -> f32 {
        var h = 0.0;
        var c = 0.001;       // 開始オフセット(自己ヒット回避)
        var r = 1.0;         // 影の明るさ(1=影なし)
        let shadowCoef = 0.5;
        for (var t = 0.0; t < 50.0; t += 1.0) {
          h = distFunc(ro + rd * c);
          if (h < 0.001) {
            return shadowCoef;                 // 遮蔽物にヒット = 完全な影
          }
          r = min(r, h * 16.0 / c);            // どれだけ掠めたか(半影)
          c += h;
        }
        return 1.0 - shadowCoef + r * shadowCoef; // 抜けた = 影なし〜半影
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

        // 1本目: 視線レイのマーチ(早期 break)。
        var tmp = 0.0;
        var dist = 0.0;
        var dPos = cPos;
        for (var i = 0; i < 256; i++) {
          dist = distFunc(dPos);
          if (dist < 0.001) { break; }
          tmp += dist;
          dPos = cPos + tmp * ray;
        }

        // 光は time で左右に揺れる。
        let light = normalize(lightDir + vec3f(sin(u.time), 0.0, 0.0));

        var color: vec3f;
        var shadow = 1.0;
        if (abs(dist) < 0.001) {
          let normal = genNormal(dPos);

          // 拡散 + スペキュラ(Blinn-Phong 半ベクトル)。
          let halfLE = normalize(light - ray);
          var diff = clamp(dot(light, normal), 0.1, 1.0);
          let spec = pow(clamp(dot(halfLE, normal), 0.0, 1.0), 50.0);

          // 2本目: 当たり点から光源へシャドウレイ(法線方向へ少し押し出して開始)。
          shadow = genShadow(dPos + normal * 0.001, light);

          // world 座標から市松模様(20 と同じ)。
          let uu = 1.0 - floor(dPos.x - 2.0 * floor(dPos.x / 2.0));
          let vv = 1.0 - floor(dPos.z - 2.0 * floor(dPos.z / 2.0));
          if ((uu == 1.0 && vv < 1.0) || (uu < 1.0 && vv == 1.0)) {
            diff = diff * 0.7;
          }

          color = vec3f(1.0, 1.0, 1.0) * diff + vec3f(spec);
        } else {
          color = vec3f(0.0);
        }

        // 影を掛ける(下限 0.5 で真っ黒にはしない)。
        return vec4f(color * max(0.5, shadow), 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "raymarching 21 pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: presentationFormat }],
    },
  });

  // 5. ユニフォームバッファ (resolution: vec2f, time: f32, mouse: vec2f)
  const uniformBufferSize = 8 * 4; // 32 バイト
  const uniformValues = new Float32Array(uniformBufferSize / 4);
  const kResolutionOffset = 0;
  const kTimeOffset = 2;
  const kMouseOffset = 4;

  const uniformBuffer = device.createBuffer({
    label: "uniforms (resolution, time, mouse)",
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    label: "uniforms bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  // マウス座標 (0〜1)。トーラスの位置。
  const mouse = { x: 0.5, y: 0.5 };
  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) / rect.width;
    mouse.y = (e.clientY - rect.top) / rect.height;
  });

  function render(device: GPUDevice, time: number) {
    uniformValues.set([canvas.width, canvas.height], kResolutionOffset);
    uniformValues[kTimeOffset] = time;
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

  // 毎フレーム time を進めて光を揺らす(マウスでトーラスも動く)。
  const frame = (timeMs: number) => {
    render(device, timeMs * 0.001);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
