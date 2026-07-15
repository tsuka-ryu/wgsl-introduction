// レイマーチング — 16 距離関数の合成 (max で積集合・差集合)
// wgld.org GLSL 連載 第16回相当「距離関数の合成」を WGSL 化。
// https://wgld.org/d/glsl/g016.html
//
// ★ サッカーボールのようなパネル球の作り方 = AND(積集合):
//   - 球体1個(中心、複製なし)
//   - 箱を repetition(mod)で無限複製
//   - 両者を max(d1, d2) で合成 = 論理演算の AND → 「両方に重なる部分だけ」レンダリング
//   → 球の表面が、無限に敷いた箱グリッドで切り取られてパネル状に(隙間=箱の無い所=溝)。
//
// ● CSG(集合演算)は距離関数の min/max だけ(notes「CSG 合成」):
//     min(d1, d2)   = 和集合 union      (15 でやった)
//     max(d1, d2)   = 積集合 intersection(今回。重なりだけ = AND)
//     max(d1, -d2)  = 差集合 subtraction (d2 で d1 を刳り貫く)
//     max(-d1, d2)  = 差集合 subtraction (d1 で d2 を刳り貫く)
//   物体=関数だから、形の組み方は式の合成だけ。座標データは持たない。
//
// ● パラメータ(球の半径・箱の周期/サイズ)は見た目のツマミ。値を変えるとパネルの数や溝幅が変わる。
//
// WGSL メモ: mod は floor 版(12 と同じ、負でズレる回避)。max(vec,0) は max(v, vec3f(0))。

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
    label: "raymarching 16 - intersection (paneled sphere)",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 正面から。cDir は原点を注視する向き(fs で normalize(-cPos))。
      const cPos = vec3f(0.0, 0.0, 3.0);
      const cUp  = vec3f(0.0, 1.0, 0.0);
      const lightDir = vec3f(-0.577, 0.577, 0.577);

      const sphereSize = 1.5;     // 中心の球の半径
      const boxPeriod = 0.6;      // 箱の複製周期(大きいほどパネルが大きい)
      const boxHalf = 0.25;       // 箱の半径(period/2 に近いほど溝が細く=球面が主役=flush パネル)

      // 箱だけを無限複製するための座標変換 (12 と同じ floor 版 mod)。
      fn transBox(p: vec3f) -> vec3f {
        return p - boxPeriod * floor(p / boxPeriod) - boxPeriod * 0.5;
      }

      // 球体(中心に1個、複製なし)。
      fn distFuncSphere(p: vec3f) -> f32 {
        return length(p) - sphereSize;
      }

      // 箱(無限複製、丸み少し)。
      fn distFuncBox(p: vec3f) -> f32 {
        let q = abs(transBox(p));
        return length(max(q - vec3f(boxHalf, boxHalf, boxHalf), vec3f(0.0))) - 0.02;
      }

      const tilt = 0.0;           // パターンの横への傾き(ラジアン。17 の領域回転の先取り。0=正面)

      // シーンの合成。max で積集合 = 球 ∩ 複製箱 = パネル球。
      // 入口で p を z 軸回りに回す → 箱グリッドだけ傾く(球は回転対称で不変)。
      fn distFunc(p_in: vec3f) -> f32 {
        let c = cos(tilt);
        let s = sin(tilt);
        let p = vec3f(c * p_in.x - s * p_in.y, s * p_in.x + c * p_in.y, p_in.z);
        let d1 = distFuncSphere(p);
        let d2 = distFuncBox(p);
        return max(d1, d2);       // 積集合(AND): 両方に重なる部分だけ = サッカーボール
        // return max(d1, -d2);   // 差集合: 箱で球を刳り貫く
        // return max(-d1, d2);   // 差集合: 球で箱を刳り貫く
        // return min(d1, d2);    // 和集合: 球と箱が両方存在(15)
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

        let cDir = normalize(-cPos); // 原点を注視(見下ろし)
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
    label: "raymarching 16 pipeline",
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
