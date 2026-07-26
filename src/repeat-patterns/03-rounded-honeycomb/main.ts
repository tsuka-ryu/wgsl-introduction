// 平面リピートパターン — 03 鏡映 + 平行映進 (角丸ハニカム)
// 参考: 幾何学パターンの本 3.4「鏡映 + 平行映進」
//
// ── 骨格は 02 の使い回し、そこに距離場を載せる ────────────
//   格子は 02 とまったく同じ (せん断 + 列ごとの鏡映で平行四辺形のセルを作る)。
//   違いは、セルをベタで塗る代わりに「セルの中の距離場」を作って角を丸め、
//   縮んだ分を地 (白) で埋めたこと。02 は分割だったのでアンチエイリアスが効かなかったが、
//   距離場を持たせた瞬間に効くようになる = 分割 と 形 は行き来できる。
//
// ── 角丸の作り方: 縮めて → 太らせる ────────────────────────
//   「距離場から定数を引く = その距離だけ外へ膨らむ」。尖った角を膨らませると、角は
//   その頂点を中心とする円弧になる。だから ROUND ぶん痩せた図形を作って - ROUND すれば、
//   元の大きさのまま角だけ半径 ROUND の円弧になる。
//   ★ただし太らせる前の距離場が、角の外側で「頂点までの距離」になっている必要がある。
//     max(d1, d2) のままだとそこが辺の距離なので、いくら太らせても角が円弧にならない。
//
// ── 非直交な2辺の頂点距離 ─────────────────────────────────
//   セルは「縦の帯」と「斜めの帯」の交差。2辺が直交していないので roundedBox の
//   length(max(q, 0)) が使えない。法線の内積 cs から
//     |p - 頂点| = sqrt(d1² + d2² - 2·cs·d1·d2) / sqrt(1 - cs²)
//   で復元する (直交 cs=0 なら length(max(q,0)) に退化する一般化)。
//   ★切り替え条件は「両方正」ではなく法線コーンの中 (d1 > cs·d2 && d2 > cs·d1)。
//     両方正で切り替えると境界で値が飛び、輪郭に折れ目が出る。
//
// ── ★また対称操作は名前ほど実装に入っていない (02 に続き2回目) ──
//   実装に入ったのは 鏡映 (lx = 1 - lx) と 並進 だけ。「平行映進」は 02 と同じく
//   色の並び (k = (col + 2*row) % 4 の「列ごとに半周期ずらす」) に吸収されている。
//   しかも4色とも違う色なので、色を保つ操作は並進だけ = 色込みの対称群は p1。
//   → 本の分類はモチーフ配置 (骨格) の話で、塗り分けると必ず p1 に落ちる、が2例目。
//
// ── fwidth が使えない ─────────────────────────────────────
//   d はセルごとの距離場なのでセル境界で値が飛ぶ。fwidth はそこで傾きを誤検出して
//   aa が暴れ、地の白にゴミが乗る。st の作り方は分かっているので aa は自前で計算する。

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
    label: "repeat-patterns 03 - rounded honeycomb",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // ここは 02 と同じ骨格から再スタート (せん断 + 列ごとの鏡映で菱形の格子を作る)
      const COLS: f32 = 20.0;    // 画面に並ぶ列の数
      const ROWS: f32 = 20.0;    // 画面に並ぶ段の数
      const SLOPE: f32 = 0.4;   // 1列進む間に上がる段数。小さいほど角度が寝る

      const C0: vec3f = vec3f(0.874, 0.878, 0.863);   // 灰
      const C1: vec3f = vec3f(0.118, 0.357, 0.557);   // 青
      const C2: vec3f = vec3f(0.482, 0.498, 0.776);   // 紫
      const C3: vec3f = vec3f(0.910, 0.271, 0.184);   // 赤
      const BG: vec3f = vec3f(1.0);                   // 地 (白)。角丸で空いた所を埋める

      const GAP: f32 = 0.01;    // セルの縁からの余白 (0 なら丸めた角だけ白が覗く)
      const ROUND: f32 = 0.27;   // 角の丸み (最大 0.5)

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        let res = u.resolution;
        let st = position.xy / min(res.x,res.y) * vec2f(COLS, ROWS);

        let col = floor(st.x);        // 何列目か
        var lx = fract(st.x);         // 列の中のどこか (0〜1)
        // 奇数列だけ左右反転 = 縦の軸での鏡映。せん断の向きが裏返って ＼ が ／ になる
        if (col % 2.0 == 1.0) {lx = 1.0 - lx;}
        // y に lx を足すと境界線が斜めになる (せん断)。同じ floor でも線が傾く
        let row = floor(st.y + SLOPE * lx);

        let k = (col + 2.0 * row) % 4.0;

        var c = C0;
        if (k == 1.0) { c = C1; }
        if (k == 2.0) { c = C2; }
        if (k == 3.0) { c = C3; }

        let u = lx - 0.5;                        // 縦の帯の中の位置
        let v = fract(st.y + SLOPE * lx) - 0.5;  // 斜めの帯の中の位置 (y で測った値)
        let inv = 1.0 / sqrt(1.0 + SLOPE * SLOPE);

        // 各辺までの符号付き距離 (外が正)。ROUND ぶん内側に縮めておく
        let d1 = abs(u) - (0.5 - GAP) + ROUND;
        let d2 = (abs(v) - (0.5 - GAP)) * inv + ROUND;

        // 2辺の法線のなす角。abs で折り返した象限によって符号が変わる
        let cs = SLOPE * inv * sign(u) * sign(v);
        let sn = sqrt(max(1.0 - cs * cs, 1e-6));

        var dd = max(d1, d2);
        if (d1 > cs * d2 && d2 > cs * d1) {
          dd = sqrt(d1 * d1 + d2 * d2 - 2.0 * cs * d1 * d2) / sn;
        }
        let d = dd - ROUND;   // 太らせる = 半径 ROUND の円弧で角が丸まる

        // 1ピクセルが st 単位でどれだけか。その半分を境界の前後に振ると遷移がちょうど1px
        let aa = 0.5 * max(COLS, ROWS) / min(res.x, res.y);
        let inside = 1.0 - smoothstep(-aa, aa, d);
        return vec4f(mix(BG, c, inside), 1.0);

      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "rounded honeycomb pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
  });

  // uniform は resolution だけ (vec2f = 8 バイト)
  const uniformValues = new Float32Array(2);
  const uniformBuffer = device.createBuffer({
    label: "uniforms (resolution)",
    size: uniformValues.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    label: "uniforms bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  const render = () => {
    uniformValues.set([canvas.width, canvas.height]);
    device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

    const encoder = device.createCommandEncoder({ label: "encoder" });
    const pass = encoder.beginRenderPass({
      label: "canvas renderPass",
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: [0, 0, 0, 1],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  };

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const c = entry.target as HTMLCanvasElement;
      // CSS ピクセルではなく実ピクセルで描く (Retina で半分の解像度になってボケるのを防ぐ)
      const box = entry.devicePixelContentBoxSize?.[0];
      const dpr = window.devicePixelRatio || 1;
      const width = box ? box.inlineSize : entry.contentBoxSize[0].inlineSize * dpr;
      const height = box ? box.blockSize : entry.contentBoxSize[0].blockSize * dpr;
      c.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
      c.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));
    }
    render();
  });
  observer.observe(canvas, { box: "device-pixel-content-box" });
}

main();
