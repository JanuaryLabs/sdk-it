import React, { useEffect, useRef } from 'react';

import { cn } from '@sdk-it/shadcn';

interface LightningProps {
  hue?: number;
  xOffset?: number;
  speed?: number;
  intensity?: number;
  size?: number;
  width?: number;
  turbulence?: number;
  glow?: number;
  octaves?: number;
  className?: string;
}

export const Lightning: React.FC<LightningProps> = ({
  hue = 230,
  xOffset = 0,
  speed = 1,
  intensity = 1,
  size = 1,
  width = 0.5,
  turbulence = 1,
  glow = 0.1,
  octaves = 6,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animationFrameId: number;
    const gl = canvas.getContext('webgl');
    if (!gl) {
      console.error('WebGL not supported in this browser.');
      return;
    }

    // Enable alpha blending for smooth edge transitions
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const resizeCanvas = () => {
      if (
        canvas.parentElement &&
        canvas.parentElement.clientWidth > 0 &&
        canvas.parentElement.clientHeight > 0
      ) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvas.parentElement.clientWidth * dpr;
        canvas.height = canvas.parentElement.clientHeight * dpr;
        canvas.style.width = `${canvas.parentElement.clientWidth}px`;
        canvas.style.height = `${canvas.parentElement.clientHeight}px`;
      } else {
        canvas.width =
          (canvas.clientWidth || 300) * (window.devicePixelRatio || 1);
        canvas.height =
          (canvas.clientHeight || 150) * (window.devicePixelRatio || 1);
      }
      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    };

    window.addEventListener('resize', resizeCanvas);

    const vertexShaderSource = `
      attribute vec2 aPosition;
      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `;

    const fragmentShaderSource = `
      precision mediump float;
      uniform vec2 iResolution;
      uniform float iTime;
      uniform float uHue;
      uniform float uXOffset;
      uniform float uSpeed;
      uniform float uIntensity;
      uniform float uSize;
      uniform float uWidth;
      uniform float uTurbulence;
      uniform float uGlow;
      uniform int uOctaves;

      #define MAX_OCTAVES 10

      vec3 hsv2rgb(vec3 c) {
          vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0,4.0,2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
          return c.z * mix(vec3(1.0), rgb, c.y);
      }

      float hash11(float p) {
          p = fract(p * .1031);
          p *= p + 33.33;
          p *= p + p;
          return fract(p);
      }

      float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * .1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
      }

      mat2 rotate2d(float theta) {
          float c = cos(theta);
          float s = sin(theta);
          return mat2(c, -s, s, c);
      }

      float noise(vec2 p) {
          vec2 ip = floor(p);
          vec2 fp = fract(p);

          // Improved smoothing with cubic interpolation
          vec2 u = fp * fp * (3.0 - 2.0 * fp);

          float a = hash12(ip);
          float b = hash12(ip + vec2(1.0, 0.0));
          float c = hash12(ip + vec2(0.0, 1.0));
          float d = hash12(ip + vec2(1.0, 1.0));

          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      float fbm(vec2 p) {
          float value = 0.0;
          float amplitude = 0.5;
          float frequency = 1.0;

          // Dynamic octave count based on uniform
          for (int i = 0; i < MAX_OCTAVES; ++i) {
              if (i >= uOctaves) break;

              value += amplitude * noise(p * frequency);
              p *= rotate2d(0.45);
              frequency *= 2.0;
              amplitude *= 0.5;
          }
          return value;
      }

      void mainImage(out vec4 fragColor, in vec2 fragCoord) {
          vec2 uv = fragCoord / iResolution.xy;

          // Enhanced vertical fade for top and bottom blending
          float fadeZone = 0.3;
          float edgeFade = 0.05;

          // Improved fade calculation with cubic easing for smoother transition
          float topFade = smoothstep(0.0, fadeZone, uv.y);
          float bottomFade = smoothstep(0.0, fadeZone, 1.0 - uv.y);

          // Apply cubic easing to the fade for more natural blending
          topFade = topFade * topFade * (3.0 - 2.0 * topFade);
          bottomFade = bottomFade * bottomFade * (3.0 - 2.0 * bottomFade);

          // Additional edge fading for perfect blending with background
          topFade *= smoothstep(0.0, edgeFade, uv.y);
          bottomFade *= smoothstep(0.0, edgeFade, 1.0 - uv.y);

          float verticalFade = topFade * bottomFade;

          // Transform to centered coordinates
          uv = 2.0 * uv - 1.0;
          uv.x *= iResolution.x / iResolution.y;
          uv.x += uXOffset;

          // Add time-varying turbulence with improved fbm function
          float timeOffset = iTime * uSpeed;
          float randomOffset = hash11(floor(timeOffset * 0.5) * 0.3) * 0.1;
          uv += (2.0 * fbm(uv * uSize + vec2(0.8 * timeOffset + randomOffset, 0.2 * timeOffset)) - 1.0) * uTurbulence;

          // Calculate distance with width parameter for thickness control
          float dist = abs(uv.x) / uWidth;

          // Base intensity modulation with time
          float baseIntensity = mix(0.04, 0.08, hash11(timeOffset * 0.3));

          // Color calculation with improved lightning effect
          vec3 baseColor = hsv2rgb(vec3(uHue / 360.0, 0.7, 0.8));
          vec3 glowColor = hsv2rgb(vec3((uHue + 10.0) / 360.0, 0.5, 0.9));

          // Core lightning
          float core = pow(baseIntensity / dist, 1.2) * uIntensity;

          // Glow effect
          float glowEffect = exp(-dist * 4.0) * uGlow;

          // Combine effects with time variation
          vec3 col = baseColor * core;
          col += glowColor * glowEffect;

          // Add subtle color variations
          col += vec3(0.02, 0.02, 0.04) * hash11(timeOffset + dist);

          // Gamma correction
          col = pow(col, vec3(0.8));

          // Apply enhanced vertical fade to alpha for perfect blending
          fragColor = vec4(col, verticalFade * smoothstep(1.5, 0.5, dist));
      }

      void main() {
          mainImage(gl_FragColor, gl_FragCoord.xy);
      }
    `;

    const compileShader = (
      source: string,
      type: number,
    ): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (!shader) {
        console.error('Failed to create shader object.');
        return null;
      }
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const shaderType = type === gl.VERTEX_SHADER ? 'VERTEX' : 'FRAGMENT';
        console.error(
          `Shader compile error (${shaderType}):`,
          gl.getShaderInfoLog(shader),
        );
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vertexShader = compileShader(vertexShaderSource, gl.VERTEX_SHADER);
    const fragmentShader = compileShader(
      fragmentShaderSource,
      gl.FRAGMENT_SHADER,
    );

    if (!vertexShader || !fragmentShader) {
      if (vertexShader) gl.deleteShader(vertexShader);
      if (fragmentShader) gl.deleteShader(fragmentShader);
      window.removeEventListener('resize', resizeCanvas);
      return;
    }

    const program = gl.createProgram();
    if (!program) {
      console.error('Failed to create GL program.');
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      window.removeEventListener('resize', resizeCanvas);
      return;
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program linking error:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      window.removeEventListener('resize', resizeCanvas);
      return;
    }
    gl.useProgram(program);

    const vertices = new Float32Array([
      -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
    ]);
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const aPosition = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    const iResolutionLocation = gl.getUniformLocation(program, 'iResolution');
    const iTimeLocation = gl.getUniformLocation(program, 'iTime');
    const uHueLocation = gl.getUniformLocation(program, 'uHue');
    const uXOffsetLocation = gl.getUniformLocation(program, 'uXOffset');
    const uSpeedLocation = gl.getUniformLocation(program, 'uSpeed');
    const uIntensityLocation = gl.getUniformLocation(program, 'uIntensity');
    const uSizeLocation = gl.getUniformLocation(program, 'uSize');
    const uWidthLocation = gl.getUniformLocation(program, 'uWidth');
    const uTurbulenceLocation = gl.getUniformLocation(program, 'uTurbulence');
    const uGlowLocation = gl.getUniformLocation(program, 'uGlow');
    const uOctavesLocation = gl.getUniformLocation(program, 'uOctaves');

    const startTime = performance.now();

    const renderLoop = () => {
      if (!canvasRef.current || !gl || gl.isContextLost()) {
        cancelAnimationFrame(animationFrameId);
        return;
      }

      gl.uniform2f(iResolutionLocation, gl.canvas.width, gl.canvas.height);
      const currentTime = performance.now();
      gl.uniform1f(iTimeLocation, (currentTime - startTime) / 1000.0);
      gl.uniform1f(uHueLocation, hue);
      gl.uniform1f(uXOffsetLocation, xOffset);
      gl.uniform1f(uSpeedLocation, speed);
      gl.uniform1f(uIntensityLocation, intensity);
      gl.uniform1f(uSizeLocation, size);
      gl.uniform1f(uWidthLocation, width);
      gl.uniform1f(uTurbulenceLocation, turbulence);
      gl.uniform1f(uGlowLocation, glow);
      gl.uniform1i(uOctavesLocation, octaves);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      animationFrameId = requestAnimationFrame(renderLoop);
    };

    resizeCanvas();
    animationFrameId = requestAnimationFrame(renderLoop);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationFrameId);

      if (gl && !gl.isContextLost()) {
        gl.deleteProgram(program);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        gl.deleteBuffer(vertexBuffer);
      }
    };
  }, [hue, xOffset, speed, intensity, size, width, turbulence, glow, octaves]);

  return (
    <canvas
      ref={canvasRef}
      className={cn('size-full opacity-90', className)}
      aria-hidden="true"
    />
  );
};
