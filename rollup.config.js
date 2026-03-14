import { nodeResolve } from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

export default {
  input: 'src/mysmart-frigate-live-card.js',
  output: {
    file: 'mysmart-frigate-live-card.js',
    format: 'es',
    sourcemap: true,
  },
  plugins: [
    nodeResolve(),
    terser({
      format: {
        comments: false,
      },
    }),
  ],
};
