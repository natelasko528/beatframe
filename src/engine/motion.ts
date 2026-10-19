// "Living stills": free, code-only motion for a still image plus its depth map (WebGL2).
// - 2.5D camera: near pixels move more than far ones (parallax), with a depth-aware dolly.
// - Water shimmer + sparkle on turquoise/blue areas, a gentle sway on foliage.
// Deterministic: the same (shot, t) always draws the same frame, so preview, export and CLI match.
// Falls back (returns null) when WebGL2 isn't available, and the 2D renderer draws the plain still.

type Img = CanvasImageSource & { width: number; height: number };

const VS = `#version 300 es
in vec2 a; out vec2 p;
void main(){ p = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
in vec2 p; out vec4 o;
uniform sampler2D img, dep;
uniform vec4 rect;      // drawn image rect in screen uv: x0, y0, w, h (y down)
uniform vec2 cam;       // lateral camera travel in image uv
uniform float dolly;    // depth-aware push (+) / pull (-)
uniform float focus;    // depth that stays put
uniform float t, water, sway;
uniform float alpha;

vec3 hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 q=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g)); vec4 r=mix(vec4(q.xyw,c.r),vec4(c.r,q.yzx),step(q.x,c.r)); float d=r.x-min(r.w,r.y); return vec3(abs(r.z+(r.w-r.y)/(6.*d+1e-6)),d/(r.x+1e-6),r.x); }
float hash(vec2 v){ return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }

void main(){
  vec2 s = vec2(p.x, 1.0 - p.y);                 // screen uv, y down
  vec2 uv = (s - rect.xy) / rect.zw;              // image uv before motion
  vec2 c = vec2(0.5);
  // parallax by fixed-point iteration: find the source pixel whose own depth sends it here
  vec2 q = uv;
  for (int i = 0; i < 4; i++) {
    float d = texture(dep, clamp(q, 0.001, 0.999)).r - focus;
    q = c + (uv - c) / (1.0 + dolly * d) - cam * d;
  }
  vec3 base = texture(img, clamp(q, 0.001, 0.999)).rgb;
  vec3 h = hsv(base);
  float d0 = texture(dep, clamp(q, 0.001, 0.999)).r;
  // water: cyan/blue, saturated, not in the near foreground
  float hueW = smoothstep(0.42, 0.47, h.x) * (1.0 - smoothstep(0.60, 0.66, h.x));
  float mW = water * hueW * smoothstep(0.18, 0.35, h.y) * (1.0 - smoothstep(0.55, 0.8, d0)) * step(0.3, q.y);
  // foliage: green, upper part of frame, mid/far
  float hueF = smoothstep(0.17, 0.22, h.x) * (1.0 - smoothstep(0.40, 0.45, h.x));
  float mF = sway * hueF * smoothstep(0.15, 0.3, h.y) * (1.0 - smoothstep(0.6, 0.85, d0)) * (1.0 - smoothstep(0.45, 0.8, q.y));
  vec2 off = vec2(sin(q.y * 220.0 + t * 2.4) * 0.0011 + sin(q.y * 97.0 - t * 1.3) * 0.0007, sin(q.x * 140.0 + t * 1.9) * 0.0006) * mW;
  off += vec2(sin(t * 1.15 + q.y * 5.0 + q.x * 3.0) * 0.0035, sin(t * 0.9 + q.x * 4.0) * 0.0012) * mF * (1.0 - q.y);
  vec3 col = (mW + mF) > 0.001 ? texture(img, clamp(q + off, 0.001, 0.999)).rgb : base;
  // sun glints on water: bright pixels twinkle
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  float tw = hash(floor(q * vec2(420.0, 240.0)) + floor(t * 9.0));
  col += mW * smoothstep(0.72, 0.95, lum) * step(0.82, tw) * 0.35;
  o = vec4(col, alpha);
}`;

export interface MotionParams { rect: [number, number, number, number]; cam: [number, number]; dolly: number; focus: number; t: number; water: number; sway: number; alpha?: number }

export class DepthMotion {
  cv: OffscreenCanvas | HTMLCanvasElement; private gl: WebGL2RenderingContext; private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {}; private tex = new WeakMap<object, WebGLTexture>();
  private constructor(cv: OffscreenCanvas | HTMLCanvasElement, gl: WebGL2RenderingContext, prog: WebGLProgram) {
    this.cv = cv; this.gl = gl; this.prog = prog;
    for (const n of ['img', 'dep', 'rect', 'cam', 'dolly', 'focus', 't', 'water', 'sway', 'alpha']) this.u[n] = gl.getUniformLocation(prog, n);
  }
  static create(w: number, h: number): DepthMotion | null {
    try {
      const cv: any = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
      const gl = cv.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false }) as WebGL2RenderingContext | null;
      if (!gl) return null;
      const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader'); return s; };
      const prog = gl.createProgram()!; gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
      gl.useProgram(prog);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      return new DepthMotion(cv, gl, prog);
    } catch { return null; }
  }
  private texture(src: Img) {
    let t = this.tex.get(src as any); if (t) return t;
    const gl = this.gl; t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src as any);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.tex.set(src as any, t); return t;
  }
  draw(img: Img, depth: Img, m: MotionParams) {
    const gl = this.gl; gl.viewport(0, 0, this.cv.width, this.cv.height);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture(img)); gl.uniform1i(this.u.img, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texture(depth)); gl.uniform1i(this.u.dep, 1);
    gl.uniform4f(this.u.rect, ...m.rect); gl.uniform2f(this.u.cam, ...m.cam);
    gl.uniform1f(this.u.dolly, m.dolly); gl.uniform1f(this.u.focus, m.focus); gl.uniform1f(this.u.t, m.t);
    gl.uniform1f(this.u.water, m.water); gl.uniform1f(this.u.sway, m.sway); gl.uniform1f(this.u.alpha, m.alpha ?? 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.cv;
  }
}

/** Asset id of a scene image's depth map. */
export const depthId = (imgId: string) => `${imgId}~depth`;
