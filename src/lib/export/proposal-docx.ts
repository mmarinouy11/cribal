import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
} from 'docx'
import { saveAs } from 'file-saver'
import { formatSpanishDate } from '@/lib/format'

const PRIMARY_COLOR = '1e3a5f'
const GRAY_COLOR = '6b7280'
const FONT = 'Calibri'

interface ProposalDocxData {
  executiveSummary: string
  valueProposition: string
  relevantCapabilities: string
  clarificationQuestions: string
  nextSteps: string
}

interface OpportunityDocxData {
  title: string
  organismo: string
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, font: FONT, color: PRIMARY_COLOR, bold: true })],
  })
}

// Split free text into paragraphs on blank lines so lists/paragraphs survive.
function contentParagraphs(text: string): Paragraph[] {
  const blocks = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (blocks.length === 0) {
    return [new Paragraph({ children: [new TextRun({ text: '—', font: FONT })] })]
  }

  return blocks.map(
    (block) =>
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: block, font: FONT })],
      })
  )
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

export async function exportProposalToDocx(
  proposal: ProposalDocxData,
  opportunity: OpportunityDocxData
): Promise<void> {
  const now = new Date()
  const dateStr = formatSpanishDate(now)

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT } },
      },
    },
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: 'Propuesta Comercial',
                font: FONT,
                color: PRIMARY_COLOR,
                bold: true,
              }),
            ],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            alignment: AlignmentType.CENTER,
            spacing: { after: 80 },
            children: [
              new TextRun({ text: opportunity.title, font: FONT, color: PRIMARY_COLOR }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: opportunity.organismo || '—', font: FONT, color: GRAY_COLOR }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children: [new TextRun({ text: dateStr, font: FONT, color: GRAY_COLOR })],
          }),
          // Horizontal rule.
          new Paragraph({
            spacing: { after: 120 },
            border: {
              bottom: { color: PRIMARY_COLOR, space: 1, style: BorderStyle.SINGLE, size: 6 },
            },
            children: [],
          }),

          sectionHeading('1. Resumen Ejecutivo'),
          ...contentParagraphs(proposal.executiveSummary),

          sectionHeading('2. Propuesta de Valor'),
          ...contentParagraphs(proposal.valueProposition),

          sectionHeading('3. Capacidades Relevantes'),
          ...contentParagraphs(proposal.relevantCapabilities),

          sectionHeading('4. Preguntas de Aclaración'),
          ...contentParagraphs(proposal.clarificationQuestions),

          sectionHeading('5. Próximos Pasos'),
          ...contentParagraphs(proposal.nextSteps),

          new Paragraph({
            spacing: { before: 360 },
            border: {
              top: { color: GRAY_COLOR, space: 1, style: BorderStyle.SINGLE, size: 4 },
            },
            children: [
              new TextRun({
                text: `Generado por Cribal · ${dateStr}`,
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
