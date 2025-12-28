#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const SRC = path.join(__dirname, '..', 'media', 'icons', 'openhands-activitybar.svg');
const OUT = path.join(__dirname, '..', 'media', 'icons', 'openhands-icon.png');

function main() {
  const svg = fs.readFileSync(SRC, 'utf8');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 128 },
    background: 'rgba(0,0,0,0)'
  });
  const pngData = resvg.render().asPng();
  fs.writeFileSync(OUT, pngData);
  const rendered = resvg.render();
  const pngData = rendered.asPng();
  fs.writeFileSync(OUT, pngData);
  const { width, height } = rendered;
  console.log(`Wrote ${OUT} (${width}x${height})`);
}

main();
