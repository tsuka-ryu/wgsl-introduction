// 幾何学パターン — 02 万華鏡 (簡易版): 極座標を「扇形×リング」に折りたたんで市松
// 参考: 幾何学パターンの本 1.1「回転対称」/ 高い次数の万華鏡
//
// ── モチーフは絵柄じゃなく「扇形の1切れ」──────────────────
//   複雑な万華鏡でも、繰り返しの最小単位は中心から外へ伸びる細いくさび1枚。
//   それを次数ぶん回すと全体になる。実装では「回転コピー」を手で並べる代わりに、
//   各ピクセルの角度を1切れぶんに畳む = 折りたたみで一発。ロゼット(01)が
//   「中心を n 個ループで置く」派だったのに対し、こちらは「折りたたむ」派。
//
// ── 全体を関数合成で読む ──────────────────────────────────
//   色(p) = 塗り(セル(p))
//   セル(p) = ( 扇形の番号 sector, リングの番号 ring )
//           = ( floor(角度 → SECT 分割), floor(半径 → RINGS 分割) )
//   極座標 (r, a) にして floor で畳むと、平面が扇形×リングの格子に割れる。
//   塗り(セル) = 市松 (sector+ring の偶奇) で白/地を選ぶだけ。地は赤と暗赤の織り。
//   時間には依らない純粋な座標の関数。回すなら角度に位相を足すだけ。
//
// ── 1ピクセルのトレース ──────────────────────────────────
//   p の半径 r と角度 a を測る。a を SECT 等分した何番目のくさびか (sector)、
//   r を RINGS 等分した何番目の輪か (ring) を floor で求める。偶数リングは
//   くさびを半分ずらして、市松のマスがひし形(ダイヤ)に見えるようにする。
//   sector+ring の偶奇で白マスか地マスかが決まり、地は輪ごとに赤/暗赤。

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
    label: "geometric-patterns 02 - mandala fold",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const SECT: f32 = 24.0;   // 角度の分割数 (中心の星は SECT/2 = 12 本のとがり)
      const RINGS: f32 = 10.0;  // 半径の分割数 (外へ向かう同心リングの数)
      const TAU: f32 = 6.2831853;

      // ★ 1切れだけ表示モード: true にすると「回転コピーの元になる扇形1切れ」だけ残す。
      //   隣の扇形で市松の白黒が反転するので、回して完全一致する最小単位は扇形 2 枚ぶん。
      const ISOLATE: bool = true;
      const WEDGE_SECTORS: f32 = 2.0;  // 1切れの幅 = 何セクター分か

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        // 短辺=1 の正規化座標。中心を原点に置く
        let res = u.resolution;
        var p = (position.xy - res * 0.5) / min(res.x, res.y);
        p.y = -p.y;

        // 極座標へ: r=中心からの距離, a=角度[0,1) に正規化
        let r = length(p);
        let a = atan2(p.y, p.x) / TAU + 0.5;   // [0, 1)

        // リング番号 (半径を RINGS 等分して floor で畳む)
        let ring = i32(floor(r * RINGS));

        // 扇形番号。偶数リングは半分ずらして市松をひし形に見せる
        let offset = f32(ring & 1) * 0.5;
        let sector = i32(floor(a * SECT + offset));

        // 市松: 扇形+リングの偶奇で白マスか地マスか
        let isWhite = ((sector + ring) & 1) == 0;

        let white   = vec3f(0.93, 0.92, 0.87);
        let red     = vec3f(0.80, 0.20, 0.13);
        let darkred = vec3f(0.33, 0.05, 0.05);
        // 地はリングごとに赤/暗赤を織り替える
        let ground  = select(darkred, red, (ring & 1) == 0);

        var col = select(ground, white, isWhite);

        // 1切れだけ表示: 選んだ扇形の外は暗く塗りつぶす (元の1枚が浮き上がる)
        if (ISOLATE && a * SECT >= WEDGE_SECTORS) {
          col = vec3f(0.12, 0.10, 0.10);
        }
        return vec4f(col, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "mandala pipeline",
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
