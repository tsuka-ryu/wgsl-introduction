// The Book of Shaders — 13 Ridged multifractal (Ridge / 稜線を立てる fBm)
// https://thebookofshaders.com/13/?lan=jp
//
// お手本 (patriciogv 2015 "Ridge") をそのまま WGSL へ移植したもの。
// 土台は 13-fbm と同じ「周波数を上げ・振幅を下げながら noise を積む」和。
// 違うのは ① 素材が value noise ではなく simplex noise(snoise, 11章) であること、
// ② 各層をそのまま足すのではなく ridge() という「折り返し」を1枚かませること。
//
// ── ridge() = 絶対値の折り返しで谷を尖った稜線に変える ─────────────
//   fn ridge(h, offset):
//       h = abs(h);      // ①谷底(負)を正へ折り返す → 0 で鋭い V 字の折れ目ができる
//       h = offset - h;  // ②上下反転 → さっきの折れ目が「山の頂上」に来る(offsetは頂の高さ)
//       h = h * h;       // ③二乗で頂をさらに尖らせ、裾を寝かせる
//       return h;
//   つまり ridge = square ∘ (offset −) ∘ abs。noise の値域 [-1,1] を
//   「頂点で折れて尖った尾根」の形に写す純関数。これを噛ませるだけで、
//   fBm のもやっとした雲が、鋭いリッジ(山の稜線/川の浸食跡)に化ける。
//   |x| は微分不能点(折れ目)を持つ関数。その折れ目こそが稜線の芯になる。
//
// ── ridgedMF() = ridge を噛ませた fBm。ただし「前の層で重み付け」する ──
//   通常 fBm:      sum += amp · noise(freq·p)
//   ridged 版:    n = ridge(noise(freq·p));
//                 sum += n·amp;          // 素の寄与
//                 sum += n·amp·prev;     // ★一つ粗い層の値 prev で変調して足す
//                 prev = n;              // 次の層のための記憶
//   prev(=一つ上の octave の ridge 値)を掛けることで、
//   「粗い尾根がある所ほど細かい尾根も強く出る」= detail が地形に張り付く。
//   谷(prev≈0)では細部が抑えられ、尾根(prev大)では細部が盛られる → 侵食地形らしさ。
//   これは各層が独立(単なる和)だった素の fBm を、層どうしが掛け算で絡む
//   multi-fractal(場所ごとに次元/粗さが変わるフラクタル)にする一手。
//   ※ prev の初期値は 1.0。第0層だけは prev 変調ぶんが素の寄与と同量になる(お手本のまま)。
//
// 1ピクセル st のトレース (OCTAVES=4, offset=0.9):
//   snoise(3·st)      … 一番粗い simplex。ridge で尖らせ、大きな尾根の骨格に(振幅0.5)
//   snoise(6·st)      … 半分サイズの尾根を、粗い層 prev で重み付けして 0.25 で重ねる
//   snoise(12·st)     … さらに細かい皺を、その上の層で重み付けして 0.125 で …
//   … 4枚で、大きな山塊の稜線に沿って細かいひび割れが走る白い地形図のような濃淡になる。

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
    label: "book of shaders 13 - ridged multifractal",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const OCTAVES = 4;

      // ── simplex noise 一式 (11-simplex-noise と同じ、Ian McEwan / Ashima Arts) ──
      // GLSL は mod289 を vec3/vec2 でオーバーロードするが、WGSL は同名多重定義不可なので分ける。
      fn mod289v3(x: vec3f) -> vec3f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      fn mod289v2(x: vec2f) -> vec2f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      fn permute(x: vec3f) -> vec3f { return mod289v3(((x * 34.0) + 1.0) * x); }

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

      // ── Ridged multifractal 本体 ──
      // ridge = square ∘ (offset −) ∘ abs。谷を折り返して尖った尾根に変える純関数。
      // "Texturing & Modeling, A Procedural Approach", Ch.12 由来。
      fn ridge(h0: f32, offset: f32) -> f32 {
        var h = abs(h0);   // 谷(負)を折り返す → 0 に鋭い折れ目
        h = offset - h;    // 反転して折れ目を頂上へ
        return h * h;      // 尖らせる
      }

      fn ridgedMF(p0: vec2f) -> f32 {
        let lacunarity = 2.0; // 次の層は周波数 2 倍
        let gain = 0.5;       // 次の層は振幅 0.5 倍
        let offset = 0.9;     // 尾根の頂の高さ

        var sum = 0.0;
        var freq = 1.0;
        var amp = 0.5;
        var prev = 1.0;       // 一つ粗い層の ridge 値の記憶。初期 1.0 (お手本準拠)
        for (var i = 0; i < OCTAVES; i = i + 1) {
          let n = ridge(snoise(p0 * freq), offset);
          sum += n * amp;         // 素の寄与
          sum += n * amp * prev;  // 一つ粗い層で変調した寄与 → detail が地形に張り付く
          prev = n;               // 次の層のために覚える
          freq *= lacunarity;
          amp *= gain;
        }
        return sum;
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

        // st*3.0 で座標系を3倍に拡大 → 一番粗い尾根が画面に数本ぶん見える
        let color = vec3f(ridgedMF(st * 3.0));

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "ridged multifractal pipeline",
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
