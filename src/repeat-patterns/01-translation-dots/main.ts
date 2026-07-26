// 平面リピートパターン — 01 並進 (4色ドットの2×2セル)
// 参考: 幾何学パターンの本 3.1「並進」
//
// ── 繰り返しの1単位は円1個ではなく 2×2 個 ──────────────────
//   対称操作は並進だけ (p1) で、回転も鏡映も入っていない。にもかかわらず単純な
//   タイリングに見えないのは、円1個ではなく円 2×2 個ぶんを1単位として、そこに
//   4色を割り当てているから。本の図で赤枠が囲っているのがその 2×2 の基本セル。
//
// ── st = floor(st) + fract(st) の両側を使う ────────────────
//   fract(st) … 0〜1 の小数。セル内では連続的に変化 → 形 (円) に使う
//   floor(st) … 整数。セル内では定数            → 色 (パレット) に使う
//   円の形は全マス同じ (fract 側が同じ) なのに色だけマスごとに違う (floor 側を見る)。
//   floor を色に使った瞬間、繰り返しの単位が円1個から 2×2 個に広がる。
//   全マス同じ色にすれば geometric-patterns/05-dot-lattice と同じただの p1。
//
// ── 全体を関数合成で読む ──────────────────────────────────
//   色(p) = mix(地, パレット(セル番号), 円の内側マスク(セル内座標))
//   時間に依存しない座標の純関数。だから描画はリサイズ時だけ (rAF ループなし)。
//
// ── 1ピクセルのトレース ──────────────────────────────────
//   st=(5.3, 2.7) のピクセルなら、floor で (5,2) = 5列2行目のマスと分かり、
//   列偶数×行偶数なので k=0 → 青。fract で (0.3, 0.7)、中心を原点に寄せて
//   (-0.2, 0.2)、中心からの距離 0.28 は RADIUS=0.5 の内側なので青が採用される。

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
    label: "repeat-patterns 01 - translation dots",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const SCALE: f32 = 20.0;   // 画面短辺あたりのタイル数めやす

      // 2×2 セルの4色。並べ替えるだけで色の配置が変わる (k=0 左上 / 1 右上 / 2 左下 / 3 右下)
      const C0: vec3f = vec3f(0.118, 0.357, 0.557);   // 青
      const C1: vec3f = vec3f(0.482, 0.498, 0.776);   // 紫
      const C2: vec3f = vec3f(0.874, 0.878, 0.863);   // 灰
      const C3: vec3f = vec3f(0.910, 0.271, 0.184);   // 赤
      const BG: vec3f = vec3f(1.0);   // 地 (白)。4円の間に残る星形のすきまがこの色
      const RADIUS: f32 = 0.5;        // 0.5 で隣の円とちょうど接する。下げると余白が広がる

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        let res = u.resolution;
        // 短辺で割って画面を 0〜1 にし、SCALE 倍。以後 1.0 進む = 円1個ぶん
        let st = position.xy / min(res.x,res.y) * SCALE;

        let id = floor(st);            // どのマスにいるか (セル番号)
        let local = fract(st) - 0.5;   // マスの中のどこにいるか。-0.5 で中心を原点へ
        let d = length(local);         // 中心からの距離 = 円の距離場

        // 列の偶奇 (0/1) + 行の偶奇 (0/1)×2 → k は 0〜3 の4通り = 2×2 の基本セル
        let k = (id.x % 2.0) + 2.0 * (id.y % 2.0);

        var col = C0;
        if(k == 1.0) { col = C1; }
        if(k == 2.0) { col = C2; }
        if(k == 3.0) { col = C3; }

        // fwidth(d) = 1ピクセル進むと d がどれだけ変わるか。これを境界のぼかし幅に
        // 使うと、SCALE や画面サイズを変えてもアンチエイリアスが常に1ピクセル相当になる
        let aa = fwidth(d);
        let inside = 1.0 - smoothstep(RADIUS - aa, RADIUS + aa, d);
        return vec4f(mix(BG, col, inside), 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "translation dots pipeline",
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
