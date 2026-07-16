// レイマーチング — 18 行列で回転 (レイ座標の領域変形)
// wgld.org GLSL 連載「行列で回転」を WGSL に忠実移植。
// https://wgld.org/d/glsl/g017.html
//
// ★ 座標変換 = 領域変形の本番。距離関数に渡す前に p を回転行列で回す → シーン全体が回る。
//   「変形 = レイ座標への関数適用」(notes)。§4 頂点07 のツイストと同発想(対象が頂点→距離場)。
//   time でアニメ: トーラス+箱+シリンダーを smooth min で融合したブロブが、軸(1,0.5,0)回りに回転。
//
// ● rotate(p, angle, axis): 任意軸回りの回転(ロドリゲスの公式で回転行列を組み、p に掛ける)。
//   q = rotate(p, θ) を距離関数の頭で噛ませる = 空間ごと -θ 回した所で形を評価 → 見かけ +θ 回転。
//   ※物体データを回すのでなく「座標を回す関数」を1個挟むだけ。物体=関数だからできる合成。
//
// ● 3形状を2段 smooth min で融合: smoothMin(smoothMin(torus, box), cylinder)。
//   シリンダー SDF = 有限円柱(円板の押し出し)。min(max(d.x,d.y),0)+length(max(d,0)) は箱と同型の式。
//
// WGSL メモ: mat3x3f は列優先。GLSL mat3(9値=列優先) を列ベクトル3本で構成(同じ並び)。
//   radians()/exp()/log() は組み込み。time ユニフォームを追加してアニメーション。

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
    label: "raymarching 18 - rotate",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const cPos = vec3f(0.0, 0.0,  3.0);
      const cDir = vec3f(0.0, 0.0, -1.0);
      const cUp  = vec3f(0.0, 1.0,  0.0);
      const lightDir = vec3f(0.577, 0.577, 0.577);

      // 任意軸回りの回転(ロドリゲス)。mat3x3f は列優先: 各 vec3f が1列。
      fn rotate(p: vec3f, angle: f32, axis: vec3f) -> vec3f {
        let a = normalize(axis);
        let s = sin(angle);
        let c = cos(angle);
        let r = 1.0 - c;
        let m = mat3x3f(
          vec3f(a.x * a.x * r + c,     a.y * a.x * r + a.z * s, a.z * a.x * r - a.y * s),
          vec3f(a.x * a.y * r - a.z * s, a.y * a.y * r + c,     a.z * a.y * r + a.x * s),
          vec3f(a.x * a.z * r + a.y * s, a.y * a.z * r - a.x * s, a.z * a.z * r + c)
        );
        return m * p;
      }

      fn smoothMin(d1: f32, d2: f32, k: f32) -> f32 {
        let h = exp(-k * d1) + exp(-k * d2);
        return -log(h) / k;
      }

      fn distFuncTorus(p: vec3f, r: vec2f) -> f32 {
        let d = vec2f(length(p.xy) - r.x, p.z);
        return length(d) - r.y;
      }

      fn distFuncBox(p: vec3f) -> f32 {
        return length(max(abs(p) - vec3f(2.0, 0.1, 0.5), vec3f(0.0))) - 0.1;
      }

      // 有限円柱(円板の押し出し)。箱と同型の式(min(max)+length(max))。
      fn distFuncCylinder(p: vec3f, r: vec2f) -> f32 {
        let d = abs(vec2f(length(p.xy), p.z)) - r;
        return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0))) - 0.1;
      }

      // シーン = p を回してから 3形状を smooth min で融合。
      fn distFunc(p: vec3f) -> f32 {
        let q = rotate(p, radians(u.time * 10.0), vec3f(1.0, 0.5, 0.0));
        let d1 = distFuncTorus(q, vec2f(1.5, 0.25));
        let d2 = distFuncBox(q);
        let d3 = distFuncCylinder(q, vec2f(0.75, 0.25));
        return smoothMin(smoothMin(d1, d2, 16.0), d3, 16.0);
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
    label: "raymarching 18 pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: presentationFormat }],
    },
  });

  // 5. ユニフォームバッファ (resolution: vec2f, time: f32)
  const uniformBufferSize = 4 * 4; // 16 バイト (vec2f + f32 + pad)
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

  // リサイズ時はキャンバス解像度だけ更新 (描画はループ側が毎フレーム行う)。
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

  // 毎フレーム time を進めて回転させる。
  const frame = (timeMs: number) => {
    render(device, timeMs * 0.001);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
