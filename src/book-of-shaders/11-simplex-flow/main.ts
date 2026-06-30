// The Book of Shaders — 11 ノイズ: simplex noise で流れる模様 (domain warp)
// https://thebookofshaders.com/11/?lan=jp  (Author @patriciogv - 2015)
//
// 前回 (11-simplex-noise) で作った snoise は「素材」。この回はそれを使って "流れる" 模様を描く。
// 主役は domain warping (定義域ゆがめ): ノイズに座標を渡す前に、その座標を「別のノイズが
// 決めた向き」へずらす。まっすぐ足すと同心円的な縞だが、ずらす向きを場所ごとに変えると
// 縞がうねって流体・大理石のように見える。少ない部品で複雑さを生む 11 章の総決算的な技。
//
// ── 1ピクセル st でのトレース (denotational に) ───────────────────────────────
//   pos = st * 3                      … 画面を 3 マスぶんに拡大した座標。
//   DF  = 0                           … 縞のもとになる累積場 (density field)。
//   1枚目: vel = (time*.1, time*.1)    … 全体を斜めにスクロールさせる平行移動。
//          DF += snoise(pos+vel)*.25+.25   … snoise(-1〜1) を 0〜0.5 に畳んで足す。
//   2枚目: a   = snoise(pos · 回転スケール) * π  … 「ずらす向き」を別のゆっくり回る noise から取る。
//          vel = (cos a, sin a)            … その向きの単位ベクトル = warp の方向。
//          DF += snoise(pos+vel)*.25+.25   … pos を vel ぶんずらして 2 枚目を足す → DF ≒ 0〜1。
//   fract(DF)                         … はみ出しを巻き戻し 0〜1 の縞に。
//   smoothstep(.7,.75, …)             … 0.70〜0.75 の細い帯だけ 1 → 細い輪郭線が浮かぶ。
//   1.0 - color                       … 白地に黒線へ反転 (本のスクショに合わせる)。
//
// 11-simplex-noise との違いは snoise の "使い方" だけ。snoise 本体は同じものを再掲している。
// GLSL→WGSL の差は 2 点: 三項 a?b:c → select(c,b,a) / 同名 mod289 多重定義不可 → v2/v3 に分割。

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
    label: "book of shaders 11 - simplex flow (domain warp)",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // permute のための剰余 (乱数ハッシュが大きくなりすぎて精度落ちするのを防ぐ周期処理)。
      fn mod289v3(x: vec3f) -> vec3f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      fn mod289v2(x: vec2f) -> vec2f { return x - floor(x * (1.0 / 289.0)) * 289.0; }

      // 整数の頂点インデックス → 擬似乱数 (各頂点に割り当てる勾配の "種")。
      fn permute(x: vec3f) -> vec3f { return mod289v3(((x * 34.0) + 1.0) * x); }

      // 2D simplex noise 本体 (11-simplex-noise と同じ。およそ -1〜1 を返す)。
      fn snoise(v: vec2f) -> f32 {
        let C = vec4f(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);

        var i  = floor(v + dot(v, C.yy));
        let x0 = v - i + dot(i, C.xx);

        let i1 = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), x0.x > x0.y);
        let x1 = x0.xy + C.xx - i1;
        let x2 = x0.xy + C.zz;

        i = mod289v2(i);
        let p = permute(
          permute(i.y + vec3f(0.0, i1.y, 1.0))
            + i.x + vec3f(0.0, i1.x, 1.0));

        var m = max(0.5 - vec3f(dot(x0, x0), dot(x1, x1), dot(x2, x2)), vec3f(0.0));
        m = m * m;
        m = m * m;

        let x  = 2.0 * fract(p * C.www) - 1.0;
        let h  = abs(x) - 0.5;
        let ox = floor(x + 0.5);
        let a0 = x - ox;
        m = m * (1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h));

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
        st.x *= u.resolution.x / u.resolution.y;  // 画面が正方形なら 1 倍 (縦横比補正)

        let pos = st * 3.0;

        // ── 実験用に組んである: 下の各行は 1 行ずつコメントアウトしても必ず動く ──
        // vel と DF と d を先に宣言しておくので、どの段を消しても他が壊れない。
        var DF  = 0.0;            // 縞のもとになる累積場 (density field)
        var vel = vec2f(0.0);     // warp の向き (ここでは 0 = ずらさない)

        // 【1枚目】全体を斜めにスクロール。
        //   ↓ 2 行ごとコメントアウト → 流れが片方だけになる。
        vel = vec2f(u.time * 0.1);
        DF += snoise(pos + vel) * 0.25 + 0.25;

        // 【2枚目 = domain warp】ずらす向き a を別の (ゆっくり回る) noise から決める。
        //   ↓ a と vel の 2 行を消す → vel が 1枚目のまま = ただの平行な2枚重ね (うねりが消える)。
        let a = snoise(pos * vec2f(cos(u.time * 0.15), sin(u.time * 0.1)) * 0.1) * 3.1415;
        vel = vec2f(cos(a), sin(a));
        DF += snoise(pos + vel) * 0.25 + 0.25;

        // 【仕上げ】各行を 1 行ずつ消すと、その工程が何をしていたか分かる。
        var d = DF;
        d = fract(d);                  // ← 消す: 縞 (繰り返し) が消えて なめらかな濃淡に
        d = smoothstep(0.7, 0.75, d);  // ← 消す: 細い線でなく ベタ塗りの濃淡に
        var color = vec3f(d);
        color = 1.0 - color;           // ← 消す: 白地に黒線 → 黒地に白線へ反転前
        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "simplex flow pipeline",
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
