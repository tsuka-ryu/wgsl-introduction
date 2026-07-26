// 平面リピートパターン — 02 映進 (せん断菱形のシェブロン)
// 参考: 幾何学パターンの本 3.2「映進」
//
// ── 菱形は「描く形」ではなく「マスの形」──────────────────
//   すきまが無く全面がどれかの菱形に属するので、必要なのは形ではなく平面の分割。
//   座標の方をせん断すれば (y に x を足す) マスの境界線が斜めになり、平行四辺形の
//   格子が勝手にできる。菱形の SDF は1つも要らない。
//
// ── 映進は「形」ではなく「色の並び」に入っている ──────────
//   列ごとにせん断の向きを反転 (縦の軸で鏡映) すると ＼ と ／ が向かい合って
//   シェブロンになる。折れ線自体は列をまたいで連続していて、ずれていない。
//   ずれているのは色の方で、繰り返しの1単位は本の図の赤枠どおり「1列 × 2段」。
//   1つの列の中では2色が交互に出るだけで、隣の列が別の2色ペアを使うので4色になる。
//   = モチーフを鏡映して半周期ずらす映進が、色の並びとして現れている。
//
// ── 角度と高さは独立に選べる (鏡映があるから) ──────────────
//   鏡映が無い格子だと「1列進む間にちょうど1段上がる」必要がある (半端だと隣の列の
//   線と高さが合わず段差になる) が、列ごとに反転していると境界は必ず折り返し点
//   (V の頂点) になるので、SLOPE がどんな値でも線が繋がる。
//   → 太さ = ROWS (1段の高さ) / 角度 = SLOPE、と役割を分けられる。
//
// ── アンチエイリアスについて ──────────────────────────────
//   floor で区画を決める塗り分けは距離場を持たないので、01 の fwidth + smoothstep が
//   使えない。やるならピクセル内を複数点サンプリングして平均する (スーパーサンプリング)
//   ことになるが、手数の割に効果が薄いので今回は掛けていない。

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
    label: "repeat-patterns 02 - glide chevron",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const COLS: f32 = 22.0;   // 画面に並ぶ列の数 (減らすと菱形が横に広がる)
      const ROWS: f32 = 24.0;   // 画面に並ぶ段の数 (増やすと1段が低くなって角度が寝る)
      const SLOPE: f32 = 0.65;   // 1列進む間に上がる段数。小さいほど角度が寝る

      // 01 と同じパレット。偶数列が C0/C2、奇数列が C1/C3 のペアで交互に出る
      const C0: vec3f = vec3f(0.482, 0.498, 0.776);   // 紫 ┐偶数列のペア
      const C2: vec3f = vec3f(0.874, 0.878, 0.863);   // 灰 ┘
      const C1: vec3f = vec3f(0.118, 0.357, 0.557);   // 青 ┐奇数列のペア
      const C3: vec3f = vec3f(0.910, 0.271, 0.184);   // 赤 ┘

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

        // 列の偶奇 + 段の偶奇×2 → 0〜3。1列 × 2段 が繰り返しの1単位
        let k = (col % 2.0) + 2.0 * (row % 2.0);

        var c = C0;
        if (k == 1.0) { c = C1; }
        if (k == 2.0) { c = C2; }
        if (k == 3.0) { c = C3; }
        return vec4f(c, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "glide chevron pipeline",
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
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;
      c.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
      c.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));
    }
    render();
  });
  observer.observe(canvas);
}

main();
