// The Book of Shaders — 06 色について: HSB (色相 × 明るさ)
// https://thebookofshaders.com/06/?lan=jp
//
// これまで色は RGB (赤・緑・青を直接指定) で扱ってきた。
// でも「虹のどの色か」を選びたいときは RGB は不便 (赤を増やすと…と毎回考える)。
// そこで HSB という別の表し方を使う:
//
//   H (Hue        / 色相)   : 0〜1 で虹を一周 (0=赤 → 黄 → 緑 → 水 → 青 → 紫 → 1=赤)
//   S (Saturation / 彩度)   : 0=灰色 〜 1=鮮やか
//   B (Brightness / 明るさ) : 0=黒 〜 1=明るい
//
// この作例は画面を「色見本 (カラーピッカー)」にする:
//   横 (st.x) → 色相 H   … 左から右へ虹がぐるっと
//   縦 (st.y) → 明るさ B … 下が暗く、上が明るい
//   彩度 S は 1.0 固定
//
// 核心は hsb2rgb 関数 (HSB → RGB 変換)。画面に出せるのは RGB だけなので、
// HSB で考えた色を最後に RGB へ変換して返す。Iñigo Quiles 版の有名な実装。
//
// WGSL メモ:
//   GLSL の mod(x, y)  -> WGSL は % 演算子 (x % y)。今回は中身が正なので挙動は同じ。
//   clamp(v, 0.0, 1.0) -> WGSL は下限/上限も同じ型が必要なので clamp(v, vec3f(0.0), vec3f(1.0))
//   c.x / c.y / c.z    -> ここでは H / S / B の意味で使っている (xyz は単なる成分名)

import { fail } from "../../webgpu-fundamentals/util";

async function main() {
  // 1. アダプタとデバイスの取得
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) {
    fail("このブラウザは WebGPU に対応していません (Chrome / Edge 113+ など)。");
    return;
  }

  // 2. キャンバスを WebGPU 用に設定
  const canvas = document.querySelector("canvas")!;
  const context = canvas.getContext("webgpu")!;
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: presentationFormat,
  });

  // 3. シェーダモジュール
  const module = device.createShaderModule({
    label: "book of shaders 06 - hsb color picker",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // HSB (色相, 彩度, 明るさ) を RGB に変換する。Iñigo Quiles 版。
      //   c.x = H, c.y = S, c.z = B
      // 仕組み: H を 6 倍して 0,4,2 ずらした 3 本の三角波を作ると、
      //   R/G/B が虹の順にピークを迎える形になる (06-colors の sin 虹と同じ発想の三角波版)。
      fn hsb2rgb(c: vec3f) -> vec3f {
        // 色相から R/G/B の生の強さ (0〜1) を作る。
        var rgb = clamp(
          abs((c.x * 6.0 + vec3f(0.0, 4.0, 2.0)) % 6.0 - 3.0) - 1.0,
          vec3f(0.0),
          vec3f(1.0)
        );
        // rgb*rgb*(3-2*rgb) = smoothstep 相当。角を丸めて色の変わり目をなめらかに。
        rgb = rgb * rgb * (3.0 - 2.0 * rgb);
        // 彩度 (S=c.y) で灰色(1,1,1)と混ぜ、明るさ (B=c.z) を全体に掛ける。
        return c.z * mix(vec3f(1.0), rgb, c.y);
      }

      // 逆変換: RGB -> HSB。hsb2rgb のちょうど反対 (色から「色相・彩度・明るさ」を割り出す)。
      // この作例の描画では使わないが、参考として WGSL 移植版を置いておく。
      //   c.r/g/b = 赤緑青 -> 戻り値 .x=H(色相) .y=S(彩度) .z=B(明るさ)
      // ポイント: GLSL の .bg / .gb / .xyw / .yzx といったスウィズルは WGSL でもそのまま動く
      //   (xyzw / rgba の 2 系統だけ。今回は両方使っているが混在はしていないので OK)。
      // 分岐 (if) を使わず step + mix で「大小で入れ替える」ことで GPU 向きに書いてある。
      fn rgb2hsb(c: vec3f) -> vec3f {
        let K = vec4f(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
        let p = mix(vec4f(c.bg, K.wz),
                    vec4f(c.gb, K.xy),
                    step(c.b, c.g));
        let q = mix(vec4f(p.xyw, c.r),
                    vec4f(c.r, p.yzx),
                    step(p.x, c.r));
        let d = q.x - min(q.w, q.y);
        let e = 1.0e-10; // 0 割りを防ぐためのごく小さい値
        return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + e)),
                     d / (q.x + e),
                     q.x);
      }

      @vertex fn vs(
        @builtin(vertex_index) vertexIndex : u32
      ) -> @builtin(position) vec4f {
        let pos = array(
          vec2f(-1.0,  3.0),
          vec2f( 3.0, -1.0),
          vec2f(-1.0, -1.0),
        );
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(
        @builtin(position) position: vec4f
      ) -> @location(0) vec4f {
        // 下=0、上=1 になるよう y を反転。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        // x → 色相 H、y → 明るさ B、彩度 S は 1.0 固定。
        let color = hsb2rgb(vec3f(st.x, 1.0, st.y));

        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "hsb color picker pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: presentationFormat }],
    },
  });

  // 5. ユニフォームバッファ (resolution: vec2f)
  const uniformBufferSize = 2 * 4;
  const uniformValues = new Float32Array(uniformBufferSize / 4);

  const uniformBuffer = device.createBuffer({
    label: "uniforms (resolution)",
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    label: "uniforms bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  function render(device: GPUDevice) {
    uniformValues.set([canvas.width, canvas.height], 0);
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
    render(device);
  });
  observer.observe(canvas);
}

main();