// The Book of Shaders — 11 ノイズ: アルゴリズム版ポロック (Jackson Pollock / drip painting)
// https://thebookofshaders.com/11/?lan=jp
//
// これまでの 11章の道具 (gradient noise / fbm / domain warp / 等高線 / 飛沫) を全部まとめて
// 抽象表現主義のドリップペインティングを生成する応用編。新しい数学はひとつも無く、既出の
// 部品の "合成" だけで絵にする。
//
// ── ポロックの絵を関数として読み解く ───────────────────────────────────────
// ドリップ画は要素が2種類しかない:
//   (A) うねうね絡まった線 (絵具を垂らした軌跡)
//   (B) ばらまかれた点  (飛び散った飛沫)
// この2つを「白い紙に黒を重ねる」だけで作る。色は紙=生成りの白、絵具=ほぼ黒。
//
// ── (A) 1本のドリップ線 = "歪めた fbm 場の等高線" ──────────────────────────
// noise/fbm は「各点にスカラー値を返す場 (距離場)」。その "ある高さ" の点の集合 = 等高線は、
// 平面の上を蛇行する1本の曲線になる (11-noise-contour でやった level set)。これがドリップ線の正体。
//   1. domain warp:  自分の座標を fbm の流れに沿ってずらす。まっすぐ評価されるはずだった
//      等高線が場所ごとに違う向きへ流され、有機的に蛇行する (11-wood / 11-splatter と同じ手)。
//   2. 等高線抽出:  field = fbm(warped座標)。|field - level| が小さい点だけが線の上。
//      fwidth(field) (= 画面1pxあたりの場の変化 = 勾配) で割ると、傾斜によらず線幅を画面上一定に保てる。
//   3. 太さ変調:  線幅 wpix を別の低周波ノイズで揺らす。太い所(絵具がたまった)・細い所・
//      幅が 0 以下に落ちる切れ目(かすれ) ができ、垂らした絵具のムラが出る。
// この「1本」をレイヤーごとに別シード・別 level・別周波数で何枚も重ねると、線が交差して絡まる。
//
// ── (B) 飛沫 = 格子の一部セルに置いた乱数半径の円 ──────────────────────────
// 画面を格子に切り (10章 mosaic と同じ floor)、各セルで random を引いて「滴を置くか」を確率で決め、
// 置くセルにはランダムな中心・半径の円を smoothstep で描く。格子の大きさを変えて数スケール重ね、
// 大粒〜細かい霧まで散らす。
//
// ── 1ピクセル st でのトレース (denotational に) ────────────────────────────
//   color = 紙の生成り色
//   for 各ドリップレイヤー k:  color = mix(color, 黒っぽい絵具, dripLayer(...のインク量))
//   for 各飛沫スケール s:      color = mix(color, 黒, splatter(...の被覆量))
// 後に重ねた絵具ほど上に乗る (mix の手前優先)。time でノイズ空間をごくゆっくり流すと、絡まりが
// 生き物のようにうねって "描かれ続ける" ポロックになる (t=0.0 にすれば静止した一枚の絵)。

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
    label: "book of shaders 11 - algorithmic pollock",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 座標 → 0〜1 の乱数 (飛沫のセル抽選・各レイヤーの個性決めに使う)。
      fn random(st: vec2f) -> f32 {
        return fract(sin(dot(st, vec2f(12.9898, 78.233))) * 43758.5453123);
      }

      // 格子点 → ランダムな 2D ベクトル (-1〜1)。勾配ノイズの "斜面の向き" / 飛沫の中心オフセット。
      fn random2(p: vec2f) -> vec2f {
        let s = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
        return -1.0 + 2.0 * fract(sin(s) * 43758.5453123);
      }

      // Gradient Noise by Inigo Quilez - iq/2013。4隅で dot(勾配, 隅→自分) を双線形補間。戻り値 -1〜1。
      fn noise(st: vec2f) -> f32 {
        let i = floor(st);
        let f = fract(st);
        let w = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(dot(random2(i + vec2f(0.0, 0.0)), f - vec2f(0.0, 0.0)),
              dot(random2(i + vec2f(1.0, 0.0)), f - vec2f(1.0, 0.0)), w.x),
          mix(dot(random2(i + vec2f(0.0, 1.0)), f - vec2f(0.0, 1.0)),
              dot(random2(i + vec2f(1.0, 1.0)), f - vec2f(1.0, 1.0)), w.x),
          w.y
        );
      }

      // fbm: noise を周波数2倍・振幅半分で 5 段重ねた "起伏のある地形"。戻り値はおよそ -1〜1。
      // 大きなうねりに細かいギザギザが乗り、ドリップの蛇行に自然なゆらぎを与える。
      fn fbm(p0: vec2f) -> f32 {
        var p = p0;
        var sum = 0.0;
        var amp = 0.5;
        for (var i = 0; i < 5; i = i + 1) {
          sum = sum + amp * noise(p);
          p = p * 2.0;
          amp = amp * 0.5;
        }
        return sum;
      }

      // (A) ドリップ線 1本ぶんのインク量 (0〜1) を返す。
      //   seed  … このレイヤーの個性 (場をずらす種)。level … 引き出す等高線の高さ。
      //   freq  … 線の細かさ。baseW … 基本の線幅(px)。
      fn dripLayer(st: vec2f, seed: vec2f, freq: f32, level: f32, baseW: f32) -> f32 {
        // 1. domain warp: 自分を fbm の流れに沿ってずらす → 等高線が蛇行する。
        let warp = vec2f(fbm(st * 0.8 + seed), fbm(st * 0.8 + seed + 5.2));
        let field = fbm(st * freq + warp * 1.6 + seed);

        // 3. 太さ変調: 低周波ノイズで線幅を揺らす。0以下に落ちた所は線が消える=かすれ・途切れ。
        let wmod = fbm(st * 1.3 + seed * 0.7);          // -1〜1
        let wpix = baseW * max(0.0, 0.55 + 1.3 * wmod); // たまに 0 → 線が切れる

        // 2. 等高線抽出: field==level までの画面上の距離(px)。fwidthで勾配を割り線幅を一定に。
        let d = abs(field - level);
        let dpix = d / max(fwidth(field), 1e-5);
        return smoothstep(wpix, wpix - 1.5, dpix);
      }

      // (B) 飛沫 1スケールぶんの被覆量 (0〜1)。格子に切り、一部セルに乱数半径の円を置く。
      fn splatter(st: vec2f, cellsPerUnit: f32, seed: f32, density: f32, maxR: f32) -> f32 {
        let cells = st * cellsPerUnit + seed;
        let id = floor(cells);
        let f = fract(cells);
        // このセルに滴を置くか? density より小さいセルだけ採用。
        let keep = step(random(id + seed), density);
        // 中心はセル内をランダムに、半径もランダム (小さい滴〜大きい滴)。
        let center = vec2f(0.5) + 0.32 * random2(id + 1.7);
        let r = maxR * (0.25 + 0.75 * random(id + 3.3));
        let disk = 1.0 - smoothstep(r * 0.6, r, length(f - center));
        return keep * disk;
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

        // ノイズを引く座標。time でごくゆっくり流すと絡まりがうねって描かれ続ける (0.0で静止画)。
        let drift = vec2f(u.time * 0.018, u.time * -0.012);
        let p = st * 3.2;

        // 紙: 生成りの白 (キャンバス地)。
        var color = vec3f(0.93, 0.91, 0.85);

        // ── (A) ドリップ線を何本も重ねる ──
        // 後の k ほど手前に乗る (mix の手前優先)。奥は細く薄いグレー、手前は太く黒、で奥行きを出す。
        const LAYERS = 11;
        for (var k = 0; k < LAYERS; k = k + 1) {
          let fk = f32(k);
          let seed = vec2f(fk * 13.7, fk * 7.3 + 4.1) + drift;
          let freq = 2.2 + fk * 0.35;                       // 奥のレイヤーほど細かい線
          let level = (random(vec2f(fk, 1.0)) - 0.5) * 0.9; // 引き出す等高線の高さをばらす
          let baseW = max(1.6, 4.6 - fk * 0.22);            // 手前ほど太い
          let ink = dripLayer(p, seed, freq, level, baseW);
          // 絵具色: ほぼ黒。たまに濃いセピア/グレーを混ぜて単調さを消す。
          let warm = random(vec2f(fk, 9.0));
          let tone = mix(vec3f(0.04, 0.035, 0.03), vec3f(0.16, 0.14, 0.12), warm);
          color = mix(color, tone, ink);
        }

        // ── (B) 飛沫を数スケール重ねる ── 大粒→中粒→細かい霧。
        let ink2 = vec3f(0.05, 0.045, 0.04);
        color = mix(color, ink2, splatter(p, 5.0,  0.0, 0.18, 0.22)); // 大粒(まれ)
        color = mix(color, ink2, splatter(p, 11.0, 2.0, 0.16, 0.30)); // 中粒
        color = mix(color, ink2, splatter(p, 23.0, 5.0, 0.12, 0.40)); // 細かい霧

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "pollock pipeline",
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
