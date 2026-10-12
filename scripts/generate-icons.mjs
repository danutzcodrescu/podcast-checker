import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const assetUrl = (name) => new URL(`../public/${name}`, import.meta.url)
const logo = await sharp(fileURLToPath(assetUrl('logo.png')))
  .trim({ threshold: 10 })
  .png()
  .toBuffer()
const background = '#fdfcfb'

async function renderIcon(size, transparent = false) {
  const artworkSize = Math.round(size * (transparent ? 0.95 : 0.8))
  const artwork = await sharp(logo)
    .resize(artworkSize, artworkSize, { fit: 'contain', background: '#00000000' })
    .png()
    .toBuffer()
  const image = sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: transparent ? '#00000000' : background,
    },
  }).composite([{ input: artwork, gravity: 'centre' }])

  return (transparent ? image : image.removeAlpha()).png().toBuffer()
}

// ICO supports multiple embedded PNG sizes for browser and legacy fallback use.
function createIco(frames) {
  const header = Buffer.alloc(6 + frames.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)
  let imageOffset = header.length

  frames.forEach(({ size, image }, index) => {
    const entry = 6 + index * 16
    header[entry] = size
    header[entry + 1] = size
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(image.length, entry + 8)
    header.writeUInt32LE(imageOffset, entry + 12)
    imageOffset += image.length
  })

  return Buffer.concat([header, ...frames.map(({ image }) => image)])
}

// Safari pinned tabs need a solid monochrome SVG, rather than an embedded bitmap.
// Convert the source alpha silhouette into a vector path at 256px resolution.
async function createSafariMask() {
  const size = 256
  const { data, info } = await sharp(await renderIcon(size, true))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const paths = []

  for (let y = 0; y < size; y += 1) {
    let x = 0
    while (x < size) {
      if (data[(y * size + x) * info.channels + 3] < 128) {
        x += 1
        continue
      }
      const start = x
      while (x < size && data[(y * size + x) * info.channels + 3] >= 128) x += 1
      paths.push(`M${start} ${y}h${x - start}v1h-${x - start}Z`)
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><path fill="#000" d="${paths.join('')}"/></svg>\n`
}

const faviconFrames = await Promise.all(
  [16, 32, 48].map(async (size) => ({ size, image: await renderIcon(size) })),
)

await Promise.all([
  writeFile(assetUrl('logo-mark.png'), await renderIcon(128, true)),
  writeFile(assetUrl('favicon-16x16.png'), faviconFrames[0].image),
  writeFile(assetUrl('favicon-32x32.png'), faviconFrames[1].image),
  writeFile(assetUrl('favicon.ico'), createIco(faviconFrames)),
  writeFile(assetUrl('apple-touch-icon.png'), await renderIcon(180)),
  writeFile(assetUrl('safari-pinned-tab.svg'), await createSafariMask()),
])

console.log('Generated header logo, favicons, Apple touch icon, and Safari pinned-tab mask.')
