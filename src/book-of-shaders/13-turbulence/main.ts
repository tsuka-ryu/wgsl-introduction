// The Book of Shaders — 13 fBm: 乱流 (Turbulence)
// https://thebookofshaders.com/13/?lan=jp
// お手本 (patriciogv 2015 "Turbulence") をそのまま WGSL へ移植したもの。
// 2D simplex noise は 11-simplex-noise と同じ Ian McEwan / Ashima Arts (MIT)。
//
// ── 13-fbm (ふつうの fBm) との違いは、たった一箇所 abs() だけ ────────────
//   13-fbm:      value += amplitude * noise(st);          // noise は 0〜1 の value noise
//   turbulence:  value += amplitude * abs(snoise(st));    // snoise は -1〜1、その絶対値
//
//   snoise は 0 を挟んで正負に振れる (-1〜1)。その絶対値をとると、
//     ・0 だった所 (= ノイズの等高線 noise=0 の谷筋) が「値 0 の鋭い谷」になり、
//     ・V 字に折り返されるので、そこに微分不連続な「折れ目 (ridge)」が生まれる。
//   これを周波数を上げながら積むと、折れ目の上にさらに細かい折れ目が乗る。
//   結果、なめらかな雲だった fBm が、煙・炎・大理石の脈のような "筋の入った渦" になる。
//   これが turbulence (乱流) と呼ばれる所以。折り目が乱流の渦筋を思わせる。
//
// ── 積み方 (fBm と同じ octave の和) ──────────────────────────────
//   turbulence(x) = Σ_{i=0}^{N} g^i · |snoise(l^i · x)|      g=gain=0.5, l=lacunarity=2
//   for ループの中身がまさにこれ (お手本は OCTAVES=3):
//       value     += amplitude * abs(snoise(st));  // 今の層の「折り返しノイズ」を足す
//       st        *= 2.0;                           // 次の層は 2 倍細かい周波数で
//       amplitude *= 0.5;                           // 次の層は半分の振幅で
//   ※ abs() で常に非負を足すので、和はどんどん正に積み上がる。value noise 版のように
//     0.5 を中心に上下するのではなく、谷 (=0) から明るく盛り上がる濃淡になる。
//
// 1ピクセル st のトレース (OCTAVES=3):
//   |snoise(st)|        … 一番粗い折れ目。大きな渦筋 (谷が 0、離れるほど明るい) を振幅 0.5 で
//   |snoise(2·st)|      … 半分のサイズの折れ目を 0.25 で重ね、渦筋を枝分かれさせる
//   |snoise(4·st)|      … さらに半分の折れ目を 0.125 で重ね、細かいほつれを足す
//   → 3 枚重ねると、太い渦筋に細い筋が絡んだ煙状の白い濃淡になる。

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
    label: "book of shaders 13 - turbulence",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const OCTAVES = 3;

      // ── 2D simplex noise (11-simplex-noise と同一。戻り値はおよそ -1〜1) ──────
      // permute のための剰余。WGSL は同名多重定義不可なので vec3/vec2 を分ける。
      fn mod289v3(x: vec3f) -> vec3f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      fn mod289v2(x: vec2f) -> vec2f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      fn permute(x: vec3f) -> vec3f { return mod289v3(((x * 34.0) + 1.0) * x); }

      fn snoise(v: vec2f) -> f32 {
        // 三角格子の定数。C.x=(3-√3)/6, C.y=(√3-1)/2 (skew量), C.z=-1+2*C.x, C.w=1/41。
        let C = vec4f(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);

        // ① 第1頂点: skew して三角マスの基準点 i を求め、そこからの変位 x0 を出す。
        var i  = floor(v + dot(v, C.yy));
        let x0 = v - i + dot(i, C.xx);

        // ② 残り2頂点: マス内の上/下どちらの三角形かで 2 つ目の頂点 i1 が決まる。
        let i1 = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), x0.x > x0.y);
        let x1 = x0.xy + C.xx - i1;
        let x2 = x0.xy + C.zz;

        // ③ 3 頂点の乱数インデックスを permute で作る。
        i = mod289v2(i);
        let p = permute(
          permute(i.y + vec3f(0.0, i1.y, 1.0))
            + i.x + vec3f(0.0, i1.x, 1.0));

        // ④ 重み m = max(0.5 - 距離², 0)⁴。頂点から離れるほど 0 になる丸い窓。
        var m = max(0.5 - vec3f(dot(x0, x0), dot(x1, x1), dot(x2, x2)), vec3f(0.0));
        m = m * m;
        m = m * m;

        // 勾配を円周上の向き (a0, h) に展開し、長さを重み側で近似正規化。
        let x  = 2.0 * fract(p * C.www) - 1.0;
        let h  = abs(x) - 0.5;
        let ox = floor(x + 0.5);
        let a0 = x - ox;
        m = m * (1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h));

        // ⑤ 各頂点の寄与 = 勾配 · 変位。重み m で足し、130 で正規化。
        var g = vec3f(0.0);
        g.x = a0.x * x0.x + h.x * x0.y;
        g.y = a0.y * x1.x + h.y * x1.y;
        g.z = a0.z * x2.x + h.z * x2.y;
        return 130.0 * dot(m, g);
      }

      // 乱流本体: |snoise| を octave 積む。abs() の折り返しが渦筋を生むのが肝。
      fn turbulence(p: vec2f) -> f32 {
        var value = 0.0;
        var amplitude = 0.5;
        var st = p; // ループで座標を破壊するのでコピー
        for (var i = 0; i < OCTAVES; i = i + 1) {
          value += amplitude * abs(snoise(st)); // 谷 0・離れるほど明るい折り返しノイズ
          st *= 2.0;        // lacunarity=2: 次の層は 2 倍細かく
          amplitude *= 0.5; // gain=0.5:      次の層は半分の振幅
        }
        return value;
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        // GLSL は y が下から上。WebGPU は上から下なので反転して本と合わせる。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        // アスペクト比補正 (本の st.x *= u_resolution.x/u_resolution.y に相当)
        st.x *= u.resolution.x / u.resolution.y;

        // st*3.0 で座標系を3倍に拡大 → 一番粗い層の渦筋が画面に数個ぶん見える
        let color = vec3f(turbulence(st * 3.0));

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "turbulence pipeline",
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
