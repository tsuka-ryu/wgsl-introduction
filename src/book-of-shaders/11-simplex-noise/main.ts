// The Book of Shaders — 11 ノイズ: シンプレックスノイズ (simplex noise)
// https://thebookofshaders.com/11/?lan=jp
// GLSL 2D simplex noise — Ian McEwan, Ashima Arts (MIT)  https://github.com/ashima/webgl-noise
//
// 11-simplex-grid で見た「三角格子」の上で実際にノイズを計算する、11章ノイズの完成形。
// gradient noise (正方格子・4隅・双線形補間) の正統進化版:
//   ・正方格子 → 三角格子 (skew で作る)。1点が属する三角の頂点は 3 つだけ (N次元で N+1)。
//   ・補間しない。各頂点から「勾配 dot 変位」を出し、距離で減衰する重みで足すだけ。
//   結果、軸沿いの癖がほぼ消え、計算も軽い。iq/Ashima 系が標準で使うノイズ。
//
// ── 1ピクセル v でのトレース (denotational に) ───────────────────────────────
//   ① 三角格子の "どのマス" か:  i = floor(skew した v)。x0 = そのマス基準点から自分への変位。
//   ② 自分がマス内の上/下どちらの三角形か:  x0.x > x0.y で分岐し、2 つ目の頂点 i1 を決める。
//      これで関わる頂点が 3 つ (x0, x1, x2 への変位) に確定する。
//   ③ 各頂点に乱数の勾配を割り当て (permute でハッシュ → 円周上の向き)。
//   ④ 各頂点の寄与 = (勾配 · その頂点から自分への変位) × 重み。
//      重み m = max(0.5 - 距離², 0)⁴。頂点から離れるほど 0 に落ちる丸い窓 (gradient noise の
//      双線形重みに相当)。近い頂点だけが効く。
//   ⑤ 3 頂点の寄与を合計し定数 130 で正規化 → だいたい -1〜1 の最終ノイズ値。
//
// gradient noise との対応: 「格子点に勾配を置き、dot(勾配, 変位) を取る」核は全く同じ。
// 違いは "格子が三角" であることと、"双線形補間でなく距離の丸い窓で重み付け" すること。

import { fail } from "../../webgpu-fundamentals/util";

async function main() {
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) {
    fail("このブラウザは WebGPU に対応していません (Chrome / Edge 113+ など)。");
    return;
  }

  const canvas = document.querySelector("canvas")!;
  const context = canvas.getContext("webgpu")!;
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: presentationFormat });

  const module = device.createShaderModule({
    label: "book of shaders 11 - simplex noise",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // permute のための剰余。乱数ハッシュが大きくなりすぎて精度落ちするのを防ぐ周期処理。
      // GLSL は mod289 を vec3/vec2 でオーバーロードしていたが、WGSL は同名多重定義不可なので分ける。
      fn mod289v3(x: vec3f) -> vec3f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      fn mod289v2(x: vec2f) -> vec2f { return x - floor(x * (1.0 / 289.0)) * 289.0; }

      // 整数の頂点インデックス → 擬似乱数。各頂点に割り当てる勾配の "種" を作るハッシュ。
      fn permute(x: vec3f) -> vec3f { return mod289v3(((x * 34.0) + 1.0) * x); }

      // 2D simplex noise 本体。戻り値はおよそ -1〜1。
      fn snoise(v: vec2f) -> f32 {
        // 三角格子のための定数。C.x=(3-√3)/6, C.y=(√3-1)/2 (skew量), C.z=-1+2*C.x, C.w=1/41。
        let C = vec4f(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);

        // ① 第1頂点: skew して自分の三角マスの基準点 i を求め、そこからの変位 x0 を出す。
        var i  = floor(v + dot(v, C.yy));
        let x0 = v - i + dot(i, C.xx);

        // ② 残り2頂点: マス内の上/下どちらの三角形かで 2 つ目の頂点 i1 が決まる。
        let i1 = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), x0.x > x0.y);
        let x1 = x0.xy + C.xx - i1;   // 2 つ目の頂点から自分への変位
        let x2 = x0.xy + C.zz;        // 3 つ目 (対角) の頂点から自分への変位

        // ③ 3 頂点それぞれの乱数インデックスを permute で作る。
        i = mod289v2(i);
        let p = permute(
          permute(i.y + vec3f(0.0, i1.y, 1.0))
            + i.x + vec3f(0.0, i1.x, 1.0));

        // ④ 重み m = max(0.5 - 距離², 0)。頂点から離れるほど 0 になる丸い窓。^4 で裾を締める。
        var m = max(0.5 - vec3f(dot(x0, x0), dot(x1, x1), dot(x2, x2)), vec3f(0.0));
        m = m * m;
        m = m * m;

        // 勾配: 乱数インデックス p を円周上の向き (a0, h) に展開する。
        let x  = 2.0 * fract(p * C.www) - 1.0;
        let h  = abs(x) - 0.5;
        let ox = floor(x + 0.5);
        let a0 = x - ox;

        // 勾配の長さを 1 に揃える代わりに、重み m 側を補正してまとめて正規化 (近似)。
        m = m * (1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h));

        // ⑤ 各頂点の寄与 = 勾配 · 変位。3 頂点ぶん重み m で足し、130 で正規化。
        var g = vec3f(0.0);
        g.x = a0.x * x0.x + h.x * x0.y;
        g.y = a0.y * x1.x + h.y * x1.y;
        g.z = a0.z * x2.x + h.z * x2.y;
        return 130.0 * dot(m, g);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        // GLSL は y が下から上。WebGPU は上から下なので反転して本と合わせる。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;
        st.x *= u.resolution.x / u.resolution.y; // 縦横比補正

        st *= 10.0; // ノイズが見えるよう空間を拡大

        // snoise は -1〜1。*0.5+0.5 で 0〜1 にして明るさにする。
        let n = snoise(st) * 0.5 + 0.5;

        return vec4f(vec3f(n), 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "simplex noise pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
  });

  const uniformBufferSize = 4 * 4; // 16 バイト
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

  const frame = (timeMs: number) => {
    render(device, timeMs * 0.001);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
