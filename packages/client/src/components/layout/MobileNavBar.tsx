import { View } from '@tarojs/components'
import { Icon } from '@/components/ui/Icon'
import { useT } from '@/lib/i18n'
import { isH5 } from '@/lib/utils'
import type { Chapter, Paragraph } from '@coeditor/shared'

export type MobileViewContext = 'paragraph' | 'chapter' | 'fulltext' | 'attachment' | null

interface MobileNavBarProps {
  chapters: Chapter[]
  title: string
  dirty: boolean
  saving: boolean
  viewContext: MobileViewContext
  currentChapterId: string | null
  selection: { chapterId: string; paragraphId: string } | null
  paragraphsByChapter: Record<string, Paragraph[]>
  onSelectParagraph: (chapterId: string, paragraphId: string) => void
  onSelectChapter: (chapterId: string) => void
  onToggleSidebar: () => void
}

interface FlatPara {
  chapterId: string
  paragraphId: string
}

export function MobileNavBar({
  chapters,
  title,
  dirty,
  saving,
  viewContext,
  currentChapterId,
  selection,
  paragraphsByChapter,
  onSelectParagraph,
  onSelectChapter,
  onToggleSidebar,
}: MobileNavBarProps) {
  const t = useT()
  const flatParas: FlatPara[] = chapters.flatMap((ch) =>
    (paragraphsByChapter[ch.id] || []).map((p) => ({ chapterId: ch.id, paragraphId: p.id }))
  )
  const paraIndex = selection
    ? flatParas.findIndex((p) => p.chapterId === selection.chapterId && p.paragraphId === selection.paragraphId)
    : -1

  const chapterIndex = chapters.findIndex((c) => c.id === currentChapterId)

  const showStepper = viewContext === 'paragraph' || viewContext === 'chapter'

  const goPrev = () => {
    if (viewContext === 'paragraph' && paraIndex > 0) {
      const prev = flatParas[paraIndex - 1]
      onSelectParagraph(prev.chapterId, prev.paragraphId)
    } else if (viewContext === 'chapter' && chapterIndex > 0) {
      onSelectChapter(chapters[chapterIndex - 1].id)
    }
  }

  const goNext = () => {
    if (viewContext === 'paragraph' && paraIndex >= 0 && paraIndex < flatParas.length - 1) {
      const next = flatParas[paraIndex + 1]
      onSelectParagraph(next.chapterId, next.paragraphId)
    } else if (viewContext === 'chapter' && chapterIndex >= 0 && chapterIndex < chapters.length - 1) {
      onSelectChapter(chapters[chapterIndex + 1].id)
    }
  }

  const prevDisabled = viewContext === 'paragraph' ? paraIndex <= 0 : chapterIndex <= 0
  const nextDisabled = viewContext === 'paragraph'
    ? paraIndex < 0 || paraIndex >= flatParas.length - 1
    : chapterIndex < 0 || chapterIndex >= chapters.length - 1

  return (
    <View className="flex items-center gap-1 px-2 shrink-0" style={{ height: isH5() ? 48 : 84, borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
      <View className="hover-accent" style={{ padding: 8, borderRadius: 8 }} onClick={onToggleSidebar}>
        <Icon name="menu" size={30} />
      </View>

      <View className="flex-1 font-medium text-sm truncate text-center" style={{ minWidth: 0 }}>{title || t('common.loading')}</View>

      {(dirty || saving) && (
        <View className="shrink-0 text-amber text-xs" style={{ fontSize: 20 }}>{saving ? t('editor.saving') : t('editor.unsaved')}</View>
      )}

      {showStepper && (
        <>
          <View className="hover-accent" style={{ padding: 8, borderRadius: 8, opacity: prevDisabled ? 0.3 : 1 }} onClick={prevDisabled ? undefined : goPrev}>
            <Icon name="chevronLeft" size={28} />
          </View>
          <View className="hover-accent" style={{ padding: 8, borderRadius: 8, opacity: nextDisabled ? 0.3 : 1 }} onClick={nextDisabled ? undefined : goNext}>
            <Icon name="chevronRight" size={28} />
          </View>
        </>
      )}
    </View>
  )
}
