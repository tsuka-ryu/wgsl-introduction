// The Book of Shaders — 11 ノイズ: ロスコ風カラーフィールド
// https://thebookofshaders.com/11/?lan=jp
//
// 練習: 「四角形・色・ノイズを組み合わせて、ロスコの絵画のような複雑な表情の作品を」。
//
// ロスコ (Mark Rothko) の色面絵画の特徴を、シェーダの語彙に翻訳すると:
//   ① 数枚の大きな矩形が縦に並ぶ          → softRect (柔らかい四角形マスク) を重ねる
//   ② 縁がにじんで背景へ溶ける            → 矩形の縁を smoothstep でぼかし、さらに座標を
//                                            ノイズで歪める (domain warp) ので輪郭が揺らぐ
//   ③ 面の中が均一でなく光が滲む          → 色を fbm で乗算ムラにして単調な塗りを避ける
//   ④ 絵全体が呼吸するような深み          → 背景も fbm で濃淡をつけ、極小の time でゆらす
//
// このシェーダ全体を denotational に読むと「奥→手前へ色面を塗り重ねた合成」:
//   image(p) = 背景色 から始め、各色面について color = mix(color, 面の色(p), 面の被覆率(p))
//   ・被覆率(p) = ノイズで歪めた座標で測った「柔らかい矩形の内側らしさ」0〜1
//   ・面の色(p) = 基準色 × fbm によるムラ
//   mix を奥から順に重ねる = 画家が下の層の上に次の層を("透けるように")置くのと同じ。
//
// ノイズの使いどころは2か所だけ:
//   ・座標を歪める (warp)   → 縁が直線でなく手描き・絵具のにじみになる
//   ・色を変調する (mottle) → 面の中に光のムラが出て"平塗り"に見えなくなる

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
    label: "book of shaders 11 - rothko color field",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      fn random(st: vec2f) -> f32 {
        return fract(sin(dot(st, vec2f(12.9898, 78.233))) * 43758.5453123);
      }

      // 2D value noise (11-noise-2d と同じ)。
      fn noise(st: vec2f) -> f32 {
        let i = floor(st);
        let f = fract(st);
        let a = random(i);
        let b = random(i + vec2f(1.0, 0.0));
        let c = random(i + vec2f(0.0, 1.0));
        let d = random(i + vec2f(1.0, 1.0));
        let w = f * f * (3.0 - 2.0 * f);
        return mix(a, b, w.x) + (c - a) * w.y * (1.0 - w.x) + (d - b) * w.x * w.y;
      }

      // fbm: 粗いノイズに細かいノイズを重ねて自然な質感に (13章の先取り)。
      // 大きいうねり + 半分の細かさ + さらに半分 ... を振幅半減で足す。
      fn fbm(p: vec2f) -> f32 {
        var v = 0.0;
        var amp = 0.5;
        var freq = p;
        for (var i = 0; i < 5; i++) {
          v += amp * noise(freq);
          freq *= 2.0;
          amp *= 0.5;
        }
        return v;
      }

      // 柔らかい矩形: 中心 c・半サイズ h の四角形の「内側らしさ」を 0〜1 で返す。
      // 各軸 smoothstep で縁を feather ぶんぼかす。x と y の積で角丸の柔らかい矩形に。
      fn softRect(st: vec2f, c: vec2f, h: vec2f, feather: f32) -> f32 {
        let p = abs(st - c);
        let fx = smoothstep(h.x + feather, h.x - feather, p.x);
        let fy = smoothstep(h.y + feather, h.y - feather, p.y);
        return fx * fy;
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        let t = u.time * 0.03; // ごく僅かに呼吸させる

        // ── 縁のにじみ: 座標をノイズで歪める (domain warp) ──
        // x,y それぞれ別の種で fbm を引き -0.5 で上下対称に。これを座標に足すと
        // 直線の縁がゆらいで絵具のにじみになる。歪み量 0.05 はキャンバス幅基準。
        let warp = vec2f(
          fbm(st * 3.0 + vec2f(0.0, t)),
          fbm(st * 3.0 + vec2f(5.2, 1.3 + t))
        ) - vec2f(0.5);
        let w = st + warp * 0.05;

        // ── 背景: 深い臙脂(えんじ)。fbm で濃淡をつけ平坦さを消す ──
        let bgN = fbm(st * 2.0 + vec2f(t));
        var color = mix(vec3f(0.26, 0.05, 0.03), vec3f(0.42, 0.10, 0.05), bgN);

        // ── 色面を奥から手前へ塗り重ねる ──
        // 各面: 歪めた座標 w で被覆率を測り、基準色を fbm ムラで変調して mix。
        // 参考画像に寄せて 左=明るい赤 / 中=暗い深紅 / 右=クリーム。

        // 左: 明るい赤
        {
          let mask = softRect(w, vec2f(0.21, 0.50), vec2f(0.135, 0.40), 0.05);
          let mottle = fbm(st * 4.0 + vec2f(11.0, 2.0 + t));
          let col = vec3f(0.82, 0.13, 0.08) * (0.7 + 0.55 * mottle);
          color = mix(color, col, mask);
        }
        // 中央: 暗い深紅
        {
          let mask = softRect(w, vec2f(0.50, 0.50), vec2f(0.150, 0.40), 0.05);
          let mottle = fbm(st * 4.0 + vec2f(3.0, 19.0 + t));
          let col = vec3f(0.52, 0.04, 0.05) * (0.7 + 0.55 * mottle);
          color = mix(color, col, mask);
        }
        // 右: クリーム
        {
          let mask = softRect(w, vec2f(0.80, 0.50), vec2f(0.120, 0.40), 0.05);
          let mottle = fbm(st * 4.0 + vec2f(27.0, 7.0 + t));
          let col = vec3f(0.86, 0.80, 0.55) * (0.78 + 0.40 * mottle);
          color = mix(color, col, mask);
        }

        // 軽いビネット: 四隅を落として絵画的な視線誘導。
        let vig = smoothstep(1.1, 0.3, length(st - vec2f(0.5)));
        color *= 0.85 + 0.15 * vig;

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "rothko pipeline",
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