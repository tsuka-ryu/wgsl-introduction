// The Book of Shaders — 11 ノイズ: デジタル表示 (morphing hex glyph)
// https://thebookofshaders.com/11/?lan=jp  (Author @patriciogv - 2015)
//
// 11章の集大成デモのひとつ。画面いっぱいに「2列×6段の枡目」で組んだ
// デジタル文字 (16進ディスプレイ) を1文字だけ描き、時間で次々と morph させ、
// 上から 3D simplex noise の粒を散らして step で白黒に焼く。
// 結果はグリッチした電光掲示板／易の卦のような、明滅する記号。
//
// ── 部品を下から積む (denotational に読む) ─────────────────────────
//   shape(st,N) … 中心(.5,.5)から見た「正N角形の符号付き距離っぽい量」。
//                 atan2 で角度を測り、N分割した一番近い辺の向きへ cos で潰す。
//                 N=4 にすれば正方形 → box の素になる。
//   box(st,sz)  … shape(st*sz, 4)。st を size で割増しして正方形の枡を1個描く。
//   segment     … 1段の枡。bit が立っていれば「太い枡(size 1.0)」横ずらしなし、
//                 寝ていれば「細い枡(size 0.84)」。太/細の差が点灯/消灯に化ける。
//   hexBits     … st を (2,6) に拡大して 2列×6段に割り、x=1列目は左右ミラー、
//                 各段の bit に応じて segment を置く。6 bit = 1つの記号の形。
//   hexN(st,N)  … 数 N の下位 6bit を取り出して hexBits に渡す薄いラッパ。
//                 N を時間にすれば「数が1つ進むたびに別の記号」に化ける。
//
// ── 1ピクセル st でのトレース (fs の中身) ───────────────────────
//   t = time*0.5
//   df = mix( hexN(st, floor t), hexN(st, floor t +1), fract t )
//        … 整数 t と t+1 の2つの記号を、小数部でクロスフェード = なめらかな morph。
//   df += snoise(vec3(st*75, t*0.1)) * 0.03
//        … 高周波の 3D ノイズ粒を薄く足してエッジをザラつかせる (アナログな滲み)。
//   step(0.7, df) … 0/1 に二値化。閾値 0.7 で枡の中だけ白く抜ける。
//
// ── WGSL 移植メモ (GLSL との差) ───────────────────────────────
//   ・関数オーバーロード不可  → hex(...) を hexBits / hexN に名前分け。
//   ・GLSL mod は floor 版     → fmod(x,y)=x-y*floor(x/y) を自前で用意 (% は切捨て版)。
//   ・atan(x,y) → atan2(x,y)。bool 配列は array<bool,6> でそのまま渡せる。
//   ・GLSL は y が下から上 → 本と揃えるため st.y を反転。

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
    label: "book of shaders 11 - digital glyph",
    code: /* wgsl */ `
      const PI = 3.14159265359;
      const TWO_PI = 6.28318530718;

      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // GLSL の mod (floor 版)。WGSL の % は切り捨て版なので符号が合わない。
      fn fmod(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }

      // 中心(.5,.5)から見た正N角形の "距離っぽい量"。N=4 で正方形。
      fn shape(st0: vec2f, N: f32) -> f32 {
        let st = st0 * 2.0 - 1.0;            // 中心を原点へ。範囲 [-1,1]
        let a = atan2(st.x, st.y) + PI;      // 角度 (0..2π)
        let r = TWO_PI / N;                  // 1辺ぶんの角度
        return cos(floor(0.5 + a / r) * r - a) * length(st);
      }

      // st を size で割増しして正方形の枡を1個。
      fn box(st: vec2f, size: vec2f) -> f32 { return shape(st * size, 4.0); }

      // 2列×6段の枡目。bit が立つ段は太枡(点灯)、寝る段は細枡(消灯)。
      fn hexBits(st0: vec2f, b: array<bool, 6>) -> f32 {
        let st = st0 * vec2f(2.0, 6.0);
        var fpos = fract(st);
        let ipos = floor(st);

        if (ipos.x == 1.0) { fpos.x = 1.0 - fpos.x; }   // 右列は左右ミラー

        let row = i32(ipos.y);                          // 0..5 段
        var on = false;
        if (row >= 0 && row < 6) { on = b[row]; }

        if (on) {
          return box(fpos - vec2f(0.03, 0.0), vec2f(1.0));   // 太枡 = 点灯
        }
        return box(fpos, vec2f(0.84, 1.0));                  // 細枡 = 消灯
      }

      // 数 N の下位 6bit を取り出して hexBits へ。N を進めると記号が変わる。
      fn hexN(st: vec2f, N: f32) -> f32 {
        var b = array<bool, 6>(false, false, false, false, false, false);
        var remain = floor(fmod(N, 64.0));
        for (var i = 0; i < 6; i = i + 1) {
          b[i] = fmod(remain, 2.0) == 1.0;
          remain = ceil(remain / 2.0);
        }
        return hexBits(st, b);
      }

      // ── 3D simplex noise (random3 + snoise) ──────────────────────
      fn random3(c: vec3f) -> vec3f {
        var j = 4096.0 * sin(dot(c, vec3f(17.0, 59.4, 15.0)));
        var r = vec3f(0.0);
        r.z = fract(512.0 * j);
        j = j * 0.125;
        r.x = fract(512.0 * j);
        j = j * 0.125;
        r.y = fract(512.0 * j);
        return r - 0.5;
      }

      const F3 = 0.3333333;
      const G3 = 0.1666667;
      fn snoise(p: vec3f) -> f32 {
        let s = floor(p + dot(p, vec3f(F3)));
        let x = p - s + dot(s, vec3f(G3));

        let e = step(vec3f(0.0), x - x.yzx);
        let i1 = e * (1.0 - e.zxy);
        let i2 = 1.0 - e.zxy * (1.0 - e);

        let x1 = x - i1 + G3;
        let x2 = x - i2 + 2.0 * G3;
        let x3 = x - 1.0 + 3.0 * G3;

        var w = vec4f(dot(x, x), dot(x1, x1), dot(x2, x2), dot(x3, x3));
        w = max(0.6 - w, vec4f(0.0));

        var d = vec4f(
          dot(random3(s), x),
          dot(random3(s + i1), x1),
          dot(random3(s + i2), x2),
          dot(random3(s + 1.0), x3),
        );

        w = w * w;
        w = w * w;
        d = d * w;

        return dot(d, vec4f(52.0));
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        // GLSL は y が下から上。WebGPU は上から下なので反転して本と合わせる。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;
        st.y = st.y * (u.resolution.y / u.resolution.x);  // アスペクト補正

        let t = u.time * 0.5;

        // 整数 t と t+1 の2記号を小数部でクロスフェード = なめらかな morph。
        var df = mix(hexN(st, floor(t)), hexN(st, floor(t) + 1.0), fract(t));
        // 高周波ノイズ粒を薄く足してエッジをザラつかせる。
        df = df + snoise(vec3f(st * 75.0, t * 0.1)) * 0.03;

        let color = mix(vec3f(0.0), vec3f(1.0), step(0.7, df));
        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "digital glyph pipeline",
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
