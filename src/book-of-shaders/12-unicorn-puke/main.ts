// The Book of Shaders — 12 セルラーノイズ: Unicorn Puke (グローバル Voronoi / 非タイル)
// 原作 GLSL: Nicolas Barradeau "Unicorn Puke" を WGSL へ移植。
//
// ◆ これまで (12-cellular-noise / 12-voronoi-tile / orbit / metaballs) との決定的な違い ◆
//   これまでは「平面を格子に切り、各セルに1点だけ置き、近傍3×3だけ走査」というタイル方式だった。
//   タイル方式は O(9) で済む代わりに、点は格子に紐づき [0,1]² に閉じ込める制約がある。
//   ここは真逆。格子を一切使わず、平面全体に 100 個の種点をばらまき、各ピクセルから
//   100 点ぜんぶへの距離を総当たりで測って最短1点を選ぶ。O(100)/ピクセルの力技 Voronoi。
//   → 制約から解放され、点は重なっても疎らでも自由。代わりに点が増えるほど重くなる。
//
// ◆ この関数が表す写像 (denotational に読む) ◆
//   各ピクセルの正方化座標 xy ∈ ℝ² に対して、
//     seed(i)  = center.xz + ra(i)·(cos an(i), sin an(i))      -- i番目の種点 (中心まわりの円板に散らす)
//     i*       = argmin_i  dist(xy, seed(i))                    -- 最も近い種点の番号
//     pp       = (seed(i*).x, seed(i*).y, i*/count · xy.x·xy.y) -- 勝った点の座標+独自のz
//     color    = pp + shade(pp)                                 -- 種点座標そのものを色に流用
//   color は xy の純関数。「平面 → 色」を 1 枚の式で定義しているだけで、ループは argmin の実装手段。
//
// ◆ 1ピクセルを追う ◆
//   いま画面のある1点 xy にいるとする。100 個の種点それぞれとの距離を測り、いちばん近い種点を1つ選ぶ。
//   その「勝った種点の (x,y) 座標」をそのまま赤・緑チャンネルに、番号と自分の位置から作った値を青に置く。
//   → 同じ種点が勝つ領域(=その種点のなわばり)は同じ座標値で塗られ、ベタ塗りのセルになる。
//   隣のなわばりに移ると勝者が別の種点に変わり、座標値がガクッと飛ぶ → セル境界がはっきり出る。
//   種点座標を色に使うので、隣り合うセルの色はランダムにバラけ、毒々しい虹色(=ユニコーンのゲロ)に。
//
// ◆ 動き ◆
//   center = (sin t, 1, cos(t/2)) が種点群の散布中心。t でゆっくり動くので、なわばり全体が漂う。
//   一方 an の時間項 sin(t·π·1e-5) はほぼ 0 で実質ほとんど効かない(原作通り。点配置の超低速ドリフト)。
//   見た目の動きの主役は center。shade の dot(pp, center) も center で時間変化し、明暗が呼吸する。
//
// uniform は resolution と time の 2 つ。

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
    label: "book of shaders 12 - unicorn puke (global voronoi)",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const PI = 3.1415926535897932;
      const COUNT = 100.0;   // 種点の数。総当たりなのでこの数だけ毎ピクセルで距離計算する

      // 1入力→1出力の最小ハッシュ(疑似乱数)。原作そのまま。
      fn hash(n: f32) -> f32 {
        return fract(sin(n) * 43758.5453123);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        // GLSL の gl_FragCoord は下原点。WGSL の position は上原点なので y を反転して合わせる。
        let frag = vec2f(position.x, u.resolution.y - position.y);
        // 「正方化」座標: 短辺(y)を基準に -1..1 へ。x はアスペクト比だけ横長になる。中心が原点。
        let xy = (2.0 * frag - u.resolution) / u.resolution.y;

        // 種点群を散らす中心。t でゆっくり動く(これが見た目の動きの主役)。
        let center = vec3f(sin(u.time), 1.0, cos(u.time * 0.5));

        var best = 4.0;            // これまでの最短距離。初期値は画面外の十分大きな値
        var pp = vec3f(0.0);       // 勝った種点の (x, y) と、そこから作る z

        // ── 100 個の種点を総当たりして、xy に最も近い1点を選ぶ(argmin の手実装)──
        for (var i = 0.0; i < COUNT; i = i + 1.0) {
          // セル中心まわりの「角度」と「半径」を乱数で決める = 円板内にランダムに点を散らす。
          // 時間項 sin(t·π·1e-5) はほぼ 0。実質ほぼ静止した点配置(原作の超低速ドリフト)。
          let an = sin(u.time * PI * 0.00001) - hash(i) * PI * 2.0;
          let ra = sqrt(hash(an)) * 0.5;   // sqrt で円板内を面積一様に散らす(中心に偏らない)
          let p  = vec2f(center.x + cos(an) * ra, center.z + sin(an) * ra);

          let di = distance(xy, p);
          // 原作は length=min(length,di) の直後に length==di で勝者判定。
          // 同値なので、より明快な「より近ければ更新」に書き換え(挙動は同一)。
          if (di < best) {
            best = di;
            // 勝った点の座標をそのまま色の種に。z は番号と自分の位置から作る独自値。
            pp = vec3f(p, i / COUNT * xy.x * xy.y);
          }
        }

        // 簡易ライティング。center 方向との内積で明暗を作る(quick & dirty)。
        // pp は種点座標なので負にもなる。dot がプラスなら暗く、マイナス/0なら明るく。
        let shade = 1.0 - max(0.0, dot(pp, center));

        // 種点座標 pp をそのまま色に流用し、shade を足す。範囲外は出力時にクランプされる。
        return vec4f(pp + vec3f(shade), 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "unicorn puke pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
  });

  const uniformBufferSize = 4 * 4;
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
