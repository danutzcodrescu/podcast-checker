import { createHash } from 'node:crypto'
import { convert } from 'html-to-text'

export const embeddingModel = '@cf/qwen/qwen3-embedding-0.6b'
export const embeddingDimensions = 1024
export const preprocessingVersion = 1

export function plainText(value: string) {
  return convert(value, {
    wordwrap: false,
    preserveNewlines: true,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
    ],
  })
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\u00a0/g, ' ')
    .trim()
}

export function cleanDescription(value: string) {
  const paragraphs = plainText(value).split(/\n\s*\n/)
  const promotional =
    /^(?:join (?:the )?.+ club\b|to read our (?:new )?newsletter\b|advertise with us\s*:|learn more about your ad choices\b|(?:this episode is |this podcast is )?sponsored by\b|twitter\s*:|video editors?\s*:|social producer\s*:|(?:senior |executive )?producers?\s*:)/i
  return paragraphs
    .filter(
      (paragraph) => !promotional.test(paragraph.trim()) && !/^[_\-=]{3,}$/.test(paragraph.trim()),
    )
    .map((paragraph) => paragraph.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
    .replace(/(?:\n|^)(?:@\w+\s*)+(?=\n|$)/g, '')
    .trim()
}

export function embeddingContent(title: string, description: string, subtitle = '') {
  const cleanTitle = plainText(title)
  const cleaned = cleanDescription(description)
  const cleanSubtitle = plainText(subtitle)
  const input = [
    `Title: ${cleanTitle}`,
    cleanSubtitle && !cleaned.includes(cleanSubtitle) && cleanSubtitle !== cleanTitle
      ? `Subtitle: ${cleanSubtitle}`
      : '',
    cleaned ? `Description: ${cleaned}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  // A byte ceiling is conservative for the model's 8192-token per-input limit,
  // including languages whose characters require multiple tokens.
  let bounded = ''
  let bytes = 0
  for (const char of input) {
    bytes += Buffer.byteLength(char)
    if (bytes > 7500) break
    bounded += char
  }
  const hash = createHash('sha256')
    .update(`${embeddingModel}:${preprocessingVersion}:${bounded}`)
    .digest('hex')
  return { input: bounded, hash, cleanedDescription: cleaned }
}
