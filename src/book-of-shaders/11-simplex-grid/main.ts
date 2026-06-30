// The Book of Shaders — 11 ノイズ: シンプレックスグリッド (simplex grid)
// https://thebookofshaders.com/11/?lan=jp  (Author @patriciogv - 2015)
//
// simplex noise の "下ごしらえ"。ノイズそのものはまだ作らない。
// 「正方格子の代わりに三角格子を使う」という土台だけを可視化する回。
//
// ── なぜ三角格子か ────────────────────────────────────────────────
// value / gradient noise は正方格子で、1マスの補間に 4隅 (2^2) を使う。
//   ・隅が多い → 次元が上がると爆発的に重い (3Dで8隅, 4Dで16隅)。
//   ・軸に沿った癖 (格子目) が残る (gradient-noise の回で見た弱点)。
// simplex noise は「その次元で一番頂点の少ない図形 = 単体(simplex)」で空間を敷き詰める。
//   2D の単体は三角形 → 1マスあたり 3頂点 (N次元で N+1) だけ。軽くて軸の癖も出にくい。
//
// ── このデモがやること (3段階) ──────────────────────────────────
//   STAGE 1: ただの正方格子。fract(st) を r,g に出すと 1マスごとに同じ赤緑グラデが並ぶ。
//   STAGE 2: skew で格子を歪める。正方形が平行四辺形に倒れる (三角格子の前段)。
//   STAGE 3: simplexGrid。平行四辺形を対角線で2つの三角形に割り、各点が属する三角形の
//            3頂点への近さ (重心座標っぽい値) を r,g,b にして三角タイルを描く。
//
// ── 1ピクセル st でのトレース ───────────────────────────────────
//   skew(st)        … 座標を 2/√3 倍ほど横に伸ばし y を傾ける。三角格子を軸ぞろえに直す変換。
//   fract(skew(st)) … 歪めた格子の "1マス内のどこか" (0〜1 の平行四辺形内座標) p。
//   p.x > p.y ?     … 1マス(平行四辺形)を対角線で2分割。上の三角か下の三角かの判定。
//   xyz             … その三角の3頂点それぞれへの近さ。色(RGB)にすると三角タイルが見える。
//
// 1.1547 = 2/√3。正三角形を正方格子に押し込むための横方向の引き伸ばし係数。

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
    label: "book of shaders 11 - simplex grid",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 正方格子 → 三角格子へ。横を 2/√3 倍に伸ばし、y を x ぶん傾ける剪断(せん断)変換。
      fn skew(st: vec2f) -> vec2f {
        var r = vec2f(0.0);
        r.x = 1.1547 * st.x;        // 2/√3。正三角形が収まるよう横に引き伸ばす
        r.y = st.y + 0.5 * r.x;     // y を x に応じて傾ける → 格子が平行四辺形に倒れる
        return r;
      }

      // 歪めた1マス内の点 p が、どちらの三角形に属し、3頂点にどれだけ近いかを返す。
      // 戻り値 xyz = 3頂点それぞれへの近さ (重心座標っぽい量)。色にすると三角タイルになる。
      fn simplexGrid(st: vec2f) -> vec3f {
        var xyz = vec3f(0.0);

        let p = fract(skew(st));    // 歪めた格子の "1マス内のどこか"
        if (p.x > p.y) {
          // 対角線の下側の三角形
          xyz.x = 1.0 - p.x;
          xyz.y = 1.0 - (p.y - p.x);
          xyz.z = p.y;
        } else {
          // 対角線の上側の三角形
          xyz.x = p.x;
          xyz.y = 1.0 - (p.x - p.y);
          xyz.z = 1.0 - p.y;
        }

        return fract(xyz);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        // GLSL は y が下から上。WebGPU は上から下なので反転して本と合わせる。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        // 格子が見えるよう空間を10倍に拡大。
        st *= 10.0;

        // STAGE を 1 / 2 / 3 で切り替えて段階を見る。
        let STAGE = 3;

        var color = vec3f(0.0);
        if (STAGE == 1) {
          // ① ただの正方格子: 1マスごとに同じ赤→緑グラデ。
          color = vec3f(fract(st), 0.0);
        } else if (STAGE == 2) {
          // ② skew した格子: 正方形が平行四辺形に倒れる。
          color = vec3f(fract(skew(st)), 0.0);
        } else {
          // ③ 平行四辺形を2つの正三角形に分割。3頂点への近さを RGB に。
          color = simplexGrid(st);
        }

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "simplex grid pipeline",
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