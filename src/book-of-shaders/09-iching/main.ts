// The Book of Shaders — 09 パターン: 易経の卦 (I Ching)
// https://thebookofshaders.com/09/?lan=jp  (Patricio Gonzalez Vivo の IChing series を移植)
//
// 1ピクセルを追って denotational に書くと、最終画像はこうなる:
//
//   image(p) = step(0.7, df(fpos))
//   ただし st    = (p を 10倍した格子座標)
//          ipos  = floor(st)            … どのマスか (卦の "番地")
//          fpos  = fract(st)            … マス内ローカル座標 0〜1
//          df    = hexFig(fpos, N) + (1 - rect(fpos, 0.7))   … 卦の絵 + 枠
//          N     = ipos.x + ipos.y + t  … そのマスに割り当てる卦番号 (時間で +t)
//
// ここでの主役は「整数 N → 6本の爻 (陰陽) → 絵」という分解。易経の卦は 6本の横線で、
// 各線は陽 (─ つながった棒) か陰 (- - 切れた棒) の2値。つまり卦は 6bit の数 = 0..63 の
// 64通り。N を mod 64 して 2進分解すれば、各 bit がそのまま下から i 本目の爻になる。
//
// 形を作る関数の意味:
//   shape(st,N) … 中心からの "N角形距離"。N=4 で正方形のフィールド。
//   box        … shape(_,4) を size で潰した長方形フィールド。これ1つで棒1本を描く。
//   hexFig     … マスを 2列 × 6行 に割る。各行で N の該当 bit を取り、
//                 陽(bit=1)= ずらした box で1本の棒、陰(bit=0)= 0.84倍に痩せた box で
//                 中央に隙間 → 切れた棒、を mix(...) で選ぶ。x は 1.0 で鏡映して左右対称に。
//   rect       … マスの内側 0.7 四方だけ 1 になる窓。1-rect で外周に枠線を足す。
//
// 動き: N = ipos.x + ipos.y + t は、斜め方向に卦番号が 1 ずつ増える階調。これに t を
// 足すと全マスの卦が時間でカウントアップし、64通りを巡回してパラパラ替わる。
// 形 step(0.7, ...) は不変で、変わるのは「どの整数を絵に翻訳するか」だけ。

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
    label: "book of shaders 09 - iching",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const PI = 3.14159265358979323846;
      const TWO_PI = 6.28318530717958647692;

      // GLSL の mod(x,y)=x-y*floor(x/y) (常に [0,y) の正の余り)。卦番号の bit 取り出しに使う。
      fn modf2(x: f32, y: f32) -> f32 {
        return x - y * floor(x / y);
      }

      // 中心 0.5 からの "N角形距離"。N=4 で正方形のフィールドを作る。
      fn shape(stIn: vec2f, n: f32) -> f32 {
        let st = stIn * 2.0 - 1.0;
        let a = atan2(st.x, st.y) + PI;
        let r = TWO_PI / n;
        return abs(cos(floor(0.5 + a / r) * r - a) * length(st));
      }

      // shape(_,4) を size で潰した長方形フィールド。これ1つで爻の棒1本を描く。
      fn box(st: vec2f, size: vec2f) -> f32 {
        return shape(st * size, 4.0);
      }

      // マスの内側 size 四方だけ 1 になる窓 (枠を足すのに使う)。
      fn rect(st: vec2f, sizeIn: vec2f) -> f32 {
        let size = vec2f(0.5) - sizeIn * 0.5;
        var uv = smoothstep(size, size + vec2f(1e-4), st);
        uv *= smoothstep(size, size + vec2f(1e-4), vec2f(1.0) - st);
        return uv.x * uv.y;
      }

      // 卦の本体。マスを 2列 × 6行 に割り、各行で N の bit を取って爻 (陽/陰) を描く。
      fn hexFig(stIn: vec2f, n: f32) -> f32 {
        var st = stIn * vec2f(2.0, 6.0);
        var fpos = fract(st);
        let ipos = floor(st);

        // x は右列を折り返して左右対称に (棒は中央でつながる/切れる)。
        if (ipos.x == 1.0) { fpos.x = 1.0 - fpos.x; }

        // 行番号 (下から 0..5)。その行に対応する bit を N (mod 64) から取り出す。
        let row = clamp(i32(ipos.y), 0, 5);
        var remain = floor(modf2(n, 64.0));
        var bit = 0.0;
        for (var i = 0; i <= 5; i = i + 1) {
          let bi = step(1.0, modf2(remain, 2.0));
          if (i == row) { bit = bi; }
          remain = ceil(remain / 2.0);
        }

        // bit=0 (陰): 0.84 倍に痩せた box → 中央に隙間ができ切れた棒。
        // bit=1 (陽): 少しずらした box → 中央でつながった棒。
        return mix(box(fpos, vec2f(0.84, 1.0)),
                   box(fpos - vec2f(0.03, 0.0), vec2f(1.0)),
                   bit);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution; // 0〜1 の画面座標
        st.y = 1.0 - st.y;                   // GL と同じく y を上向きに (卦は下から積む)

        st = st * 10.0;            // 10x10 の格子に
        let fpos = fract(st);      // マス内ローカル座標
        let ipos = floor(st);      // どのマスか

        let t = u.time * 5.0;
        let n = ipos.x + ipos.y + t;          // そのマスの卦番号 (斜め階調 + 時間カウント)
        let df = hexFig(fpos, n) + (1.0 - rect(fpos, vec2f(0.7)));

        let color = mix(vec3f(0.0), vec3f(1.0), step(0.7, df));
        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "iching pipeline",
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