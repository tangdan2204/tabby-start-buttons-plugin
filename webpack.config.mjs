import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default {
  target: 'node',
  entry: './src/index.ts',
  devtool: false,
  node: {
    __dirname: false,
    __filename: false,
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js',
    libraryTarget: 'umd',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'ts-loader',
          options: { transpileOnly: true },
        },
        exclude: /node_modules/,
      },
    ],
  },
  externals: [
    'tabby-core',
    'tabby-terminal',
    'tabby-local',
    '@angular/core',
    '@angular/common',
    '@angular/forms',
    '@angular/platform-browser',
    'rxjs',
    'rxjs/operators',
    '@electron/remote',
    'electron',
    'fs',
    'path',
    'child_process',
    'os',
    'net',
  ],
}
