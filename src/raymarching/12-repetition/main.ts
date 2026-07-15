// レイマーチング — 12 オブジェクトの複製 (repetition)
// wgld.org GLSL 連載 第12回「オブジェクトの複製」を WGSL に忠実移植。
// https://wgld.org/d/glsl/g012.html
//
// ★ 第0回で「データなら∞頂点で不可能、関数なら1行で無限」と掴んだ無限複製が、ついに動く回。
//   球の距離関数は1個のまま、レイ座標 p を折り畳むだけで球が空間いっぱいに無限に並ぶ。
//
// ● 仕掛けは trans() 1個: 距離関数に渡す前に p を mod で折り畳む(= domain warp / 座標変換)。
//     trans(p) = mod(p, 4.0) - 2.0
//       mod(p, 4.0): どんな遠い p も 0〜4 の1タイルに巻き取る → 空間全体が1セルの繰り返しに。
//       -2.0: セルの中心を原点へ(球をセル中央に置く)。
//   distanceFunc(p) = length(trans(p)) - r なので、「今このセル内で一番近い球まで」を返す。
//   → 球の式は1本、でも 4 ごとに無限個。物体=関数だからできる(notes「無限複製」)。
//
// ● ★ WGSL の落とし穴: GLSL mod(x,y) = x - y*floor(x/y) は常に [0,y)。
//   WGSL の % は剰余で符号が被除数依存 → 負の座標でタイルがズレる。
//   なので mod を floor で明示的に書く: p - n*floor(p/n)。(カメラ前方は負座標を通るので必須)
//
// ● マーチのループを 16 → 64 回に増やす: レイが多数のセルを貫いて遠くの球まで進むため。
//
// FOV レイ・法線・ライティングは 11 と同じ。time/mouse 未使用。

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
    label: "raymarching 12 - repetition",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const PI = 3.14159265;
      const angle = 60.0;
      const fov = angle * 0.5 * PI / 180.0;
      const cPos = vec3f(0.0, 0.0, 2.0);
      const sphereSize = 1.0;
      const lightDir = vec3f(-0.577, 0.577, 0.577);

      // 空間を 4 ごとに折り畳んで中心化 = 無限複製の座標変換。
      // GLSL mod(p,4)-2 相当。WGSL の % は負で挙動が違うので floor で明示。
      fn trans(p: vec3f) -> vec3f {
        return p - 4.0 * floor(p / 4.0) - 2.0;
      }

      fn distanceFunc(p: vec3f) -> f32 {
        return length(trans(p)) - sphereSize;
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

        // FOV レイ (11 と同じ)。
        let ray = normalize(vec3f(sin(fov) * p.x, sin(fov) * p.y, -cos(fov)));

        // マーチのループ。多数のセルを貫くので 64 回に増やす。
        var dist = 0.0;
        var rLen = 0.0;
        var rPos = cPos;
        for (var i = 0; i < 64; i++) {
          dist = distanceFunc(rPos);
          rLen += dist;
          rPos = cPos + ray * rLen;
        }

        // 当たった点で法線を出して Lambert 拡散で陰影 (10/11 と同じ)。
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
    label: "raymarching 12 pipeline",
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
