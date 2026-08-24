import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
} from 'docx'
import { saveAs } from 'file-saver'
import { formatSpanishDate } from '@/lib/format'

const FONT = 'Calibri'
const DEFAULT_PRIMARY = '0c1e3c'
const DEFAULT_SECONDARY = '06b6d4'
const GRAY_COLOR = '6b7280'
const BODY_COLOR = '111827'
const BODY_SIZE = 22 // half-points → 11pt
const BODY_LINE_SPACING = 276 // 240 = single, 276 ≈ 1.15

interface OpportunityDocxData {
  title: string
  organismo: string
}

export interface ProposalBranding {
  legalName: string | null
  logoUrl: string | null
  brandColorPrimary: string | null
  brandColorSecondary: string | null
}

// docx expects 6-digit hex without the leading '#'. Fall back to a default.
function normalizeHex(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  const hex = value.replace('#', '').trim()
  return /^[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : fallback
}

// Remove any residual Markdown so it never renders as literal characters in Word.
function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, '') // ## headers
    .replace(/\*\*([^*]+)\*\*/g, '$1') // **bold**
    .replace(/\*([^*]+)\*/g, '$1') // *italic*
    .replace(/^[-*+]\s+/gm, '• ') // bullet points → •
    .replace(/^\d+\.\s+/gm, '') // numbered lists
    .trim()
}

// A section title is a short line in ALL CAPS or one ending in a colon.
function isSectionTitle(line: string): boolean {
  if (line.length > 80) return false
  if (line.endsWith(':')) return true
  const hasLetters = /[a-záéíóúñ]/i.test(line)
  return hasLetters && line === line.toLocaleUpperCase('es') && line.length <= 60
}

/**
 * Turn the (markdown-stripped) proposal text into styled paragraphs: section
 * titles as HEADING_2 in the brand primary color, body lines as normal text.
 */
function contentParagraphs(text: string, primary: string): Paragraph[] {
  const lines = stripMarkdown(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) {
    return [new Paragraph({ children: [new TextRun({ text: '—', font: FONT })] })]
  }

  return lines.map((line) => {
    if (isSectionTitle(line)) {
      const heading = line.replace(/:\s*$/, '')
      return new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
        children: [new TextRun({ text: heading, font: FONT, color: primary, bold: true })],
      })
    }
    return new Paragraph({
      spacing: { after: 100, line: BODY_LINE_SPACING },
      children: [new TextRun({ text: line, font: FONT, color: BODY_COLOR, size: BODY_SIZE })],
    })
  })
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

type RasterType = 'png' | 'jpg' | 'gif' | 'bmp'

function rasterTypeFromContentType(contentType: string | null): RasterType | null {
  if (!contentType) return null
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg'
  if (contentType.includes('gif')) return 'gif'
  if (contentType.includes('bmp')) return 'bmp'
  return null
}

/**
 * Fetch the company logo and build a centered ImageRun paragraph. Returns null
 * on any failure (missing/unreachable/unsupported image) so export still works.
 */
async function buildLogoParagraph(logoUrl: string | null): Promise<Paragraph | null> {
  if (!logoUrl) return null
  try {
    const response = await fetch(logoUrl)
    if (!response.ok) return null
    const type = rasterTypeFromContentType(response.headers.get('content-type'))
    if (!type) return null
    const data = await response.arrayBuffer()
    if (data.byteLength === 0) return null

    return new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [
        new ImageRun({
          type,
          data,
          transformation: { width: 140, height: 140 },
        }),
      ],
    })
  } catch {
    return null
  }
}

export async function exportProposalToDocx(
  fullText: string,
  opportunity: OpportunityDocxData,
  branding: ProposalBranding
): Promise<void> {
  const now = new Date()
  const dateStr = formatSpanishDate(now)

  const primary = normalizeHex(branding.brandColorPrimary, DEFAULT_PRIMARY)
  const secondary = normalizeHex(branding.brandColorSecondary, DEFAULT_SECONDARY)

  const logoParagraph = await buildLogoParagraph(branding.logoUrl)

  const header: Paragraph[] = []
  if (logoParagraph) header.push(logoParagraph)

  if (branding.legalName) {
    header.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [
          new TextRun({ text: branding.legalName, font: FONT, color: primary, bold: true, size: 28 }),
        ],
      })
    )
  }

  header.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: 'Propuesta Comercial', font: FONT, color: primary, bold: true })],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: opportunity.title, font: FONT, color: primary })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: opportunity.organismo || '—', font: FONT, color: GRAY_COLOR })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: dateStr, font: FONT, color: GRAY_COLOR })],
    }),
    // Brand-colored horizontal rule.
    new Paragraph({
      spacing: { after: 160 },
      border: {
        bottom: { color: secondary, space: 1, style: BorderStyle.SINGLE, size: 12 },
      },
      children: [],
    })
  )

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT } } } },
    sections: [
      {
        children: [
          ...header,
          ...contentParagraphs(fullText, primary),
          new Paragraph({
            spacing: { before: 360 },
            border: {
              top: { color: GRAY_COLOR, space: 1, style: BorderStyle.SINGLE, size: 4 },
            },
            children: [
              new TextRun({
                text: `${branding.legalName ?? 'Generado por Cribal'} · ${dateStr}`,
                font: FONT,
                color: GRAY_COLOR,
                size: 18,
              }),
            ],
          }),
        ],
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  const filename = `propuesta-${slugify(opportunity.organismo || 'licitacion')}-${now
    .toISOString()
    .slice(0, 10)}.docx`
  saveAs(blob, filename)
}
